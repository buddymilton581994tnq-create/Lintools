'use strict'
/**
 * LoRA 训练：基于 kohya-ss/sd-scripts，跑在 ComfyUI 自带的 Python 上。
 *  - 环境：下载 sd-scripts 源码（走国内镜像）+ pip 装依赖，一次到位
 *  - 数据：用户给一个图片文件夹，自动整理成 10_repeat 结构并写同名 .txt 标注
 *  - 产物：直接输出到 ComfyUI 的 models/loras，训完就能在 LoRA 工作流里选到
 *  - 日志：训练输出实时推给界面，失败给翻译过的人话
 */
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const res = require('./resilience.cjs')
const comfy = require('./comfyui.cjs')

const SDSCRIPTS_URLS = [
  'https://ghproxy.net/https://codeload.github.com/kohya-ss/sd-scripts/zip/refs/heads/main',
  'https://gh-proxy.com/https://codeload.github.com/kohya-ss/sd-scripts/zip/refs/heads/main',
  'https://ghfast.top/https://codeload.github.com/kohya-ss/sd-scripts/zip/refs/heads/main',
  'https://ghp.ci/https://codeload.github.com/kohya-ss/sd-scripts/zip/refs/heads/main',
  'https://codeload.github.com/kohya-ss/sd-scripts/zip/refs/heads/main',
]

const IMG_RE = /\.(png|jpe?g|webp|bmp)$/i

class LoraTrainer {
  /** engine: ComfyUIEngine 实例（借它的 Python 和 models 目录） */
  constructor(engine, onLog, onProgress) {
    this.engine = engine
    this.onLog = onLog || (() => {})
    this.onProgress = onProgress || (() => {})
    this.proc = null
    this.lastError = ''
  }

  get scriptsDir() {
    return path.join(this.engine.dataDir, 'sd-scripts')
  }
  get trainRoot() {
    return path.join(this.engine.dataDir, 'training')
  }
  /** sd-scripts 认的是 transformers 4.x，ComfyUI 自带的是 5.x。
      不动 ComfyUI 的环境，单独装一份 4.x 到 trainsite，训练时用 PYTHONPATH 顶上去。 */
  get trainLibDir() {
    return path.join(this.engine.dataDir, 'trainsite')
  }
  get outDir() {
    // 直接产到 ComfyUI 的 loras 目录，训完立即可选
    return path.join(this.engine.comfyRoot, 'models', 'loras')
  }

  /** 训练子进程的环境：断掉 HF 联网 + 告诉启动脚本训练库在哪 */
  trainEnv() {
    const base = res.cleanChildEnv()
    return {
      ...base,
      LINTOOLS_TRAIN_LIB: this.trainLibDir,
      HF_HUB_OFFLINE: '1',
      TRANSFORMERS_OFFLINE: '1',
      DIFFUSERS_OFFLINE: '1',
      HF_ENDPOINT: 'https://hf-mirror.com',
      PYTHONIOENCODING: 'utf-8',
    }
  }

  /** 嵌入式 Python 带 python313._pth，PYTHONPATH 会被忽略（隔离模式），
      所以用一个极小的启动脚本在 import 之前把训练库目录塞进 sys.path。 */
  writeWrapper() {
    const wrapper = path.join(this.scriptsDir, 'lintools_train.py')
    const code = [
      'import os, sys, runpy',
      'lib = os.environ.get("LINTOOLS_TRAIN_LIB")',
      'if lib and os.path.isdir(lib) and lib not in sys.path:',
      '    sys.path.insert(0, lib)',
      'here = os.path.dirname(os.path.abspath(__file__))',
      'target = os.path.join(here, "train_network.py")',
      'sys.argv[0] = target',
      'runpy.run_path(target, run_name="__main__")',
      '',
    ].join('\n')
    fs.writeFileSync(wrapper, code, 'utf8')
    return wrapper
  }

