'use strict'
/**
 * 本地模型（MOSS-Image）管理与下载
 *  - 国内直连 huggingface.co 经常超时，默认先走 hf-mirror.com，失败再回落到官方站
 *  - 只下三件套（DiT / 文本编码器 / VAE），按精度组合挑选，不整仓下载
 *  - 断点续传 + 进度回调 + 可取消
 */
const fs = require('fs')
const path = require('path')
const https = require('https')

const HOSTS = ['https://hf-mirror.com', 'https://huggingface.co']
const DEFAULT_REPO = 'Comfy-Org/MOSS-Image'

function getText(url, timeoutMs = 25000, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('重定向次数过多'))
    const req = https.get(url, { headers: { 'User-Agent': 'Lintools/1.0' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        resolve(getText(res.headers.location, timeoutMs, depth + 1))
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      let buf = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (buf += c))
      res.on('end', () => resolve(buf))
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('请求超时')))
    req.on('error', reject)
  })
}

async function getJsonWithFallback(pathname, timeoutMs = 25000) {
  const errs = []
  for (const host of HOSTS) {
    try {
      const txt = await getText(host + pathname, timeoutMs)
      return { host, json: JSON.parse(txt) }
    } catch (e) {
      errs.push(`${host} ${e instanceof Error ? e.message : e}`)
    }
  }
  throw new Error(`仓库清单读取失败：${errs.join(' / ')}`)
}

/**
 * 三件套固定搭配，按 ComfyUI 官方 MOSS-Image 模板的推荐来：
 *  推荐档：SFT int8 DiT + qwen3.5 9b w4a8 文本编码器 + flux2-vae_small
 *  画质档：SFT bf16 DiT + qwen3.5 9b bf16 文本编码器 + flux2-vae_small
 * VAE 官方模板只用 small 版，全尺寸那版不是这套模型该配的。
 */
const PLAN = {
  int8: {
    dit: /diffusion_models\/moss_image_sft_int8_convrot\.safetensors$/,
    te: /text_encoders\/qwen3\.5_9b_w4a8_gptq\.safetensors$/,
    vae: /vae\/flux2-vae_small\.safetensors$/,
  },
  bf16: {
    dit: /diffusion_models\/moss_image_sft_bf16\.safetensors$/,
    te: /text_encoders\/qwen3\.5_9b_bf16\.safetensors$/,
    vae: /vae\/flux2-vae_small\.safetensors$/,
  },
}

function pickPlan(files, precision) {
  const p = precision === 'bf16' ? 'bf16' : 'int8'
  const rule = PLAN[p]
  const pick = (re) => files.find((f) => re.test(f.path))
  const chosen = [pick(rule.dit), pick(rule.te), pick(rule.vae)].filter(Boolean)
  return { precision: p, files: chosen, missing: chosen.length < 3 }
}

function classify(name) {
  const n = String(name || '').toLowerCase()
  if (/vae|\/ae[._-]?safetensors|flux2.*vae/.test(n)) return 'vae'
  if (/qwen|text[_-]?encoder|t5|clip/.test(n)) return 'text_encoders'
  return 'diffusion_models'
}

class LocalModelManager {
  constructor(getComfyRoot, onProgress = () => {}) {
    this.getComfyRoot = getComfyRoot
    this.onProgress = onProgress
    this.canceled = false
    this.active = false
  }

  get root() {
    const base = this.getComfyRoot()
    if (!base) throw new Error('未检测到内置 ComfyUI 目录')
    return base
  }

  modelsDir(kind) {
    const map = { diffusion_models: 'diffusion_models', text_encoders: 'text_encoders', vae: 'vae', loras: 'loras' }
    return path.join(this.root, 'models', map[kind] || 'diffusion_models')
  }

  cancel() {
    this.canceled = true
    return { ok: true }
  }

  installed() {
    const out = []
    for (const kind of ['diffusion_models', 'text_encoders', 'vae']) {
      try {
        const dir = this.modelsDir(kind)
        if (!fs.existsSync(dir)) continue
        for (const f of fs.readdirSync(dir)) {
          if (!/\.(safetensors|sft|pt|ckpt)$/i.test(f)) continue
          const st = fs.statSync(path.join(dir, f))
          if (st.size < 1024) continue
          out.push({ kind, name: f, bytes: st.size, dir })
        }
      } catch {
        /* ignore */
      }
    }
    return out
  }

