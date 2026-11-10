'use strict'
/**
 * MossInfer 原生推理引擎（不依赖 ComfyUI / Python）
 *  - 安装：下载官方 Windows 包（含 CUDA 运行时），再拉一份 SFT 的配置与分词器小包
 *  - 出图：直接 spawn moss-infer.exe，读 stdout 的 step N/M 推进度，结束后把 PNG 读成 dataURL
 */
const fs = require('fs')
const path = require('path')
const https = require('https')
const { spawn } = require('child_process')

const ENGINE_ZIP = 'https://github.com/mossimage-cpp/mossimage.cpp/releases/download/v2.2.1/mossinfer-2.2.1-windows-cu13-x86_64.zip'
const BUNDLE_REPO = 'OpenMOSS-Team/MOSS-Image-SFT'
const BUNDLE_HOSTS = ['https://hf-mirror.com', 'https://huggingface.co']
const BUNDLE_FILES = [
  'model_index.json',
  'scheduler/scheduler_config.json',
  'scheduler/pipeline_moss_image.py',
  'text_encoder/config.json',
  'tokenizer/tokenizer.json',
  'tokenizer/tokenizer_config.json',
  'tokenizer/chat_template.jinja',
  'transformer/config.json',
  'transformer/diffusion_pytorch_model.safetensors.index.json',
  'transformer/pipeline_moss_image.py',
  'vae/config.json',
]

function follow(url, headers, depth, cb) {
  if (depth > 6) return cb(new Error('重定向次数过多'))
  const req = https.get(url, { headers }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume()
      return follow(res.headers.location, headers, depth + 1, cb)
    }
    cb(null, res)
  })
  req.setTimeout(60000, () => req.destroy(new Error('请求超时')))
  req.on('error', cb)
}

class MossInfer {
  constructor(userDataDir, onProgress = () => {}, onGenProgress = () => {}) {
    this.base = path.join(userDataDir, 'mossinfer')
    this.bundleDir = path.join(this.base, 'bundle')
    this.onProgress = onProgress
    this.onGenProgress = onGenProgress
    this.canceled = false
    this.child = null
  }

  get exePath() {
    return path.join(this.base, 'bin', 'moss-infer.exe')
  }

  installed() {
    return fs.existsSync(this.exePath) && fs.existsSync(path.join(this.bundleDir, 'model_index.json'))
  }

  status() {
    return {
      installed: this.installed(),
      dir: this.base,
      exe: fs.existsSync(this.exePath) ? this.exePath : '',
      bundle: fs.existsSync(this.bundleDir) ? this.bundleDir : '',
    }
  }

  cancel() {
    this.canceled = true
    try {
      this.child && this.child.kill()
    } catch {
      /* ignore */
    }
    return { ok: true }
  }

  async download(url, dest, label) {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const part = dest + '.part'
    return new Promise((resolve, reject) => {
      follow(url, { 'User-Agent': 'Lintools/1.0' }, 0, (err, res) => {
        if (err) return reject(err)
        if (!res || res.statusCode !== 200) {
          res && res.resume()
          return reject(new Error(`HTTP ${res ? res.statusCode : '?'} ${label || ''}`))
        }
        const total = Number(res.headers['content-length'] || 0)
        let got = 0
        const ws = fs.createWriteStream(part)
        let last = 0
        res.on('data', (c) => {
          if (this.canceled) {
            res.destroy()
            ws.end()
            return
          }
          got += c.length
          const now = Date.now()
          if (now - last > 400) {
            last = now
            this.onProgress({
              stage: 'download',
              file: label || path.basename(dest),
              percent: total ? Math.min(100, (got / total) * 100) : 0,
              received: got,
              total,
            })
          }
        })
        res.pipe(ws)
        ws.on('finish', () => {
          if (this.canceled) return reject(new Error('已取消'))
          fs.renameSync(part, dest)
          resolve({ bytes: got })
        })
        ws.on('error', reject)
        res.on('error', reject)
      })
    })
  }