  /** CLIP 分词器：sd-scripts 训练前要 CLIPTokenizer，联网拉不到就会直接报错。
      这里先把 4 个小文件下到本地缓存目录，训练时用 --tokenizer_cache_dir 走离线。 */
  get tokenizerCacheDir() {
    return path.join(this.engine.dataDir, 'tokcache')
  }

  async ensureTokenizer() {
    const dir = path.join(this.tokenizerCacheDir, 'openai_clip-vit-large-patch14')
    const files = ['vocab.json', 'merges.txt', 'tokenizer_config.json', 'special_tokens_map.json']
    const ok = () => files.every((f) => fs.existsSync(path.join(dir, f)) && fs.statSync(path.join(dir, f)).size > 256)
    if (ok()) return { ok: true, dir }
    fs.mkdirSync(dir, { recursive: true })
    this.onProgress({ phase: 'tokenizer', label: '正在准备 CLIP 分词器（约 1.5MB）', percent: 0.6 })
    const mirrors = ['https://hf-mirror.com', 'https://huggingface.co']
    for (const base of mirrors) {
      try {
        for (const f of files) {
          const dest = path.join(dir, f)
          if (fs.existsSync(dest) && fs.statSync(dest).size > 256) continue
          await comfy.fetchWithRetry(
            [`${base}/openai/clip-vit-large-patch14/resolve/main/${f}`],
            dest,
            () => {},
            2,
          )
        }
        if (ok()) return { ok: true, dir }
      } catch {
        /* 换下一个镜像 */
      }
    }
    return { ok: false, dir, error: 'CLIP 分词器下载失败，请检查网络连接后重试' }
  }

  async ensureTrainLib() {
    const libJson = JSON.stringify(this.trainLibDir)
    const probeCmd =
      `import sys;sys.path.insert(0, ${libJson});` +
      `import transformers,diffusers;` +
      `import diffusers.pipelines.stable_diffusion.pipeline_stable_diffusion as _p;` +
      `print(transformers.__version__)`
    const probe = await comfy.execIn(this.engine.pythonExe, ['-s', '-c', probeCmd], this.scriptsDir || this.engine.dataDir, 120000)
    const v = (probe.out || '').trim().split('\n').pop() || ''
    if (probe.code === 0 && /^4\./.test(v)) return { ok: true, version: v }
    // 装一份 4.x（含依赖）到 trainsite，ComfyUI 那边一个字节都不动
    fs.rmSync(this.trainLibDir, { recursive: true, force: true })
    fs.mkdirSync(this.trainLibDir, { recursive: true })
    this.onProgress({ phase: 'deps', label: '正在配置独立训练环境 transformers 4.x（与 ComfyUI 环境隔离）', percent: 0.65 })
    const r = await comfy.execIn(
      this.engine.pythonExe,
      [
        '-m', 'pip', 'install', '--target', this.trainLibDir, '--upgrade', '--no-warn-script-location',
        '-i', 'https://pypi.tuna.tsinghua.edu.cn/simple',
        // 4.x 一整套要和 ComfyUI 的 5.x 隔离开：transformers / hub / diffusers 三者版本必须互相兼容，
        // 直接把 hub 和 diffusers 一起钉在 4.x 时代的版本上，免得混出新旧打架
        'transformers>=4.45,<4.50', 'huggingface_hub==0.30.2', 'diffusers==0.31.0',
      ],
      this.engine.dataDir,
      30 * 60 * 1000,
      (t) => {
        const line = t.trim().split('\n').pop() || ''
        if (line) this.onProgress({ phase: 'deps', label: `装训练库：${line.slice(0, 80)}`, percent: 0.65 })
      },
    )
    const again = await comfy.execIn(this.engine.pythonExe, ['-s', '-c', probeCmd], this.engine.dataDir, 90000)
    const v2 = (again.out || '').trim().split('\n').pop() || ''
    if (again.code === 0 && /^4\./.test(v2)) return { ok: true, version: v2 }
    return { ok: false, version: v2, error: r.out.split('\n').slice(-6).join(' ') }
  }