  async listRepo(repo) {
    let id = String(repo || DEFAULT_REPO).trim().replace(/^https?:\/\/[^/]+\//i, '').replace(/\/+$/, '')
    // 老版本存下来的错名兜底：ComfyOrg -> Comfy-Org
    id = id.replace(/^ComfyOrg\//i, 'Comfy-Org/')
    if (!id) throw new Error('请填写 HuggingFace 仓库名，例如 Comfy-Org/MOSS-Image')
    const { host, json } = await getJsonWithFallback(`/api/models/${id}/tree/main?recursive=true`)
    const files = (Array.isArray(json) ? json : [])
      .filter((x) => x && x.type === 'file' && /\.(safetensors|sft)$/i.test(x.path || ''))
      .map((x) => ({ path: x.path, bytes: x.size || 0, kind: classify(x.path) }))
    if (!files.length) throw new Error('这个仓库里没找到 safetensors 权重')
    return { repo: id, host, files }
  }

  downloadOne(host, repo, file, dest) {
    const url = `${host}/${repo}/resolve/main/${encodeURI(file.path)}`
    return this.download(url, dest, file.bytes)
  }

  async download(url, dest, total = 0) {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const part = `${dest}.part`
    let start = 0
    if (fs.existsSync(part)) start = fs.statSync(part).size
    if (fs.existsSync(dest) && total && fs.statSync(dest).size >= total) {
      return { skipped: true, bytes: fs.statSync(dest).size }
    }
    const headers = { 'User-Agent': 'Lintools/1.0' }
    if (start > 0) headers.Range = `bytes=${start}-`
    return new Promise((resolve, reject) => {
      const go = (u, depth) => {
        if (depth > 5) return reject(new Error('重定向次数过多'))
        const req = https.get(u, { headers }, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume()
            go(res.headers.location, depth + 1)
            return
          }
          if (res.statusCode === 416) {
            res.resume()
            try {
              fs.renameSync(part, dest)
            } catch {
              /* ignore */
            }
            resolve({ bytes: total })
            return
          }
          if (res.statusCode !== 200 && res.statusCode !== 206) {
            res.resume()
            reject(new Error(`下载失败 HTTP ${res.statusCode}`))
            return
          }
          const len = Number(res.headers['content-length'] || 0)
          const totalBytes = total || len + start
          let got = start
          const ws = fs.createWriteStream(part, { flags: start > 0 ? 'a' : 'w' })
          let last = 0
          res.on('data', (chunk) => {
            if (this.canceled) {
              res.destroy()
              ws.end()
              return
            }
            got += chunk.length
            const now = Date.now()
            if (now - last > 400) {
              last = now
              this.onProgress({
                file: path.basename(dest),
                received: got,
                total: totalBytes,
                percent: totalBytes ? Math.min(100, (got / totalBytes) * 100) : 0,
              })
            }
          })
          res.pipe(ws)
          ws.on('error', (e) => {
            if (this.canceled) return resolve({ bytes: got, canceled: true })
            reject(e)
          })
          ws.on('finish', () => {
            if (this.canceled) return resolve({ bytes: got, canceled: true })
            try {
              fs.renameSync(part, dest)
            } catch (e) {
              return reject(e)
            }
            this.onProgress({ file: path.basename(dest), received: got, total: totalBytes, percent: 100 })
            resolve({ bytes: got })
          })
          res.on('error', (e) => { if (this.canceled) return resolve({ bytes: got, canceled: true }); reject(e) })
        })
        req.setTimeout(60000, () => req.destroy(new Error('下载超时')))
        req.on('error', reject)
      }
      go(url, 0)
    })
  }

  /** 只下三件套，precision 为 int8（省显存）或 bf16 */
  async fetchAll(repo, precision = 'int8') {
    if (this.active) throw new Error('已经有一轮下载在进行中')
    this.active = true
    this.canceled = false
    try {
      const list = await this.listRepo(repo)
      const plan = pickPlan(list.files, precision)
      if (!plan.files.length) throw new Error('仓库里没有匹配的权重组合')
      const results = []
      for (const f of plan.files) {
        if (this.canceled) break
        const dest = path.join(this.modelsDir(f.kind), path.basename(f.path))
        this.onProgress({ file: path.basename(f.path), received: 0, total: f.bytes, percent: 0, stage: 'start' })
        try {
          const r = await this.downloadOne(list.host, list.repo, f, dest)
          results.push({ ...f, dest, ok: true, bytes: r.bytes })
        } catch (e) {
          // 主站失败就换另一个镜像再试一次
          let ok = false
          for (const host of HOSTS.filter((h) => h !== list.host)) {
            try {
              const r2 = await this.downloadOne(host, list.repo, f, dest)
              results.push({ ...f, dest, ok: true, bytes: r2.bytes })
              ok = true
              break
            } catch {
              /* try next */
            }
          }
          if (!ok) results.push({ ...f, dest, ok: false, error: e instanceof Error ? e.message : String(e) })
          if (this.canceled) break
        }
      }
      return { ok: results.some((r) => r.ok), canceled: this.canceled, precision: plan.precision, results, installed: this.installed() }
    } finally {
      this.active = false
    }
  }
}

module.exports = { LocalModelManager, classify, DEFAULT_REPO }
