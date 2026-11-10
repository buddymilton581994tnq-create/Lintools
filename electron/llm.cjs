'use strict'
/**
 * 本地 DeepSeek 引擎（内部代号 ds4f）
 *
 * 核心机制：
 *  1. 零思考模板 + 单槽位 8192 上下文 + 禁用 8GB 冗余 RAM 缓存，杜绝推理卡死与内存溢出掉线。
 *  2. 封存进模型安装包的百科语料库（corpus.cjs + corpus-library.json，1030 组分类词条 / 70 个细分类目）：
 *     - 翻译英文提示词时：优先匹配语料库精准英文，严格翻译用户输入和已选标签，不擅自添加未提及的背景道具。
 *     - 细节推荐时：从语料库检索与主体相契合的 6~8 个维度，每个维度提供 6 个高区分度候选项。
 *  3. 关闭程序时调用 resetAndClean()，安全停止模型、重置运行参数并清理缓存。
 */
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const net = require('net')
const { spawn } = require('child_process')
const {
  loadLibrary,
  matchSlangGlossary,
  matchDimensionBank,
  retrieveCorpusForInput,
  buildFallbackOrMergeFields,
  translateWithGlossary,
  decomposeUnknownCn,
  getUniversalTranslator,
} = require('./corpus.cjs')

const PROMPT_COMPILER_RULES_SPEC = `
# 角色定义
你是一个工业级 AI 绘画提示词编译引擎（兼容 CLIP 与 T5 双编码器架构）。你的唯一任务是将用户的中文输入精准编译为结构严谨、视觉具象、防串色、防崩坏的高响应度英文提示词（Prompt）。
# 十大精细化编译准则（必须逐条严格执行）
1. 严格的主次语序重排（Token 权重前置定律）：[顺位1：核心画质与媒介画风] -> [顺位2：主体数量与核心身份] -> [顺位3：核心动作与镜头视角] -> [顺位4：面部五官、发型与服饰细节] -> [顺位5：背景环境与道具] -> [顺位6：光影氛围与色调]
2. 色彩防串色绑定规则：严禁将颜色词单独悬空放置，必须将【颜色 + 材质 + 具体部位】死死绑定为一个紧凑短语（如 snow-white long hair, crimson red eyes, wearing a pitch-black silk dress）。
3. 服装与物体的材质光泽强制补全：金属/铠甲/刀剑绑 metallic luster, brushed steel, sharp reflections；丝绸/汉服/礼服绑 flowing silk fabric, satin sheen, delicate embroidery；皮革/机能风绑 matte leather texture, tactical nylon, detailed stitching；丝袜/薄纱绑 sheer translucent fabric, fine nylon texture。
4. 手部与复杂动作的防崩坏物理拆解：拿剑 -> gripping sword hilt firmly with one hand, detailed fingers；托腮 -> resting chin on hand, fingers gently curled；双手合十 -> hands pressed together in prayer in front of chest。
5. 严禁出现否定词（no/without/not）：不戴眼镜 -> unadorned face, clear eyes；不穿鞋/光脚 -> bare feet, barefoot, exposed ankles；面无表情/不笑 -> expressionless, stoic neutral face, closed mouth；背景无人 -> deserted empty street, solitary figure。
6. 亚文化黑话与跨模型双轨制（自然语言 + Danbooru Tag）：伪娘/男娘 -> femboy, androgynous boy, feminine appearance, crossdressing, otoko no ko；呆毛 -> single hair strand sticking up, ahoge；白毛红瞳 -> white hair, red eyes；死鱼眼/半睁鄙视眼 -> half-closed eyes, unamused deadpan expression, jitome；异色瞳 -> heterochromia, two different colored eyes；水手服 -> Japanese sailor school uniform, serafuku；绝对领域 -> thighhighs with short skirt, exposed thigh gap, zettai ryouiki；战损 -> battle damaged outfit, torn tattered clothes。
7. 镜头透视与防相机污染：严禁使用单词 camera；看镜头 -> looking directly at viewer, eye contact；背对镜头 -> view from behind, back turned to viewer；仰视/俯视 -> low angle shot, from below / high angle shot, from above；背景虚化 -> shallow depth of field, blurry background, bokeh。
8. 中式古典与网文意境及中文自造词具象化：严禁输出中文原文或汉语拼音，必须拆解为画面中看得见的【实体道具 + 物理材质 + 粒子特效 + 光影】。
9. 语法清洗与符号规范：剔除程度副词；成对器官用复数（eyes, hands, legs, wings, horns），单件衣物用单数；词条内用空格不用下划线，词条间用英文逗号加空格 ", " 分隔。
10. 零废话输出铁律：只输出最终的一行纯英文提示词字符串，严禁输出任何前缀引导语、解释、换行或句号。
`.trim()

const MIRRORS = ['https://hf-mirror.com', 'https://huggingface.co']

/**
 * 编译准则优先读同目录的 prompt-compiler-rules.md。
 * 那份文档可以随时改写，不用动代码；读不到时回落到内置常量。
 */
function loadCompilerRulesSpec() {
  try {
    const p = path.join(__dirname, 'prompt-compiler-rules.md')
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8')
      if (raw && raw.trim().length > 200) return raw
    }
  } catch {
    /* 用常量兜底 */
  }
  return PROMPT_COMPILER_RULES_SPEC
}

function urlsFor(repo, file) {
  return MIRRORS.map((base) => `${base}/${repo}/resolve/main/${file}`)
}