  async unzip(zip, dest) {
    fs.mkdirSync(dest, { recursive: true })
    await new Promise((resolve, reject) => {
      const ps = spawn('tar', ['-xf', zip, '-C', dest], { windowsHide: true })
      let err = ''
      ps.stderr.on('data', (c) => (err += c))
      ps.on('error', reject)
      ps.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`解压失败 ${err.slice(0, 160)}`))))
    })
  }

  /** 安装引擎与配置包 */
  async install() {
    this.canceled = false
    const tmp = path.join(this.base, '_tmp')
    fs.mkdirSync(tmp, { recursive: true })
    const zip = path.join(tmp, 'engine.zip')
    this.onProgress({ stage: 'download', file: '推理引擎包', percent: 0, received: 0, total: 0 })
    if (!fs.existsSync(zip) || fs.statSync(zip).size < 1024 * 1024) {
      await this.download(ENGINE_ZIP, zip, '推理引擎包')
    }
    if (this.canceled) return { ok: false, canceled: true }
    this.onProgress({ stage: 'extract', file: '正在解压引擎', percent: 0 })
    const ex = path.join(tmp, 'ex')
    fs.rmSync(ex, { recursive: true, force: true })
    await this.unzip(zip, ex)
    const root = fs.readdirSync(ex, { withFileTypes: true }).find((e) => e.isDirectory())
    const src = root ? path.join(ex, root.name) : ex
    fs.rmSync(path.join(this.base, 'bin'), { recursive: true, force: true })
    const srcBin = path.join(src, 'bin')
    if (!fs.existsSync(path.join(srcBin, 'moss-infer.exe'))) throw new Error('引擎包里没找到 moss-infer.exe')
    fs.cpSync(srcBin, path.join(this.base, 'bin'), { recursive: true })

    // 配置与分词器
    let idx = 0
    for (const f of BUNDLE_FILES) {
      if (this.canceled) break
      idx += 1
      const dest = path.join(this.bundleDir, f)
      if (fs.existsSync(dest) && fs.statSync(dest).size > 0) continue
      let done = false
      for (const host of BUNDLE_HOSTS) {
        try {
          this.onProgress({ stage: 'bundle', file: f, percent: (idx / BUNDLE_FILES.length) * 100 })
          await this.download(`${host}/${BUNDLE_REPO}/resolve/main/${f}`, dest, path.basename(f))
          done = true
          break
        } catch {
          /* 换镜像 */
        }
      }
      if (!done) throw new Error(`配置包下载失败：${f}`)
    }
    fs.rmSync(tmp, { recursive: true, force: true })
    return { ok: this.installed(), canceled: this.canceled, ...this.status() }
  }

  /** 出图，返回 dataURL */
  async generate(cfg = {}) {
    if (!this.installed()) throw new Error('推理引擎还没安装')
    const out = path.join(this.base, 'out', `moss-${Date.now()}.png`)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    const args = [
      'generate',
      '--model', this.bundleDir,
      '--dit', String(cfg.dit || ''),
      '--te', String(cfg.te || ''),
      '--vae', String(cfg.vae || ''),
      '--tier', 'high',
      '--prompt', String(cfg.prompt || ''),
      '--width', String(Math.round(cfg.width || 1024)),
      '--height', String(Math.round(cfg.height || 1024)),
      '--steps', String(Math.round(cfg.steps || 50)),
      '--cfg', String(cfg.cfg || 3),
      '--seed', String(cfg.seed === undefined || cfg.seed < 0 ? -1 : cfg.seed),
      '-o', out,
    ]
    if (cfg.negative) args.push('--negative', String(cfg.negative))
    // 大图在 8G 卡上需要流式加载才能塞得下，小图用 balanced 更快
    const px = (cfg.width || 1024) * (cfg.height || 1024)
    args.push('--mode', px >= 900 * 900 ? 'min_memory' : 'balanced')
    return new Promise((resolve, reject) => {
      const ps = spawn(this.exePath, args, { windowsHide: true, cwd: path.dirname(this.exePath) })
      this.child = ps
      let buf = ''
      ps.stdout.on('data', (c) => {
        buf += c.toString()
        const m = /step (\d+)\/(\d+)/g
        let last = null
        let hit
        while ((hit = m.exec(buf))) last = hit
        if (last) this.onGenProgress({ step: Number(last[1]), total: Number(last[2]), percent: (Number(last[1]) / Number(last[2])) * 100 })
      })
      let errBuf = ''
      ps.stderr.on('data', (c) => (errBuf += c.toString()))
      ps.on('error', reject)
      ps.on('close', (code) => {
        this.child = null
        if (code !== 0) return reject(new Error((errBuf || '推理失败').trim().slice(0, 400)))
        if (!fs.existsSync(out)) return reject(new Error('引擎没有输出图片'))
        const b64 = fs.readFileSync(out).toString('base64')
        const tail = buf.trim().split('\n').slice(-3).join(' ')
        resolve({ dataUrl: `data:image/png;base64,${b64}`, path: out, log: tail })
      })
    })
  }
}

module.exports = { MossInfer }