  /** 环境状态：源码在不在、依赖装没装 */
  async envStatus() {
    const scripts = fs.existsSync(path.join(this.scriptsDir, 'train_network.py'))
    let deps = false
    let version = ''
    if (scripts && this.engine.isInstalled()) {
      const cmd = `import sys;sys.path.insert(0, ${JSON.stringify(this.trainLibDir)});import transformers,accelerate,safetensors,einops;print(transformers.__version__)`
      const r = await comfy.execIn(this.engine.pythonExe, ['-s', '-c', cmd], this.scriptsDir, 90000)
      deps = r.code === 0
      version = (r.out || '').trim().split('\n').pop() || ''
    }
    return {
      scripts,
      deps,
      // 依赖装好但 transformers 还是 5.x 的话训练会崩，这里把版本一起带出去给界面提示
      transformers: version,
      trainLibReady: /^4\./.test(version),
      ready: scripts && deps && /^4\./.test(version),
      training: !!this.proc,
      pythonReady: this.engine.isInstalled(),
    }
  }

  /** 部署训练环境：下源码 + 装依赖（torch 复用 ComfyUI 的，不重复下几个 G） */
  async setupEnv() {
    if (!this.engine.isInstalled()) throw new Error('请先完成 ComfyUI 部署，训练模块需复用其内置 Python 环境')

    // 1) sd-scripts 源码
    if (!fs.existsSync(path.join(this.scriptsDir, 'train_network.py'))) {
      const zip = path.join(this.engine.dataDir, 'sd-scripts.zip')
      this.onProgress({ phase: 'scripts', label: '正在下载 sd-scripts 训练框架', percent: 0.1 })
      await comfy.fetchWithRetry(SDSCRIPTS_URLS, zip, (got, total) =>
        this.onProgress({ phase: 'scripts', label: '正在下载 sd-scripts 训练框架', received: got, total, percent: total ? (got / total) * 0.5 : 0.1 }),
      )
      this.onProgress({ phase: 'scripts', label: '正在解压训练框架', percent: 0.55 })
      const tmp = path.join(this.engine.dataDir, 'sd-scripts-unpack')
      fs.rmSync(tmp, { recursive: true, force: true })
      await comfy.extractZip(zip, tmp, (m) => this.onLog(`${m}\n`))
      const inner = path.join(tmp, 'sd-scripts-main')
      fs.rmSync(this.scriptsDir, { recursive: true, force: true })
      fs.renameSync(fs.existsSync(inner) ? inner : tmp, this.scriptsDir)
      fs.rmSync(zip, { force: true })
      fs.rmSync(tmp, { recursive: true, force: true })
    }

    // 2) 依赖：requirements 里 torch 已满足会自动跳过（走清华源，国内快）
    this.onProgress({ phase: 'deps', label: '正在安装训练依赖组件（复用现有 PyTorch 环境）', percent: 0.6 })
    const mirror = ['-i', 'https://pypi.tuna.tsinghua.edu.cn/simple']
    const r1 = await comfy.execIn(
      this.engine.pythonExe,
      ['-m', 'pip', 'install', '-r', 'requirements.txt', '--no-warn-script-location', ...mirror],
      this.scriptsDir,
      45 * 60 * 1000,
      (t) => {
        const line = t.trim().split('\n').pop() || ''
        if (line) this.onProgress({ phase: 'deps', label: `安装依赖：${line.slice(0, 80)}`, percent: 0.6 })
      },
    )
    if (r1.code !== 0) {
      // 整包失败就装核心几件套，多少能跑
      this.onLog(`完整依赖列表安装未通过（退出码 ${r1.code}），正在切换为核心依赖组件安装…\n`)
      await comfy.execIn(
        this.engine.pythonExe,
        [
          '-m', 'pip', 'install', '--no-warn-script-location', ...mirror,
          'accelerate', 'transformers', 'safetensors', 'einops', 'tqdm', 'imagesize', 'toml', 'voluptuous', 'diffusers',
        ],
        this.scriptsDir,
        30 * 60 * 1000,
        (t) => {
          const line = t.trim().split('\n').pop() || ''
          if (line) this.onProgress({ phase: 'deps', label: `安装依赖：${line.slice(0, 80)}`, percent: 0.6 })
        },
      )
    }
    const st = await this.envStatus()
    if (!st.scripts || !st.deps) throw new Error('训练依赖组件尚未安装完整，请点击「重装训练环境」后重试')
    // 训练库：sd-scripts 只认 transformers 4.x
    const lib = await this.ensureTrainLib()
    if (!lib.ok) throw new Error(`训练环境 transformers 组件安装失败（当前版本 ${lib.version || '未知'}）：${lib.error || ''}`)
    // 分词器：离线训练必须先有本地缓存
    const tk = await this.ensureTokenizer()
    if (!tk.ok) throw new Error(tk.error || 'CLIP 分词器尚未准备就绪')
    this.onProgress({ phase: 'deps', label: `训练环境已就绪（transformers ${lib.version}）`, percent: 1 })
    return await this.envStatus()
  }