const MODELS = [
  {
    id: 'ds4f-mini',
    name: 'DeepSeek R1 蒸馏版 1.5B',
    short: 'DS 1.5B',
    label: '本地轻量模型 1.5B（约 1GB）',
    note: '占用低，普通配置就能流畅跑，适合日常识别与翻译',
    bytes: Math.round(1.04 * 1024 ** 3),
    template: 'deepseek',
    ctxSize: 8192,
    vramHint: '2GB 显存即可',
    files: [
      {
        file: 'ds4f-mini-q4_k_m.gguf',
        urls: urlsFor('unsloth/DeepSeek-R1-Distill-Qwen-1.5B-GGUF', 'DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf'),
      },
    ],
  },
  {
    id: 'qwen3-8b',
    name: '千问 Qwen3 8B',
    short: '千问 8B',
    label: '千问 8B 模型（约 4.7GB）',
    note: '理解与推理更强，推荐 8GB 以上显存；首次下载时间较长',
    bytes: Math.round(4.68 * 1024 ** 3),
    template: 'native',
    ctxSize: 6144,
    vramHint: '建议 8GB 显存',
    files: [
      {
        file: 'ds4f-qwen3-8b-q4_k_m.gguf',
        urls: urlsFor('Qwen/Qwen3-8B-GGUF', 'Qwen3-8B-Q4_K_M.gguf'),
      },
    ],
  },
]

const RUNTIME_TAG = 'b12189'
const RUNTIMES = {
  vulkan: {
    url: `https://github.com/ggml-org/llama.cpp/releases/download/${RUNTIME_TAG}/llama-${RUNTIME_TAG}-bin-win-vulkan-x64.zip`,
    bytes: Math.round(36 * 1024 ** 2),
    label: 'GPU 推理组件',
  },
  cpu: {
    url: `https://github.com/ggml-org/llama.cpp/releases/download/${RUNTIME_TAG}/llama-${RUNTIME_TAG}-bin-win-cpu-x64.zip`,
    bytes: Math.round(24 * 1024 ** 2),
    label: 'CPU 推理组件',
  },
}

const NO_THINK_JINJA = `{% if not add_generation_prompt is defined %}{% set add_generation_prompt = false %}{% endif %}{% set ns = namespace(system_prompt='') %}{%- for message in messages %}{%- if message['role'] == 'system' %}{% set ns.system_prompt = message['content'] %}{%- endif %}{%- endfor %}{{bos_token}}{%- for message in messages %}{%- if message['role'] == 'user' %}{{'<｜User｜>' + (ns.system_prompt + '\\n\\n' if ns.system_prompt else '') + message['content']}}{% set ns.system_prompt = '' %}{%- endif %}{%- if message['role'] == 'assistant' and message['content'] is not none %}{{'<｜Assistant｜><think>\\n</think>\\n\\n' + message['content'] + '<｜end▁of▁sentence｜>'}}{%- endif %}{%- endfor -%}{% if add_generation_prompt %}{{'<｜Assistant｜><think>\\n</think>\\n\\n'}}{% endif %}`

const DEFAULT_CONFIG = {
  modelId: 'ds4f-mini',
  runtime: 'auto',
  port: 0,
  reasoningBudget: 0,
  ctxSize: 8192,
  temperature: 0.35,
  topP: 0.9,
  repeatPenalty: 1.12,
  autoStart: true,
}

function modelById(id) {
  return MODELS.find((m) => m.id === id) || MODELS[0]
}

/**
 * 编译结果清洗。
 * 小模型偶尔会把系统指令、编号列表、箭头推导一起吐出来，
 * 这里只保留形如 booru tag 的片段：纯英文、无编号、无规则关键词、长度合理。
 */
function sanitizeCompiledTags(raw) {
  const text = String(raw || '')
    .replace(/\*\*/g, ' ')
    .replace(/[“”"`]/g, ' ')
  // 模型把自己的思考过程也写出来时，这些词会大量出现
  const junk = /\brules?\b|color binding|material luster|hand anatomy|compiled|chinese input|following|specified|e\.g\.|->|=>|never use|no\/without|the color is|visual prompt|comma-separated|tags? only|reply with|i'?ll|i will|let me|identify|according to|putting it|^\s*(first|next|then|finally)\b|subject count|^\s*\d+[.)]\s/i
  const out = []
  for (const part of text.split(/[,，\n]/)) {
    const t = part.trim().replace(/^[-\s]+/, '').replace(/\.+$/, '')
    if (!t || t.length > 60) continue
    if (/[:;]/.test(t)) continue
    if (junk.test(t)) continue
    // 首字母大写的单个词基本是句子残渣，booru tag 都是小写
    if (/^[A-Z][a-z]+$/.test(t)) continue
    if (/[\u4e00-\u9fff]/.test(t)) continue
    if (!/[a-z]/i.test(t)) continue
    if (out.some((x) => x.toLowerCase() === t.toLowerCase())) continue
    out.push(t)
  }
  return out.join(', ')
}

function fileSize(p) {
  try {
    return fs.statSync(p).size
  } catch {
    return 0
  }
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

function findFile(dir, name) {
  let out = null
  const walk = (d) => {
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (out) return
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.toLowerCase() === name.toLowerCase()) out = full
    }
  }
  walk(dir)
  return out
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.unref()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function httpJson(url, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout }, (res) => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (raw += c))
      res.on('end', () => resolve({ status: res.statusCode || 0, body: raw }))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

function fetchToFile(url, dest, onChunk, redirects = 0) {
  return new Promise((resolve, reject) => {
    const part = `${dest}.part`
    const already = fileSize(part)
    const mod = url.startsWith('https') ? https : http
    const headers = { 'User-Agent': 'Lintools/1.0' }
    if (already > 0) headers.Range = `bytes=${already}-`

    const req = mod.get(url, { headers, timeout: 30000 }, (res) => {
      const { statusCode = 0 } = res
      if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
        res.resume()
        if (redirects > 6) return reject(new Error('重定向次数过多'))
        return fetchToFile(new URL(res.headers.location, url).toString(), dest, onChunk, redirects + 1).then(resolve, reject)
      }
      if (statusCode === 416) {
        res.resume()
        fs.renameSync(part, dest)
        return resolve(dest)
      }
      if (statusCode !== 200 && statusCode !== 206) {
        res.resume()
        return reject(new Error(`下载失败 (${statusCode})`))
      }

      const isResume = statusCode === 206
      const total = (isResume ? already : 0) + Number(res.headers['content-length'] || 0)
      let received = isResume ? already : 0
      const out = fs.createWriteStream(part, { flags: isResume ? 'a' : 'w' })
      res.on('data', (c) => {
        received += c.length
        onChunk(received, total)
      })
      res.pipe(out)
      out.on('finish', () =>
        out.close(() => {
          const got = fileSize(part)
          if (total > 0 && got < total) return reject(new Error('下载连接中断'))
          fs.renameSync(part, dest)
          resolve(dest)
        }),
      )
      out.on('error', reject)
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('下载超时')))
    req.on('error', reject)
  })
}

function unzip(zipPath, destDir) {
  const psEsc = (s) => String(s || '').replace(/'/g, "''")
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true })
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -LiteralPath '${psEsc(zipPath)}' -DestinationPath '${psEsc(destDir)}' -Force`],
      { windowsHide: true },
    )
    let err = ''
    ps.stderr.on('data', (c) => (err += c))
    ps.on('error', reject)
    ps.on('close', (code) => (code === 0 ? resolve(destDir) : reject(new Error(`解压失败 ${code} ${err.slice(0, 200)}`))))
  })
}

function extractUserFieldRequest(userContent) {
  const kwMatch = /关键词：([^\n]+)/.exec(userContent)
  const focusMatch = /(?:重点补这几项|请补充以下维度)：([^\n。]+)/.exec(userContent)
  const singleMatch = /只(?:重新给|刷新)「([^」]+)」/.exec(userContent)
  const exclMatch = /(?:这些词已经出现过了|已出现词汇)：([^\n。]+)/.exec(userContent)
  const keyword = kwMatch ? kwMatch[1].trim() : userContent.trim()
  let targetFields = []
  if (singleMatch && singleMatch[1]) {
    targetFields = [singleMatch[1].trim()]
  } else if (focusMatch && focusMatch[1]) {
    targetFields = focusMatch[1]
      .split(/[、,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  const excluded = exclMatch
    ? exclMatch[1]
        .split(/[、,，]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : []
  return { keyword, targetFields, excluded }
}

class LocalModelEngine {
  constructor(opts) {
    this.dataDir = opts.dataDir
    this.resourcesDir = opts.resourcesDir || ''
    this.configPath = path.join(opts.dataDir, 'ai.json')
    this.templatePath = path.join(opts.dataDir, 'nothink.jinja')
    this.onProgress = opts.onProgress || (() => {})
    this.onStatus = opts.onStatus || (() => {})
    this.onLog = opts.onLog || (() => {})
    this.proc = null
    this.port = 0
    this.error = ''
    this.busy = null
    this.logs = []
    this.config = this.readConfig()
    this.state = this.isInstalled() ? 'stopped' : 'uninstalled'
    this.wantRunning = false
    this.restarts = 0
    this.healthTimer = null
    this.healthFailures = 0
    this.activeReq = null
    this.lastActivityAt = 0
    this._syncSealedLibrary()
  }

  get modelsDir() {
    return path.join(this.dataDir, 'models')
  }
  get runtimeDir() {
    return path.join(this.dataDir, 'runtime')
  }
  get serverExe() {
    return findFile(this.runtimeDir, 'llama-server.exe')
  }
  get modelPath() {
    const m = modelById(this.config.modelId)
    return path.join(this.modelsDir, m.files[0].file)
  }
  isInstalled() {
    return !!this.serverExe && !!this.modelPath && fileSize(this.modelPath) > 1024 * 1024
  }

  /**
   * 确保封存的 corpus-library.json 同步部署到模型安装目录下并预热进内存
   */
  _syncSealedLibrary() {
    try {
      const bundledLib = path.join(__dirname, 'corpus-library.json')
      if (fs.existsSync(bundledLib)) {
        fs.mkdirSync(this.dataDir, { recursive: true })
        const targets = [
          path.join(this.dataDir, 'corpus-library.json'),
          path.join(this.runtimeDir, 'corpus-library.json'),
        ]
        for (const targetLib of targets) {
          try {
            const parentDir = path.dirname(targetLib)
            if (fs.existsSync(parentDir)) {
              fs.copyFileSync(bundledLib, targetLib)
            }
          } catch {
            /* ignore */
          }
        }
      }
      // 同步将十大精细化编译准则写入本地模型部署包目录
      const rulesTargets = [
        path.join(this.dataDir, 'prompt-compiler-rules.md'),
        path.join(this.runtimeDir, 'prompt-compiler-rules.md'),
      ]
      for (const rt of rulesTargets) {
        try {
          if (fs.existsSync(path.dirname(rt))) {
            fs.writeFileSync(rt, loadCompilerRulesSpec(), 'utf8')
          }
        } catch {
          /* ignore */
        }
      }
      const bundledIndex = path.join(__dirname, 'master_index.json')
      if (fs.existsSync(bundledIndex)) {
        for (const targetIdx of [
          path.join(this.dataDir, 'master_index.json'),
          path.join(this.runtimeDir, 'master_index.json'),
        ]) {
          try {
            if (fs.existsSync(path.dirname(targetIdx))) {
              fs.copyFileSync(bundledIndex, targetIdx)
            }
          } catch {
            /* ignore */
          }
        }
      }
      loadLibrary([this.dataDir, this.resourcesDir])
      getUniversalTranslator([this.dataDir, this.resourcesDir]).loadIndex()
    } catch {
      /* ignore */
    }
  }

  readConfig() {
    try {
      const raw = fs.readFileSync(this.configPath, 'utf8').replace(/^\uFEFF/, '')
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
    } catch {
      return { ...DEFAULT_CONFIG }
    }
  }

  writeConfig(patch) {
    this.config = { ...this.config, ...patch }
    fs.mkdirSync(this.dataDir, { recursive: true })
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8')
    if (this.state === 'uninstalled' && this.isInstalled()) this.state = 'stopped'
    this.emitStatus()
    return this.config
  }

  /**
   * 退出程序时重置模型运行参数并清理临时缓存文件
   */
  resetAndClean() {
    this.stop()
    this.config = { ...DEFAULT_CONFIG }
    try {
      fs.mkdirSync(this.dataDir, { recursive: true })
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8')
    } catch {
      /* ignore */
    }
    this.logs = []
    this.restarts = 0
    this.healthFailures = 0
    try {
      const cleanPartFiles = (dir) => {
        if (!fs.existsSync(dir)) return
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            if (/cache|tmp|temp|slot/i.test(entry.name)) rmrf(full)
            else cleanPartFiles(full)
          } else if (/\.(part|tmp|log|cache)$/i.test(entry.name)) {
            rmrf(full)
          }
        }
      }
      cleanPartFiles(this.dataDir)
    } catch {
      /* ignore */
    }
  }

  getStatus() {
    const m = modelById(this.config.modelId)
    return {
      state: this.state,
      ready: this.state === 'ready',
      installed: this.isInstalled(),
      error: this.error,
      modelId: m.id,
      modelName: m.name,
      modelShort: m.short || m.name,
      modelLabel: m.label,
      modelNote: m.note,
      modelBytes: m.bytes,
      vramHint: m.vramHint || '',
      port: this.port,
      dir: this.dataDir,
      catalog: MODELS.map((x) => ({
        id: x.id,
        name: x.name,
        short: x.short || x.name,
        label: x.label,
        note: x.note,
        bytes: x.bytes,
        vramHint: x.vramHint || '',
        installed: fileSize(path.join(this.modelsDir, x.files[0].file)) > 1024 * 1024,
        active: x.id === m.id,
      })),
    }
  }

  setState(state, error = '') {
    if (this.state === state && this.error === error) return
    this.state = state
    this.error = error
    this.onStatus(this.getStatus())
  }

  emitStatus() {
    this.onStatus(this.getStatus())
  }

  throttle() {
    let last = -1
    return (p) => {
      const pct = Math.round((p.percent || 0) * 100)
      if (pct === last && pct !== 100) return
      last = pct
      this.onProgress(p)
    }
  }

  ensureReady(modelId) {
    if (this.busy) return this.busy
    if (modelId && modelId !== this.config.modelId) this.writeConfig({ modelId })
    this.busy = this._ensure().finally(() => {
      this.busy = null
    })
    return this.busy
  }

  async _ensure() {
    try {
      await this._deployRuntime()
      await this._deployModel()
      this._syncSealedLibrary()
      await this.start()
      return this.getStatus()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.setState('error', msg)
      throw new Error(msg)
    }
  }

  async _deployRuntime() {
    if (this.serverExe) return

    const bundled = this.bundledRuntimeZip()
    if (bundled) {
      try {
        this.setState('preparing')
        this.onProgress({ phase: 'runtime', label: '正在解压运行组件与内置词库', percent: 0.5 })
        await unzip(bundled, this.runtimeDir)
        if (this.serverExe) {
          this.config = { ...this.config, runtime: 'vulkan' }
          this.writeConfig({})
          return
        }
        rmrf(this.runtimeDir)
      } catch {
        rmrf(this.runtimeDir)
      }
    }

    const order = this.config.runtime === 'cpu' ? ['cpu'] : this.config.runtime === 'vulkan' ? ['vulkan'] : ['vulkan', 'cpu']
    for (const kind of order) {
      const rt = RUNTIMES[kind]
      const zip = path.join(this.runtimeDir, `runtime-${kind}.zip`)
      const push = this.throttle()
      try {
        this.setState('preparing')
        fs.mkdirSync(this.runtimeDir, { recursive: true })
        if (fileSize(zip) < 20 * 1024 ** 2) {
          await fetchToFile(rt.url, zip, (got, total) =>
            push({ phase: 'runtime', label: rt.label, ...this.rate(got, total) }),
          )
        }
        push({ phase: 'runtime', label: '正在解压运行组件', percent: 1 })
        await unzip(zip, this.runtimeDir)
        if (this.serverExe) {
          this.config = { ...this.config, runtime: kind }
          this.writeConfig({})
          return
        }
      } catch {
        rmrf(this.runtimeDir)
      }
    }
    throw new Error('运行组件初始化失败，请检查网络后重试')
  }

  bundledRuntimeZip() {
    const list = [
      this.resourcesDir ? path.join(this.resourcesDir, 'llama-runtime.zip') : '',
      path.join(this.dataDir, 'llama-runtime.zip'),
    ].filter(Boolean)
    for (const p of list) if (fileSize(p) > 20 * 1024 ** 2) return p
    return null
  }

  rate(received, total) {
    const now = Date.now()
    if (!this.speedMark || now - this.speedMark.t > 3000) {
      this.speedMark = { t: now, bytes: received }
      this.speedBps = 0
    } else if (now - this.speedMark.t > 1200) {
      const dt = (now - this.speedMark.t) / 1000
      this.speedBps = Math.round((received - this.speedMark.bytes) / dt)
    }
    const percent = total ? received / total : 0
    const etaSec = this.speedBps > 20000 && total > received ? Math.round((total - received) / this.speedBps) : null
    return { received, total, percent, speedBps: this.speedBps || 0, etaSec }
  }

  async _deployModel() {
    const m = modelById(this.config.modelId)
    fs.mkdirSync(this.modelsDir, { recursive: true })
    for (const f of m.files) {
      const dest = path.join(this.modelsDir, f.file)
      if (fileSize(dest) > 64 * 1024 * 1024) continue
      const push = this.throttle()
      this.setState('preparing')
      this.speedMark = null
      let lastErr = null
      for (const url of f.urls || [f.url]) {
        try {
          await fetchToFile(url, dest, (got, total) =>
            push({ phase: 'model', label: `正在下载 ${m.name}`, ...this.rate(got, total) }),
          )
          lastErr = null
          break
        } catch (e) {
          lastErr = e
        }
      }
      if (lastErr) throw new Error('模型下载失败，请检查网络后重试')
    }
  }

  async start() {
    this.wantRunning = true
    if (this.state === 'ready' && this.proc && !this.proc.killed) return this.getStatus()
    const gpu = this.config.runtime !== 'cpu'
    try {
      await this._spawn(gpu)
      return this.getStatus()
    } catch (e) {
      if (gpu) {
        this.killProc()
        try {
          await this._spawn(false)
          this.config = { ...this.config, runtime: 'cpu' }
          this.writeConfig({})
          return this.getStatus()
        } catch {
          /* fallthrough */
        }
      }
      throw e
    }
  }

  killProc() {
    if (this.activeReq) {
      try {
        this.activeReq.destroy()
      } catch {
        /* ignore */
      }
      this.activeReq = null
    }
    if (this.proc) {
      try {
        this.proc.kill()
      } catch {
        /* ignore */
      }
      this.proc = null
    }
    this.port = 0
  }

  _scheduleRestart() {
    if (!this.wantRunning || this.state === 'uninstalled') return
    if (this.restartTimer) return
    const n = (this.restarts = (this.restarts || 0) + 1)
    const wait = Math.min(30000, 2000 * n)
    this.onProgress({
      phase: 'restart',
      label: `正在重新连接本地模型 (第 ${n} 次)`,
      percent: 0.5,
    })
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (!this.wantRunning || this.busy || this.state === 'uninstalled') return
      this._spawn(this.config.runtime !== 'cpu').catch(() => {
        this.killProc()
        this._scheduleRestart()
      })
    }, wait)
  }

  _watchHealth() {
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.healthFailures = 0
    this.healthTimer = setInterval(() => {
      if (!this.wantRunning || this.busy || this.state !== 'ready' || !this.port) return
      if (this.activeReq || Date.now() - this.lastActivityAt < 20000) {
        this.healthFailures = 0
        return
      }
      httpJson(`http://127.0.0.1:${this.port}/health`, 10000)
        .then((r) => {
          if (r.status === 200 || r.status === 503) {
            this.healthFailures = 0
          } else {
            throw new Error(`status ${r.status}`)
          }
        })
        .catch(() => {
          this.healthFailures = (this.healthFailures || 0) + 1
          if (this.healthFailures >= 3) {
            this.healthFailures = 0
            this.killProc()
            this.setState('error', '本地模型正在自动重连')
            this._scheduleRestart()
          }
        })
    }, 30000)
    if (this.healthTimer.unref) this.healthTimer.unref()
  }

  _ensureNoThinkTemplate() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true })
      fs.writeFileSync(this.templatePath, NO_THINK_JINJA, 'utf8')
      return this.templatePath
    } catch {
      return null
    }
  }

  async _spawn(gpu) {
    const exe = this.serverExe
    const model = this.modelPath
    const m = modelById(this.config.modelId)
    if (!exe || fileSize(model) < 1024 * 1024) throw new Error('模型文件不完整，请重新下载')

    this.setState('starting')
    const port = await freePort()
    this.port = port
    const ctxSize = String(m.ctxSize || this.config.ctxSize || 8192)

    const args = [
      '-m',
      model,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '-c',
      ctxSize,
      '-np',
      '1',
      '--cache-ram',
      '0',
      '-ngl',
      gpu ? '99' : '0',
      '--jinja',
      '--reasoning',
      'off',
      '--reasoning-budget',
      '0',
      '--no-webui',
    ]
    // DeepSeek 蒸馏版会自己吐思考块，得用压制模板；千问 8B 用 GGUF 内嵌的 ChatML 模板
    if (m.template !== 'native') {
      const tplFile = this._ensureNoThinkTemplate()
      if (tplFile) args.push('--chat-template-file', tplFile)
    }

    this.onProgress({ phase: 'start', label: '正在启动本地模型', percent: 0.5 })
    const proc = spawn(exe, args, { windowsHide: true, cwd: path.dirname(exe) })
    this.proc = proc
    this.logs = []
    const collect = (c) => {
      this.logs.push(String(c))
      if (this.logs.length > 200) this.logs.shift()
      this.onLog(String(c))
    }
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', collect)
    proc.stderr.on('data', collect)
    proc.on('exit', (code) => {
      this.proc = null
      this.port = 0
      if (!this.wantRunning) return
      if (this.state === 'ready' || this.state === 'starting') {
        const tail = this.logs.slice(-5).join('').trim().slice(-200)
        this.setState('error', `本地模型已断开 (${code})${tail ? ' ' + tail : ''}`)
      }
      this._scheduleRestart()
    })

    const deadline = Date.now() + 240000
    while (Date.now() < deadline) {
      if (!this.proc) throw new Error(this.error || '模型启动失败')
      try {
        const r = await httpJson(`http://127.0.0.1:${port}/health`)
        if (r.status === 200 && /ok/.test(r.body)) {
          this.setState('ready')
          this.onProgress({ phase: 'start', label: '本地模型已就绪', percent: 1 })
          this.restarts = 0
          this.lastActivityAt = Date.now()
          this._watchHealth()
          return
        }
      } catch {
        /* 还在加载 */
      }
      await sleep(400)
    }
    throw new Error('模型加载超时，可能内存不足')
  }

  stop() {
    this.wantRunning = false
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.killProc()
    if (this.state !== 'uninstalled') this.setState('stopped')
  }

  uninstall() {
    this.stop()
    rmrf(this.modelsDir)
    rmrf(this.runtimeDir)
    this.setState('uninstalled')
    return this.getStatus()
  }

  /**
   * 推理主入口：
   *  - 英文提示词翻译（isEnglishExpand）：精确翻译用户写的词与已选标签，不加戏、不写中文、不说教。
   *  - 细节推荐（isJsonFields）：直接从封存的 918 组百科语料库检索契合的 6~8 个维度，每项不少于 6 个短标签。
   */
  async chat(messages, onDelta = () => {}, opts = {}) {
    if (this.state !== 'ready' || !this.proc) {
      if (this.isInstalled()) {
        await this.start()
      } else {
        throw new Error('本地模型未启动')
      }
    }

    if (this.activeReq) {
      try {
        this.activeReq.destroy()
      } catch {
        /* ignore */
      }
      this.activeReq = null
    }

    const customDirs = [this.dataDir, this.resourcesDir]
    const rawMsgs = Array.isArray(messages) ? messages : []
    const sysContent = rawMsgs.find((m) => m.role === 'system')?.content || ''
    const userContent = rawMsgs.find((m) => m.role === 'user')?.content || ''

    const isEnglishExpand =
      /英文.*提示词|English image prompt/i.test(sysContent) || /^(Subject|主体)\s*[:：]/i.test(userContent)
    const isJsonFields =
      /"fields"/.test(sysContent) || /重点补这几项|请补充以下维度|你觉得还缺什么|只重新给|只刷新/.test(userContent)

    // 1. 译为英文提示词：严格忠实于用户输入与所选标签
    if (isEnglishExpand) {
      const subjMatch = /(?:Subject|主体)\s*[:：]\s*([^\n]+)/i.exec(userContent)
      const styleMatch = /(?:Style|已选效果|风格与效果)\s*[:：]\s*([^\n]+)/i.exec(userContent)
      const subj = subjMatch ? subjMatch[1].trim() : userContent.trim()
      const rawStyle = styleMatch ? styleMatch[1].trim() : ''
      const style = rawStyle.replace(/^photo-realistic,\s*soft light$/i, '').replace(/^none$/i, '').trim()

      const hits = matchSlangGlossary(subj, customDirs)
      const translatorScan = getUniversalTranslator(customDirs).scanHits(subj)
      let remainingCn = translatorScan.remainingText || subj
      for (const h of hits) {
        for (const t of h.terms) {
          remainingCn = remainingCn.split(t).join('')
        }
      }
      remainingCn = remainingCn.replace(/[，。、！？\s的了在和与配穿戴着一个名位只条件双]+/g, '').trim()

      // 先对剩余未知中文自造词做确定性词根拆解，减少小模型瞎翻概率
      const { extraEn: rootDecomposedEn, leftover: finalUnknownCn } = decomposeUnknownCn(remainingCn)

      // matchSlangGlossary 已经裁定过的词，第二检索器不要再翻一遍。
      // 「菊花」会同时命中人类的 anus 和花卉的 chrysanthemum，
      // 两边都拼进来就会输出 "anus, chrysanthemum"。
      const settledTerms = new Set(hits.map((h) => String(h.matchedTerm || '').trim()))
      const scanEn = translatorScan.hits
        .filter((x) => !settledTerms.has(String(x.zh || '').trim()))
        .map((x) => x.en)

      let modelRaw = [...scanEn, ...rootDecomposedEn].filter(Boolean).join(', ')
      // 当词根拆解后仍有自由中文词句时，用小模型编译剩余部分。
      // 规则必须走 system，且写得短。之前十条规则全塞进 user 消息，
      // 7B 级小模型会把规则当正文复述，输出里就会出现
      // "Color Binding: Never leave colors floating" 这种句子。
      if (finalUnknownCn.length > 0) {
        const glossHint = [...hits.map((h) => `${h.matchedTerm}=${h.en}`), ...rootDecomposedEn].join('; ')
        const systemRules = [
          'You are a Danbooru tag compiler.',
          'Turn the Chinese description into English booru tags joined by ", ".',
          'Order: quality/style, subject, action, face/hair/outfit, environment, lighting.',
          'Bind each color to the part it belongs to. Name the material. Describe hand contact.',
          'For body parts use anatomical terms: nipples, areolae, breasts, cleavage, anus, ass, thighs, calves, soles, navel, collarbone, armpits.',
          'Never translate a Chinese word character by character, and never turn a body part into a daily object.',
          'Convert negations into positive descriptions.',
          'Never output Chinese, explanations, rule text, or numbering.',
          'Reply with the tag line only.',
        ].join(' ')
        const userLine = glossHint
          ? `Chinese: ${finalUnknownCn}\nReuse these tags as-is: ${glossHint}`
          : `Chinese: ${finalUnknownCn}`

        try {
          const llmOut = await this._rawStreamChat(
            [
              { role: 'system', content: systemRules },
              { role: 'user', content: userLine },
            ],
            () => {},
            { temperature: 0.2, maxTokens: 160 },
          )
          const cleaned = sanitizeCompiledTags(llmOut)
          if (cleaned) modelRaw = [modelRaw, cleaned].filter(Boolean).join(', ')
        } catch {
          /* keep rootDecomposedEn */
        }
      }

      const finalEn = translateWithGlossary(subj, style, modelRaw, customDirs)
      onDelta({ text: finalEn })
      return finalEn
    }

    // 2. 细节推荐与换一批：从封存的图书馆词库翻找相称的多维度标签（单次不少于 5~8 个维度，每项 6 个精炼标签）
    if (isJsonFields) {
      const { keyword, targetFields, excluded } = extractUserFieldRequest(userContent)
      const fields = buildFallbackOrMergeFields(keyword, targetFields, excluded, customDirs)
      const jsonStr = JSON.stringify({ fields })
      onDelta({ text: jsonStr })
      return jsonStr
    }

    // 3. 其它调用
    return this._rawStreamChat(rawMsgs, onDelta, opts)
  }

  /**
   * AI 导演智能体：根据用户原始生图意图与是否存在云端 API 底图，动态计算并输出本地 ComfyUI 精修控制参数
   */
  async decideComfyDirectorParams(payload = {}) {
    const userPrompt = String(payload.userPrompt || payload.prompt || '').trim()
    const rawZh = String(payload.rawZh || '').trim()
    const hasCloudBase = payload.hasCloudBase !== false
    const combinedText = `${rawZh} ${userPrompt}`.toLowerCase()

    // 判定用户是否明确要求“彻底重画、换姿势、换风格”
    const wantsHeavyRedraw = /彻底重画|完全重绘|全部重画|换姿势|换动作|换风格|改变画风|大幅重绘|推翻重来|heavy redraw|change pose|change style/.test(combinedText)
    const hasElfOrEars = /精灵|尖耳|兽耳|猫耳|狐耳|兔耳|elf|pointed ears|animal ears|cat ears|fox ears/.test(combinedText)
    const hasMascotOrChibi = /桌宠|立绘|q版|二头身|chibi|mascot|tachie|全身立绘/.test(combinedText)

    // 确定性安全基准值（严格遵循核心判定规则）
    let baseDenoise = 0.30
    if (wantsHeavyRedraw) {
      baseDenoise = 0.58
    } else if (hasCloudBase) {
      baseDenoise = hasElfOrEars ? 0.29 : hasMascotOrChibi ? 0.30 : 0.32
    } else {
      baseDenoise = 0.33
    }

    const posParts = ['masterpiece', 'flawless facial structure']
    if (hasElfOrEars) {
      posParts.push('long elegant pointed ears')
    }
    posParts.push('detailed refined features', 'sharp focus')
    if (hasMascotOrChibi) {
      posParts.push('clean crisp character silhouette', 'balanced proportions')
    }

    const negParts = [
      'deformed ears',
      'mutated face',
      'goblin-like',
      'ugly',
      'bad anatomy',
      'disfigured',
      'extra limbs',
      'blurry',
    ]

    let reason = wantsHeavyRedraw
      ? '检测到明确要求大幅重绘或更换风格姿势，已将重绘幅度设为 0.58'
      : hasCloudBase
        ? '当前使用云端生成的底图，已将重绘幅度设为 0.30 以保留五官与主体轮廓'
        : '已将重绘幅度保持在安全区间，避免原图五官与比例变形'

    const fallbackDecision = {
      denoise: baseDenoise,
      steps: 25,
      cfg: 7.0,
      positive_prompt_append: posParts.join(', '),
      negative_prompt_append: negParts.join(', '),
      reason,
    }

    // 若本地大模型在线，让模型在铁律约束下微调参数与理由，随后用硬规则钳制范围确保绝对不越界
    if (this.state === 'ready') {
      const directorSys = [
        '# 角色',
        '你是一个精通 ComfyUI 工作流、图生图（Img2Img）重构与视觉防崩坏的 AI 导演智能体。',
        '',
        '# 任务',
        '根据用户的原始生图意图，为下一步的本地 ComfyUI 精修环节动态计算并输出最优控制参数。',
        '',
        '# 核心判定规则（绝对不能违背）',
        '1. 重绘幅度 (denoise) 决策铁律：',
        '   - 底图是由高品质云端 API（如 GPT/Midjourney）生成的优质成图时：denoise 必须严格锁定在 0.28 ~ 0.35 之间。绝对禁止超过 0.40！因为超过 0.40 会导致本地底模强行介入重构，从而彻底破坏原图的面部结构、毁掉精灵的尖耳朵，导致画面变成“哥布林式畸变”。',
        '   - 只有在用户明确要求“彻底重画、换姿势、换风格”时，denoise 才能给到 0.55 以上。',
        '2. 采样步数 (steps)：维持在 20 ~ 25 步即可。',
        '3. 防畸变修补：必须在正向和反向追加对应词条。',
        '',
        '# 输出格式',
        '必须严格以纯 JSON 格式输出，不要包含任何 markdown 代码标记或前后废话：',
        '{"denoise":0.30,"steps":25,"cfg":7.0,"positive_prompt_append":"masterpiece, flawless facial structure, long elegant pointed ears, detailed refined features, sharp focus","negative_prompt_append":"deformed ears, mutated face, goblin-like, ugly, bad anatomy, disfigured, extra limbs, blurry","reason":"由于底图已由云端 API 生成，为防止本地模型破坏精灵面部结构与耳朵形态，已自动将重绘幅度降至 0.30 进行结构保护"}',
      ].join('\n')

      try {
        const rawOut = await this._rawStreamChat(
          [
            { role: 'system', content: directorSys },
            {
              role: 'user',
              content: `用户生图意图：${rawZh || userPrompt || '精致角色立绘'}\n底图来源：${hasCloudBase ? '云端 API 高品质底图' : '参考底图'}`,
            },
          ],
          () => {},
          { temperature: 0.2, maxTokens: 260 },
        )
        const m = /\{[\s\S]*\}/.exec(String(rawOut || ''))
        if (m) {
          const parsed = JSON.parse(m[0])
          let d = Number(parsed.denoise)
          if (!Number.isFinite(d)) d = fallbackDecision.denoise
          if (!wantsHeavyRedraw) {
            d = Math.min(0.35, Math.max(0.28, d))
          } else {
            d = Math.min(0.85, Math.max(0.55, d))
          }
          let st = Math.round(Number(parsed.steps) || 25)
          st = Math.min(25, Math.max(20, st))
          let cfgVal = Number(parsed.cfg)
          if (!Number.isFinite(cfgVal) || cfgVal < 4 || cfgVal > 12) cfgVal = 7.0
          return {
            denoise: Number(d.toFixed(2)),
            steps: st,
            cfg: Number(cfgVal.toFixed(1)),
            positive_prompt_append: String(parsed.positive_prompt_append || fallbackDecision.positive_prompt_append).trim(),
            negative_prompt_append: String(parsed.negative_prompt_append || fallbackDecision.negative_prompt_append).trim(),
            reason: String(parsed.reason || fallbackDecision.reason).trim(),
          }
        }
      } catch {
        /* 使用确定性安全基准值 */
      }
    }

    return fallbackDecision
  }

  _rawStreamChat(messages, onDelta = () => {}, opts = {}) {
    const body = JSON.stringify({
      model: this.config.modelId,
      messages,
      stream: true,
      temperature: opts.temperature ?? this.config.temperature ?? 0.35,
      top_p: this.config.topP ?? 0.9,
      repeat_penalty: opts.repeatPenalty ?? this.config.repeatPenalty ?? 1.12,
      max_tokens: opts.maxTokens ?? 400,
    })

    this.lastActivityAt = Date.now()

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: this.port,
          path: '/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          this.lastActivityAt = Date.now()
          if (res.statusCode !== 200) {
            let e = ''
            res.setEncoding('utf8')
            res.on('data', (c) => (e += c))
            res.on('end', () => {
              if (this.activeReq === req) this.activeReq = null
              reject(new Error(`模型返回 ${res.statusCode} ${e.slice(0, 200)}`))
            })
            return
          }
          res.setEncoding('utf8')
          let buf = ''
          let content = ''
          res.on('data', (chunk) => {
            this.lastActivityAt = Date.now()
            buf += chunk
            const lines = buf.split('\n')
            buf = lines.pop() || ''
            for (const line of lines) {
              const t = line.trim()
              if (!t.startsWith('data:')) continue
              const payload = t.slice(5).trim()
              if (payload === '[DONE]') continue
              try {
                const d = JSON.parse(payload).choices?.[0]?.delta || {}
                if (d.reasoning_content) onDelta({ reasoning: d.reasoning_content })
                if (d.content) {
                  content += d.content
                  onDelta({ text: d.content })
                }
              } catch {
                /* 半包 */
              }
            }
          })
          res.on('end', () => {
            this.lastActivityAt = Date.now()
            if (this.activeReq === req) this.activeReq = null
            resolve(content)
          })
          res.on('error', (err) => {
            if (this.activeReq === req) this.activeReq = null
            reject(err)
          })
        },
      )
      this.activeReq = req
      req.on('error', (err) => {
        if (this.activeReq === req) this.activeReq = null
        reject(err)
      })
      req.write(body)
      req.end()
    })
  }
}

module.exports = { LocalModelEngine, MODELS, RUNTIMES, modelById }