  /** 整理数据集：图片复制成 img/10_<name>/ 结构，每张配一个 .txt 标注。
   *  如果用户自己给每张图写了同名 .txt，就照抄他自己的，不用统一标签。 */
  prepareDataset(cfg) {
    const files = fs.readdirSync(cfg.datasetDir).filter((f) => IMG_RE.test(f))
    if (files.length < 3) throw new Error(`训练集样本数量不足（当前检测到 ${files.length} 张，至少需要 3 张，建议准备 15 张以上）`)
    const tag = (cfg.activation || cfg.outputName || 'mylora').replace(/[^\w-]/g, '_')
    const imgDir = path.join(this.trainRoot, tag, 'img', `10_${tag}`)
    fs.rmSync(path.join(this.trainRoot, tag), { recursive: true, force: true })
    fs.mkdirSync(imgDir, { recursive: true })
    const caption = (cfg.caption || cfg.activation || tag).trim()
    let ownCaptions = 0
    for (const f of files) {
      const src = path.join(cfg.datasetDir, f)
      const dst = path.join(imgDir, f)
      try {
        fs.linkSync(src, dst)
      } catch {
        fs.copyFileSync(src, dst)
      }
      const ownTxt = path.join(cfg.datasetDir, f.replace(IMG_RE, '.txt'))
      const dstTxt = path.join(imgDir, f.replace(IMG_RE, '.txt'))
      if (fs.existsSync(ownTxt)) {
        fs.copyFileSync(ownTxt, dstTxt)
        ownCaptions++
      } else if (caption) {
        fs.writeFileSync(dstTxt, caption)
      }
    }
    return { imgDirParent: path.join(this.trainRoot, tag, 'img'), count: files.length, ownCaptions }
  }

  /** 开始训练。cfg: { datasetDir, outputName, activation, caption, baseModel, resolution, epochs, lr, dim, alpha, lowvram } */
  async start(cfg) {
    if (this.proc) throw new Error('当前已有正在执行的训练任务')
    const st = await this.envStatus()
    if (!st.ready) throw new Error('训练环境尚未就绪，请先点击「准备训练环境」')

    const ckptAbs = path.join(this.engine.ckptDir, cfg.baseModel)
    if (!fs.existsSync(ckptAbs)) throw new Error(`未找到指定基础底模：${cfg.baseModel}，请在工作流页面的底模列表中选择已下载的模型`)

    const ds = this.prepareDataset(cfg)
    fs.mkdirSync(this.outDir, { recursive: true })
    const logDir = path.join(this.trainRoot, 'logs')
    fs.mkdirSync(logDir, { recursive: true })

    const args = [
      '--network_module', 'networks.lora',
      '--tokenizer_cache_dir', this.tokenizerCacheDir,
      '--pretrained_model_name_or_path', ckptAbs,
      '--train_data_dir', ds.imgDirParent,
      '--output_dir', this.outDir,
      '--logging_dir', logDir,
      '--output_name', (cfg.outputName || 'mylora').replace(/[^\w-]/g, '_'),
      '--resolution', String(cfg.resolution || 512),
      '--train_batch_size', '1',
      '--max_train_epochs', String(cfg.epochs || 10),
      '--learning_rate', String(cfg.lr || 1e-4),
      '--network_dim', String(cfg.dim || 32),
      '--network_alpha', String(cfg.alpha || 16),
      '--optimizer_type', 'AdamW',
      '--optimizer_args', 'weight_decay=0.01',
      '--mixed_precision', 'fp16',
      '--save_model_as', 'safetensors',
      '--cache_latents',
      '--gradient_checkpointing',
      '--enable_bucket',
      '--min_bucket_reso', '256',
      '--max_bucket_reso', '1024',
      '--caption_extension', '.txt',
      // 新版 transformers 的 tokenizer 把 model_max_length 报成一个超大值，
      // 不显式截断会在编码阶段抛 OverflowError，这里固定按 225 token 截
      '--max_token_length', '225',
      '--shuffle_caption',
      '--seed', '42',
      '--save_every_n_epochs', String(Math.max(1, Math.floor((cfg.epochs || 10) / 2))),
    ]
    if (cfg.lowvram) {
      // sd-scripts 没有 --lowvram，省显存要靠这几个：VAE 放内存、latent 落盘、注意力走 sdpa
      args.push('--lowram', '--cache_latents_to_disk', '--sdpa', '--vae_batch_size', '1')
    }
    if (cfg.resolution && cfg.resolution >= 1024 && !cfg.lowvram) args.push('--sdpa')

    this.lastError = ''
    const dec = new TextDecoder('gbk')
    // 用启动脚本跑：先把训练库塞进 sys.path，再执行真正的 train_network.py
    const wrapper = this.writeWrapper()
    const proc = spawn(this.engine.pythonExe, ['-s', wrapper, ...args], {
      cwd: this.scriptsDir,
      windowsHide: true,
      env: this.trainEnv(),
    })
    this.proc = proc
    this.onLog(
      `训练任务已启动：共 ${ds.count} 张样本图像 · ${cfg.epochs || 10} 轮（Epochs） · 秩（Dim）${cfg.dim || 32}` +
        `${ds.ownCaptions ? ` · 其中 ${ds.ownCaptions} 张采用自定义同名标注` : ''}\n`,
    )

    proc.stdout.on('data', (c) => this.onLog(dec.decode(c, { stream: true })))
    proc.stderr.on('data', (c) => {
      const t = dec.decode(c, { stream: true })
      this.lastError = (this.lastError + t).slice(-4096)
      this.onLog(t)
    })
    proc.on('error', (e) => {
      this.proc = null
      this.onLog(`\n训练进程启动失败：${e.message}\n`)
    })
    proc.on('exit', (code) => {
      this.proc = null
      if (code === 0) {
        this.onLog(`\n训练已完成。生成的 LoRA 模型已保存至 models/loras 目录，返回工作流页面刷新模型列表即可选用。\n`)
      } else {
        this.onLog(`\n训练异常中断（退出码 ${code}）。${res.translateError(this.lastError)}\n`)
      }
    })
    return { ok: true }
  }

  stop() {
    if (this.proc) {
      try {
        this.proc.kill()
      } catch {
        /* ignore */
      }
      this.proc = null
      this.onLog('\n已手动停止训练。\n')
    }
  }
}

module.exports = { LoraTrainer }
