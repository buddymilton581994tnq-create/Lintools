'use strict'
/**
 * ComfyUI 接入层：只走本机（或局域网）HTTP，不装任何额外东西。
 *  - 状态检测：/system_stats（顺带拿到显卡型号和显存，比系统探测准）
 *  - 模型清单：/object_info（Checkpoint / LoRA / ControlNet / 放大模型 / Flux 组件）
 *  - 执行：POST /prompt 排队，/history 轮询结果，/view 取图，/upload/image 传图
 *  - 硬件探测：内存与 CPU 用 os 模块，显卡优先 nvidia-smi，兜底 PowerShell CIM
 */
const os = require('os')
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const { spawn } = require('child_process')
const res = require('./resilience.cjs')

const DEFAULT_BASE = 'http://127.0.0.1:8188'

function normBase(u) {
  let s = String(u || '').trim().replace(/\/+$/, '')
  if (!s) s = DEFAULT_BASE
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s
  return s
}

async function fetchJson(url, timeoutMs = 5000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(url, { signal: ctrl.signal })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return await resp.json()
  } finally {
    clearTimeout(timer)
  }
}

/** ComfyUI 在线状态 + 它认到的显卡（显存以它报的为准） */
async function getStatus(base) {
  const b = normBase(base)
  try {
    const j = await fetchJson(`${b}/system_stats`, 4000)
    const devices = Array.isArray(j.devices) ? j.devices : []
    return {
      online: true,
      base: b,
      os: j.system?.os || '',
      comfyVersion: j.system?.comfyui_version || '',
      gpus: devices
        .filter((d) => d && (d.type === 'cuda' || d.vram_total))
        .map((d) => ({
          name: String(d.name || 'cuda').replace(/^cuda:?\d*\s*/i, ''),
          vramGb: Math.round(((d.vram_total || 0) / 1024 ** 3) * 10) / 10,
          vramFreeGb: Math.round(((d.vram_free || 0) / 1024 ** 3) * 10) / 10,
        })),
    }
  } catch (e) {
    return { online: false, base: b, error: e instanceof Error ? e.message : String(e), gpus: [] }
  }
}

/** 从 /object_info 里挑出各加载器可用的模型文件名清单 */
async function getModelLists(base) {
  const b = normBase(base)
  const j = await fetchJson(`${b}/object_info`, 10000)
  const pick = (node, field) => {
    const v = j?.[node]?.input?.required?.[field]?.[0]
    return Array.isArray(v) ? v.map(String) : []
  }
  return {
    checkpoints: pick('CheckpointLoaderSimple', 'ckpt_name'),
    loras: pick('LoraLoader', 'lora_name'),
    controlnets: pick('ControlNetLoader', 'control_net_name'),
    upscaleModels: pick('UpscaleModelLoader', 'model_name'),
    vaes: pick('VAELoader', 'vae_name'),
    unets: pick('UNETLoader', 'unet_name'),
    clips: pick('DualCLIPLoader', 'clip_name1'),
  }
}

/** 提交一个工作流（API 格式 JSON），返回 prompt_id（不传固定 client_id，确保所有画布前端 WebSocket 都能实时收到节点执行高亮与预览图） */
async function queuePrompt(base, prompt) {
  const b = normBase(base)
  const resp = await fetch(`${b}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  const text = await resp.text()
  let j = null
  try {
    j = JSON.parse(text)
  } catch {
    /* ignore */
  }
  if (!resp.ok) {
    const msg = j?.error?.message || j?.error || text.slice(0, 300)
    const nodeErrors = j?.node_errors ? `（${Object.keys(j.node_errors).length} 个节点报错，多半是模型没选对）` : ''
    throw new Error(`ComfyUI 拒绝了工作流：${msg}${nodeErrors}`)
  }
  return { promptId: j.prompt_id }
}

/** 查执行结果；返回 null 表示还没跑完 */
async function getHistory(base, promptId) {
  const b = normBase(base)
  const j = await fetchJson(`${b}/history/${promptId}`, 5000)
  const entry = j?.[promptId]
  if (!entry) return null
  const status = entry.status || {}
  const images = []
  for (const nodeOut of Object.values(entry.outputs || {})) {
    for (const im of nodeOut.images || []) {
      images.push({ filename: im.filename, subfolder: im.subfolder || '', type: im.type || 'output' })
    }
  }
  return {
    completed: !!status.completed,
    statusStr: status.status_str || '',
    messages: (status.messages || []).map((m) => (Array.isArray(m) ? m.join(' ') : String(m))),
    images,
  }
}

/** 取一张结果图，转成 data URL 给界面直接显示 */
async function fetchImage(base, image) {
  const b = normBase(base)
  const q = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder || '',
    type: image.type || 'output',
  })
  const resp = await fetch(`${b}/view?${q.toString()}`)
  if (!resp.ok) throw new Error(`取图失败 HTTP ${resp.status}`)
  const buf = Buffer.from(await resp.arrayBuffer())
  const ext = (image.filename.split('.').pop() || 'png').toLowerCase()
  const mime = ext === 'webp' ? 'image/webp' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
  return `data:${mime};base64,${buf.toString('base64')}`
}

const _PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

function ensureDefaultInputImages(comfyRoot) {
  try {
    if (!comfyRoot || !fs.existsSync(comfyRoot)) return
    const inDir = path.join(comfyRoot, 'input')
    fs.mkdirSync(inDir, { recursive: true })
    for (const name of ['lintools-input.png', 'lintools-chain.png', 'lintools-ref.png']) {
      const f = path.join(inDir, name)
      if (!fs.existsSync(f)) fs.writeFileSync(f, _PLACEHOLDER_PNG)
    }
  } catch {
    /* ignore */
  }
}

/** 把一张图（data URL）传进 ComfyUI 的 input 目录，返回 LoadImage 可用的文件名 */
async function uploadImage(base, dataUrl, name) {
  const b = normBase(base)
  let raw = String(dataUrl || '')
  if (/^https?:\/\//i.test(raw)) {
    const r = await fetch(raw, { signal: AbortSignal.timeout(60000) })
    if (!r.ok) throw new Error(`下载远程图像失败 HTTP ${r.status}`)
    const mime = r.headers.get('content-type') || 'image/png'
    const buf = Buffer.from(await r.arrayBuffer())
    raw = `data:${mime};base64,${buf.toString('base64')}`
  }
  const m = /^data:([^;]+);base64,(.+)$/.exec(raw)
  if (!m) throw new Error('图片数据格式不对')
  const buf = Buffer.from(m[2], 'base64')
  const form = new FormData()
  form.append('image', new Blob([buf], { type: m[1] }), name || `lintools-${Date.now()}.png`)
  form.append('overwrite', 'true')
  const resp = await fetch(`${b}/upload/image`, { method: 'POST', body: form })
  const j = await resp.json().catch(() => null)
  if (!resp.ok || !j?.name) throw new Error('传图失败')
  return { name: j.name, subfolder: j.subfolder || '' }
}

/** 打断当前正在跑的工作流 */
async function interrupt(base) {
  const b = normBase(base)
  try {
    await fetch(`${b}/interrupt`, { method: 'POST' })
    return { ok: true, base: b }
  } catch (e) {
    return { ok: false, base: b, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 动态注入 AI 导演参数或用户手调参数到工作流 JSON 中（自动识别 KSampler / BasicScheduler / CLIPTextEncode 正反向节点）
 */
function injectWorkflowParams(workflowJson, customParams = {}) {
  if (!workflowJson || typeof workflowJson !== 'object') return workflowJson
  const next = JSON.parse(JSON.stringify(workflowJson))
  const posNodeIds = new Set()
  const negNodeIds = new Set()

  for (const [, node] of Object.entries(next)) {
    if (!node || typeof node !== 'object' || !node.inputs) continue
    const ct = String(node.class_type || '')
    if (/KSampler|SamplerCustom/i.test(ct)) {
      if (customParams.denoise !== undefined && Number.isFinite(Number(customParams.denoise))) {
        node.inputs.denoise = Number(customParams.denoise)
      }
      if (customParams.steps !== undefined && Number.isFinite(Number(customParams.steps))) {
        node.inputs.steps = Math.round(Number(customParams.steps))
      }
      if (customParams.cfg !== undefined && Number.isFinite(Number(customParams.cfg))) {
        node.inputs.cfg = Number(customParams.cfg)
      }
      if (customParams.sampler && typeof node.inputs.sampler_name === 'string') {
        node.inputs.sampler_name = String(customParams.sampler)
      }
      if (customParams.scheduler && typeof node.inputs.scheduler === 'string') {
        node.inputs.scheduler = String(customParams.scheduler)
      }
      if (Array.isArray(node.inputs.positive) && node.inputs.positive[0] !== undefined) {
        posNodeIds.add(String(node.inputs.positive[0]))
      }
      if (Array.isArray(node.inputs.negative) && node.inputs.negative[0] !== undefined) {
        negNodeIds.add(String(node.inputs.negative[0]))
      }
    } else if (ct === 'BasicScheduler') {
      if (customParams.denoise !== undefined && Number.isFinite(Number(customParams.denoise))) {
        node.inputs.denoise = Number(customParams.denoise)
      }
      if (customParams.steps !== undefined && Number.isFinite(Number(customParams.steps))) {
        node.inputs.steps = Math.round(Number(customParams.steps))
      }
      if (customParams.scheduler && typeof node.inputs.scheduler === 'string') {
        node.inputs.scheduler = String(customParams.scheduler)
      }
    } else if (ct === 'BasicGuider' && Array.isArray(node.inputs.conditioning)) {
      posNodeIds.add(String(node.inputs.conditioning[0]))
    }
  }

  const posAppend = String(customParams.positive_prompt_append || '').trim()
  const negAppend = String(customParams.negative_prompt_append || '').trim()
  const fullPositive = customParams.full_positive !== undefined ? String(customParams.full_positive).trim() : null
  const fullNegative = customParams.full_negative !== undefined ? String(customParams.full_negative).trim() : null

  for (const id of posNodeIds) {
    const n = next[id]
    if (n && n.inputs && typeof n.inputs.text === 'string') {
      if (fullPositive !== null) {
        n.inputs.text = fullPositive
      } else if (posAppend && !n.inputs.text.toLowerCase().includes(posAppend.toLowerCase())) {
        n.inputs.text = n.inputs.text.trim() ? `${n.inputs.text.trim()}, ${posAppend}` : posAppend
      }
    }
  }
  for (const id of negNodeIds) {
    const n = next[id]
    if (n && n.inputs && typeof n.inputs.text === 'string') {
      if (fullNegative !== null) {
        n.inputs.text = fullNegative
      } else if (negAppend && !n.inputs.text.toLowerCase().includes(negAppend.toLowerCase())) {
        n.inputs.text = n.inputs.text.trim() ? `${n.inputs.text.trim()}, ${negAppend}` : negAppend
      }
    }
  }
  return next
}

/**
 * 通用智能工作流提交：1. 前置检查连通性 2. 动态注入参数 3. 提交至当前指定的 ComfyUI 端口
 */
async function submitSmartTask(base, workflowData, customParams = null) {
  const st = await getStatus(base)
  if (!st.online) {
    return {
      status: 'error',
      online: false,
      targetUrl: st.base,
      message: `无法连接到 ComfyUI [${st.base}]，请先点击【后台启动 ComfyUI】或检查端口配置。详细原因: ${st.error || '连接超时'}`,
    }
  }
  try {
    const injected = customParams ? injectWorkflowParams(workflowData, customParams) : workflowData
    const resQueue = await queuePrompt(st.base, injected)
    return {
      status: 'success',
      online: true,
      promptId: resQueue.promptId,
      targetUrl: st.base,
      workflow: injected,
    }
  } catch (e) {
    return {
      status: 'error',
      online: true,
      targetUrl: st.base,
      message: e instanceof Error ? e.message : String(e),
    }
  }
}

// ---------------------------------------------------------------------------
// 硬件探测：探测本体在 resilience.cjs，这里只做出口
// ---------------------------------------------------------------------------

async function probeHardware() {
  const cpus = os.cpus()
  const gpus = await res.probeGpus()
  return {
    totalRamGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    freeRamGb: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
    cpuModel: cpus[0]?.model?.trim() || '未知 CPU',
    cpuCores: cpus.length,
    gpus,
  }
}

module.exports = {
  DEFAULT_BASE,
  normBase,
  getStatus,
  getModelLists,
  queuePrompt,
  getHistory,
  fetchImage,
  uploadImage,
  ensureDefaultInputImages,
  interrupt,
  injectWorkflowParams,
  submitSmartTask,
  probeHardware,
  // ComfyUIEngine 在文件末尾补充导出（class 不提升）
}

// ---------------------------------------------------------------------------
// 内置 ComfyUI 引擎：一键下载官方便携版 + 默认底模 + 放大模型，自动解压启动。
// 和本地 DS 模型同一套哲学：不选路径、不装环境、点一下就能用。
// ---------------------------------------------------------------------------

const PORTABLE_URLS = [
  'https://ghproxy.net/https://github.com/Comfy-Org/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia.7z',
  'https://gh-proxy.com/https://github.com/Comfy-Org/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia.7z',
  'https://ghfast.top/https://github.com/Comfy-Org/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia.7z',
  'https://ghp.ci/https://github.com/Comfy-Org/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia.7z',
  'https://github.com/Comfy-Org/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia.7z',
  'https://github.com/comfyanonymous/ComfyUI/releases/latest/download/ComfyUI_windows_portable_nvidia.7z',
]
const PORTABLE_BYTES = Math.round(1.6 * 1024 ** 3)

const CKPT_FILE = 'DreamShaper_8_pruned.safetensors'
const CKPT_URLS = [
  `https://hf-mirror.com/Lykon/DreamShaper/resolve/main/${CKPT_FILE}`,
  `https://huggingface.co/Lykon/DreamShaper/resolve/main/${CKPT_FILE}`,
]
const CKPT_BYTES = Math.round(1.99 * 1024 ** 3)

const UPSCALE_FILE = '4x-UltraSharp.pth'
const UPSCALE_URLS = [
  `https://hf-mirror.com/lokCX/4x-Ultrasharp/resolve/main/${UPSCALE_FILE}`,
  `https://huggingface.co/lokCX/4x-Ultrasharp/resolve/main/${UPSCALE_FILE}`,
]
const UPSCALE_BYTES = Math.round(64 * 1024 ** 2)

function fileSizeOf(p) {
  try {
    return fs.statSync(p).size
  } catch {
    return 0
  }
}

/** 断点续传下载（与本地模型同一套）；signal 用于暂停 */
function fetchToFile(url, dest, onChunk, redirects = 0, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('已暂停'))
    const part = dest + '.part'
    const already = fileSizeOf(part)
    const headers = already > 0 ? { Range: `bytes=${already}-` } : {}
    const mod = url.startsWith('https:') ? https : http
    const req = mod.get(url, { headers, timeout: 45000 }, (res2) => {
      const { statusCode } = res2
      if ([301, 302, 303, 307, 308].includes(statusCode) && res2.headers.location) {
        res2.resume()
        if (redirects > 6) return reject(new Error('下载跳转太多次'))
        return fetchToFile(new URL(res2.headers.location, url).toString(), dest, onChunk, redirects + 1, signal).then(resolve, reject)
      }
      if (statusCode === 416) {
        res2.resume()
        fs.renameSync(part, dest)
        return resolve(dest)
      }
      if (statusCode !== 200 && statusCode !== 206) {
        res2.resume()
        return reject(new Error(`下载失败 ${statusCode}`))
      }
      const isResume = statusCode === 206
      const total = (isResume ? already : 0) + Number(res2.headers['content-length'] || 0)
      let received = isResume ? already : 0
      const out = fs.createWriteStream(part, { flags: isResume ? 'a' : 'w' })
      res2.on('data', (c) => {
        received += c.length
        onChunk(received, total)
      })
      res2.pipe(out)
      out.on('finish', () =>
        out.close(() => {
          const got = fileSizeOf(part)
          if (total > 0 && got < total) return reject(new Error('下载中断了'))
          fs.renameSync(part, dest)
          resolve(dest)
        }),
      )
      out.on('error', reject)
      res2.on('error', reject)
    })
    const onAbort = () => req.destroy(new Error('已暂停'))
    signal?.addEventListener('abort', onAbort, { once: true })
    req.on('close', () => signal?.removeEventListener('abort', onAbort))
    req.on('timeout', () => req.destroy(new Error('下载超时')))
    req.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// 并行分块下载：同一文件开 8 条连接各下一截。
// 国内家庭宽带单线程连 GitHub/镜像经常被限速到几百 KB，
// 8 条并发一般能跑到带宽上限，1.6GB 的本体从「一小时」变「几分钟」。
// ---------------------------------------------------------------------------

/** 探测最终地址与文件大小，确认支持 Range 分块 */
function probeRemote(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http
    const req = mod.get(url, { headers: { Range: 'bytes=0-0' }, timeout: 15000 }, (res2) => {
      const { statusCode } = res2
      if ([301, 302, 303, 307, 308].includes(statusCode) && res2.headers.location) {
        res2.resume()
        if (redirects > 6) return reject(new Error('跳转太多次'))
        return probeRemote(new URL(res2.headers.location, url).toString(), redirects + 1).then(resolve, reject)
      }
      res2.resume()
      if (statusCode === 206) {
        const m = /\/(\d+)\s*$/.exec(res2.headers['content-range'] || '')
        return resolve({ url, size: m ? Number(m[1]) : 0, ranges: true })
      }
      if (statusCode === 200) {
        return resolve({ url, size: Number(res2.headers['content-length'] || 0), ranges: false })
      }
      reject(new Error(`探测失败 ${statusCode}`))
    })
    req.on('timeout', () => req.destroy(new Error('探测超时')))
    req.on('error', reject)
  })
}

/** 下一次区间：从服务器要 [start, end]，写到文件的 fileOffset 处。
 *  分开传是因为并行下载时每个分块是独立小文件，文件内偏移从 0 开始，
 *  而服务器要的仍是整文件里的绝对位置。 */
function dlRangeOnce(url, file, start, end, onData, signal, redirects = 0, fileOffset = start) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('已暂停'))
    const mod = url.startsWith('https:') ? https : http
    const req = mod.get(url, { headers: { Range: `bytes=${start}-${end}` }, timeout: 45000 }, (res2) => {
      const { statusCode } = res2
      if ([301, 302, 303, 307, 308].includes(statusCode) && res2.headers.location) {
        res2.resume()
        if (redirects > 6) return reject(new Error('跳转太多次'))
        return dlRangeOnce(new URL(res2.headers.location, url).toString(), file, start, end, onData, signal, redirects + 1, fileOffset).then(resolve, reject)
      }
      if (statusCode !== 206 && !(statusCode === 200 && start === 0)) {
        res2.resume()
        return reject(new Error(`分块下载失败 ${statusCode}`))
      }
      const out = fs.createWriteStream(file, { flags: 'r+', start: fileOffset })
      res2.on('data', (c) => onData(c.length))
      res2.pipe(out)
      out.on('finish', () => out.close(() => resolve()))
      out.on('error', reject)
      res2.on('error', (e) => {
        out.destroy()
        reject(e)
      })
    })
    const onAbort = () => req.destroy(new Error('已暂停'))
    signal?.addEventListener('abort', onAbort, { once: true })
    req.on('close', () => signal?.removeEventListener('abort', onAbort))
    req.on('timeout', () => req.destroy(new Error('分块超时')))
    req.on('error', reject)
  })
}

/** 下载文件的一个区间，失败从中断处接着来，最多 5 次 */
async function dlRange(url, file, start, end, onData, signal) {
  let cur = start
  const track = (n) => {
    cur += n
    onData(n)
  }
  let lastErr = null
  for (let attempt = 1; attempt <= 5 && cur <= end; attempt++) {
    if (signal?.aborted) throw new Error('已暂停')
    try {
      await dlRangeOnce(url, file, cur, end, track, signal)
    } catch (e) {
      lastErr = e
      if (signal?.aborted) throw new Error('已暂停')
      await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * attempt)))
    }
  }
  if (cur <= end) throw lastErr || new Error('分块没下完')
}

/** 确保 chunk 文件存在且长度正好是 len（旧版分块下载用，已不再使用） */

/** 并行下载：单个文件预先按远端大小建好，8 条连接各写自己那一段（按绝对偏移写）。
 *  每段的完成量记在 sidecar 里，断电/关软件/暂停后重新点，按记录从断点续，
 *  已经下到的字节一个都不浪费；文件大小天然等于远端大小，不用拼接，也就不会有拼错的风险。 */
async function fetchToFileParallel(url, dest, onChunk, opts = {}) {
  const signal = opts.signal
  const info = await probeRemote(url)
  if (!info.ranges || !info.size) return fetchToFile(url, dest, onChunk, 0, signal)

  const conns = opts.conns || 8
  const scratch = dest + '.pdl'
  const sidecar = scratch + '.json'
  const chunkSize = Math.ceil(info.size / conns)

  let ranges = []
  try {
    for (let i = 0; i < conns; i++) {
      const s0 = i * chunkSize
      const e0 = Math.min(info.size - 1, s0 + chunkSize - 1)
      if (s0 > e0) break
      ranges.push({ start: s0, end: e0 })
    }
  } catch {
    return fetchToFile(url, dest, onChunk, 0, signal)
  }

  // 上次的进度（大小或段数对不上就作废重来）
  let done = []
  try {
    const saved = JSON.parse(fs.readFileSync(sidecar, 'utf8'))
    if (saved && saved.size === info.size && Array.isArray(saved.done) && saved.done.length === ranges.length) {
      done = saved.done.map((n, i) => Math.max(0, Math.min(Number(n) || 0, ranges[i].end - ranges[i].start + 1)))
    }
  } catch {
    /* 没有就算了 */
  }
  if (done.length !== ranges.length) done = ranges.map(() => 0)

  // 预建文件（长度=远端大小），并保证已有内容不被截断
  if (!fs.existsSync(scratch) || fileSizeOf(scratch) !== info.size) {
    fs.writeFileSync(scratch, Buffer.alloc(0))
    fs.truncateSync(scratch, info.size)
    done = ranges.map(() => 0)
  }
  const flush = () => {
    try {
      fs.writeFileSync(sidecar, JSON.stringify({ size: info.size, done, url: info.url }), 'utf8')
    } catch {
      /* ignore */
    }
  }

  let received = done.reduce((a, b) => a + b, 0)
  const bump = (i, n) => {
    done[i] += n
    received += n
    onChunk(received, info.size)
  }
  flush()

  const jobs = ranges.map(async (r, i) => {
    const total = r.end - r.start + 1
    for (let attempt = 1; attempt <= 6 && done[i] < total; attempt++) {
      if (signal?.aborted) throw new Error('已暂停')
      const serverFrom = r.start + done[i]
      const fileOffset = serverFrom
      const before = done[i]
      let got = 0
      try {
        await dlRangeOnce(
          info.url,
          scratch,
          serverFrom,
          r.end,
          (n) => {
            got += n
            bump(i, n)
          },
          signal,
          0,
          fileOffset,
        )
        if (done[i] < before + got) done[i] = Math.min(before + got, total)
        flush()
      } catch (e) {
        flush()
        if (signal?.aborted) throw new Error('已暂停')
        if (attempt === 6) throw e
        await new Promise((res2) => setTimeout(res2, Math.min(15000, 800 * attempt)))
      }
    }
    if (done[i] < total) throw new Error('分块没下完')
  })

  await Promise.all(jobs).catch((e) => {
    flush()
    throw e
  })
  if (fileSizeOf(scratch) !== info.size) throw new Error('合并后大小和远端不一致，重新下载')
  fs.rmSync(dest, { force: true })
  fs.renameSync(scratch, dest)
  fs.rmSync(sidecar, { force: true })
  return dest
}

/** 多镜像轮询 + 单个源最多重试 5 次：下载中断不丢人，接着续就行。
    opts.parallel 时优先并行分块（大文件提速明显），失败自动退回单线程续传。 */
async function fetchWithRetry(urls, dest, onChunk, perUrlRetries = 5, opts = {}) {
  let lastErr = null
  for (const url of urls) {
    for (let attempt = 1; attempt <= perUrlRetries; attempt++) {
      if (opts.signal?.aborted) throw new Error('已暂停')
      try {
        if (opts.parallel) {
          try {
            return await fetchToFileParallel(url, dest, onChunk, opts)
          } catch (e) {
            if (opts.signal?.aborted) throw e
            /* 并行没跑成，退回单线程断点续传 */
          }
        }
        return await fetchToFile(url, dest, onChunk, 0, opts.signal)
      } catch (e) {
        lastErr = e
        if (opts.signal?.aborted || (e instanceof Error && e.message === '已暂停')) throw new Error('已暂停')
        // 网络抖动很常见，歇口气再续
        await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * attempt)))
      }
    }
  }
  throw lastErr || new Error('所有镜像源都失败了')
}

/** 找一个能用的 7-Zip 可执行文件：系统装过 7-Zip 就用它，比 Windows 自带的 tar 稳得多 */
function find7zExe() {
  const cands = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip', '7z.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', '7-Zip', '7z.exe'),
    'C:\\Program Files\\7-Zip\\7z.exe',
    '7z.exe',
  ]
  for (const c of cands) {
    try {
      if (c === '7z.exe' || fs.existsSync(c)) return c
    } catch {
      /* ignore */
    }
  }
  return null
}

/** 解压 .7z：优先用 7-Zip（装过的话），否则退回 Windows 自带的 bsdtar。
 *  两者都失败时把 stderr 带出来，方便一眼看出卡在哪。 */
function extract7z(archive, destDir, onLog) {
  const log = onLog || (() => {})
  const run = (cmd, args) =>
    new Promise((resolve, reject) => {
      const ps = spawn(cmd, args, { windowsHide: true, env: res.cleanChildEnv() })
      let err = ''
      const dec = new TextDecoder('gbk')
      ps.stderr.on('data', (c) => (err += dec.decode(c, { stream: true })))
      ps.on('error', reject)
      ps.on('close', (code) => {
        const tail = err.trim().slice(-400)
        if (code === 0) resolve(destDir)
        else reject(new Error(`解压失败（${cmd} 退出码 ${code}）${tail ? '：' + tail : ''}`))
      })
    })
  return (async () => {
    fs.mkdirSync(destDir, { recursive: true })
    const sevenZip = find7zExe()
    if (sevenZip) {
      try {
        log(`用 7-Zip 解压：${archive}`)
        return await run(sevenZip, ['x', '-y', `-o${destDir}`, archive])
      } catch (e) {
        log(`7-Zip 解压没成功，改用系统 tar 再试：${e instanceof Error ? e.message : e}`)
      }
    }
    log(`用系统 tar 解压：${archive}`)
    return run('tar', ['-xf', archive, '-C', destDir])
  })()
}

/** 快速校验压缩包是不是个能读的 7z（只列目录不真正解压，几秒钟完事） */
function test7z(archive) {
  const tryCmd = (cmd, args) =>
    new Promise((resolve) => {
      let ps
      try {
        ps = spawn(cmd, args, { windowsHide: true, env: res.cleanChildEnv() })
      } catch {
        return resolve(false)
      }
      ps.on('error', () => resolve(false))
      ps.on('close', (code) => resolve(code === 0))
    })
  return (async () => {
    if (!fs.existsSync(archive) || fileSizeOf(archive) < 1024 * 1024) return false
    const sevenZip = find7zExe()
    if (sevenZip && (await tryCmd(sevenZip, ['t', archive]))) return true
    return tryCmd('tar', ['-tf', archive])
  })()
}

/** 递归找 python.exe / ComfyUI 的 main.py（最多往下 4 层） */
function findDeep(root, name, depth = 4) {
  if (depth < 0) return null
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return null
  }
  // 先看当前层，再看子目录，浅的优先
  for (const e of entries) {
    if (!e.isDirectory() && e.name.toLowerCase() === name.toLowerCase()) {
      const full = path.join(root, e.name)
      if (fileSizeOf(full) > 40 * 1024) return full
    }
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (/^(__pycache__|node_modules|\.git)$/i.test(e.name)) continue
    const found = findDeep(path.join(root, e.name), name, depth - 1)
    if (found) return found
  }
  return null
}

/** 把一个目录里的东西并到另一个目录：同名目录递归合并，同名文件以来源为准。
 *  解压重试时经常出现「多套了一层，且外层已经有同名目录」，直接跳过会把真东西漏在里面。 */
function mergeDirInto(fromDir, toDir, log = () => {}) {
  fs.mkdirSync(toDir, { recursive: true })
  let entries
  try {
    entries = fs.readdirSync(fromDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const src = path.join(fromDir, e.name)
    const dst = path.join(toDir, e.name)
    if (e.isDirectory()) {
      if (fs.existsSync(dst) && fs.statSync(dst).isDirectory()) mergeDirInto(src, dst, log)
      else {
        try {
          fs.renameSync(src, dst)
        } catch {
          mergeDirInto(src, dst, log)
          fs.rmSync(src, { recursive: true, force: true })
        }
      }
    } else {
      try {
        fs.rmSync(dst, { force: true })
        fs.renameSync(src, dst)
      } catch {
        try {
          fs.copyFileSync(src, dst)
          fs.rmSync(src, { force: true })
        } catch {
          log(`合并文件失败：${e.name}`)
        }
      }
    }
  }
}

/** 官方便携包解压出来会多套一层 ComfyUI_windows_portable 目录，摊平成便携根目录。
 *  现在不再写死那一层名字：不管多套几层，只要认出 main.py 和 python.exe，
 *  就把它们所在的那一层整体提到 portableDir 下（同名目录递归合并，不丢东西）。 */
function flattenPortableDir(portableDir, onLog) {
  const log = onLog || (() => {})
  const known = path.join(portableDir, 'ComfyUI_windows_portable')
  if (fs.existsSync(known)) {
    log('检测到 ComfyUI_windows_portable 这一层，正在摊平')
    mergeDirInto(known, portableDir, log)
    try {
      fs.rmSync(known, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    return
  }
  if (fileSizeOf(path.join(portableDir, 'python_embeded', 'python.exe')) > 40 * 1024 && fileSizeOf(path.join(portableDir, 'ComfyUI', 'main.py')) > 1024) return
  // 兜底：无论套了几层，找到 main.py 的 ComfyUI 目录，把它的上一级当成便携根
  const main = findDeep(portableDir, 'main.py', 4)
  if (!main) return
  const comfyDir = path.dirname(main)
  if (path.basename(comfyDir).toLowerCase() !== 'comfyui') return
  const rootOfComfy = path.dirname(comfyDir)
  if (path.resolve(rootOfComfy) === path.resolve(portableDir)) return
  log(`检测到多套了一层目录（${path.basename(rootOfComfy)}），正在摊平`)
  mergeDirInto(rootOfComfy, portableDir, log)
  try {
    fs.rmSync(rootOfComfy, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

class ComfyUIEngine {
  constructor(opts) {
    this.dataDir = opts.dataDir
    // 外部安装（比如秋叶整合包）：{ root, pythonExe, mainPy }，有它就不用内置便携版
    this.external = opts.external || null
    this.onProgress = opts.onProgress || (() => {})
    this.onStatus = opts.onStatus || (() => {})
    this.proc = null
    this.error = ''
    this.busy = null
    this.state = this.isInstalled() ? 'stopped' : 'uninstalled'
  }

  get portableDir() {
    return this.external ? this.external.root : path.join(this.dataDir, 'portable')
  }
  get pythonExe() {
    return this.external ? this.external.pythonExe : path.join(this.portableDir, 'python_embeded', 'python.exe')
  }
  get mainPy() {
    return this.external ? this.external.mainPy : path.join(this.portableDir, 'ComfyUI', 'main.py')
  }
  get comfyRoot() {
    return path.dirname(this.mainPy)
  }
  get ckptDir() {
    return path.join(this.comfyRoot, 'models', 'checkpoints')
  }
  get upscaleDir() {
    return path.join(this.comfyRoot, 'models', 'upscale_models')
  }

  isInstalled() {
    // 注意：官方便携包和秋叶整合包里的 python.exe 是嵌入式解释器，只有 100KB 出头，
    // 早先按 1MB 卡会把装好的环境判成「不完整」，进而反复重下 1.6GB 本体。
    return fileSizeOf(this.pythonExe) > 40 * 1024 && fileSizeOf(this.mainPy) > 1024
  }
  hasCheckpoint() {
    try {
      return fs.readdirSync(this.ckptDir).some((f) => /\.(safetensors|ckpt|pth)$/i.test(f) && fileSizeOf(path.join(this.ckptDir, f)) > 100 * 1024 * 1024)
    } catch {
      return false
    }
  }

  /** 画布桥扩展：左边切预设时把节点图推到 ComfyUI 前端用。
      它不是节点，只是 WEB_DIRECTORY 里的一个前端脚本，装好就被 ComfyUI 自动加载。 */
  get bridgeDir() {
    return path.join(this.comfyRoot, 'custom_nodes', 'LintoolsBridge')
  }

  installBridge() {
    try {
      const src = path.join(__dirname, 'comfy-ext', 'LintoolsBridge')
      if (!fs.existsSync(src) || !this.isInstalled()) return false
      ensureDefaultInputImages(this.comfyRoot)
      const dst = this.bridgeDir
      const pairs = [
        ['__init__.py'],
        ['web', 'lintools_bridge.js'],
      ]
      let need = pairs.some((p) => !fs.existsSync(path.join(dst, ...p)))
      if (!need) {
        for (const p of pairs) {
          const a = fs.readFileSync(path.join(src, ...p))
          const b = fs.readFileSync(path.join(dst, ...p))
          if (a.length !== b.length || !a.equals(b)) {
            need = true
            break
          }
        }
      }
      if (need) {
        fs.cpSync(src, dst, { recursive: true })
        this.deployLog(`画布桥已更新：${dst}`)
      }
      return true
    } catch (e) {
      this.deployLog(`画布桥安装失败：${e instanceof Error ? e.message : e}`)
      return false
    }
  }

  /** 已经解压过但目录套了一层（老版本半成品）：就地摊平，能救回来就不用重下 */
  recoverExistingTree() {    if (this.external) return false
    try {
      if (!fs.existsSync(this.portableDir)) return false
      flattenPortableDir(this.portableDir, (m) => this.deployLog(`[整理] ${m}`))
      return this.isInstalled()
    } catch (e) {
      this.deployLog(`整理旧目录失败：${e instanceof Error ? e.message : e}`)
      return false
    }
  }

  /** 磁盘上有没有上次没下完的残留（安装包 / .part / 并行分块 / 状态文件） */  hasPartialDownload() {
    try {
      if (this.isInstalled()) return false
      const files = fs.readdirSync(this.dataDir)
      return files.some(
        (f) =>
          f === 'download-state.json' ||
          f === 'comfyui-portable.7z' ||
          /\.(part|pdl|c\d+|joining|pdl\.json)$/i.test(f),
      )
    } catch {
      return false
    }
  }

  getStatus() {
    return {
      state: this.state,
      ready: this.state === 'ready',
      installed: this.isInstalled(),
      hasCheckpoint: this.hasCheckpoint(),
      error: this.error,
      dir: this.portableDir,
      external: !!this.external,
      base: this.base || DEFAULT_BASE,
      downloadBytes: PORTABLE_BYTES + CKPT_BYTES + UPSCALE_BYTES,
      partialDownload: this.hasPartialDownload(),
    }
  }

  setState(state, error = '') {
    if (this.state === state && this.error === error) return
    this.state = state
    this.error = error
    this.onStatus(this.getStatus())
  }

  throttle() {
    let last = -1
    return (p) => {
      // 0.1% 一跳：既刷得动进度条，又不至于刷屏 IPC
      const pct = Math.round((p.percent || 0) * 1000)
      if (pct === last && pct !== 1000) return
      last = pct
      this.onProgress(p)
    }
  }

  ensureReady() {
    if (this.busy) return this.busy
    this.busy = this._ensure().finally(() => {
      this.busy = null
    })
    return this.busy
  }

  async _ensure() {
    try {
      this.dlAbort = new AbortController()
      await this._deploy()
      await this.start()
      this.clearDownloadState()
      this.deployLog('=== 部署完成 ===')
      return this.getStatus()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === '已暂停') {
        // 用户主动暂停：不算错误，进度文件留着，下次点继续接着下
        this.setState('stopped')
        throw e
      }
      this.setState('error', msg)
      throw new Error(msg)
    }
  }

  /** 暂停下载：打断所有连接，已下载的部分留在磁盘上 */
  pause() {
    try {
      this.dlAbort?.abort()
    } catch {
      /* ignore */
    }
    return this.getStatus()
  }

  /** 清除下载缓存：只删半成品和压缩包，已解压好的本体不动 */
  purgeDownload() {
    try {
      this.dlAbort?.abort()
    } catch {
      /* ignore */
    }
    const leftovers = [
      'comfyui-portable.7z',
      'comfyui-portable.7z.part',
      'comfyui-portable.7z.pdl',
      'comfyui-portable.7z.pdl.json',
      'comfyui-portable.7z.joining',
      'vc_redist.x64.exe',
      'comfyui-manager.zip',
      'comfyui-manager.zip.part',
      'comfyui-manager.zip.pdl',
    ]
    for (const f of leftovers) {
      try {
        fs.rmSync(path.join(this.dataDir, f), { force: true })
      } catch {
        /* ignore */
      }
    }
    this.clearChunks(path.join(this.dataDir, 'comfyui-portable.7z'))
    const sweep = (dir) => {
      try {
        for (const f of fs.readdirSync(dir)) {
          if (/\.(part|pdl|pdl\.json|c\d+|joining)$/i.test(f)) fs.rmSync(path.join(dir, f), { force: true })
        }
      } catch {
        /* ignore */
      }
    }
    sweep(this.dataDir)
    sweep(this.ckptDir)
    sweep(this.upscaleDir)
    this.clearDownloadState()
    if (!this.isInstalled()) this.setState('uninstalled')
    return this.getStatus()
  }

  // ---- 部署诊断与续传状态 ----

  get logPath() {
    return path.join(this.dataDir, 'deploy.log')
  }

  /** 往部署日志里写一行（界面上看不到，出问题时拿它定位） */
  deployLog(msg) {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true })
      fs.appendFileSync(this.logPath, `[${new Date().toISOString()}] ${msg}\n`, 'utf8')
    } catch {
      /* ignore */
    }
  }

  /** 目录里有什么（解压异常时写进日志） */
  listTop() {
    try {
      return fs.readdirSync(this.portableDir).slice(0, 40).join(' | ')
    } catch {
      return '(读不到目录)'
    }
  }

  /** 删掉某个文件的并行分块残留 */
  clearChunks(dest) {
    for (let i = 0; i < 16; i++) {
      try {
        fs.rmSync(`${dest}.c${i}`, { force: true })
      } catch {
        /* ignore */
      }
    }
  }

  get statePath() {
    return path.join(this.dataDir, 'download-state.json')
  }

  saveDownloadState(extra) {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true })
      fs.writeFileSync(this.statePath, JSON.stringify({ ...extra, at: Date.now() }, null, 2), 'utf8')
    } catch {
      /* ignore */
    }
  }

  clearDownloadState() {
    try {
      fs.rmSync(this.statePath, { force: true })
    } catch {
      /* ignore */
    }
  }

  /** 上次有没有下到一半：压缩包/chunk/状态文件任一还在，就算 */
  readDownloadState() {
    try {
      return JSON.parse(fs.readFileSync(this.statePath, 'utf8'))
    } catch {
      return null
    }
  }

  /** Python 环境：能跑 + 能 import torch 就算就绪；缺依赖自动 pip 补 */
  async ensurePythonRuntime() {
    if (!this.isInstalled()) return { ok: false, error: '没找到自带的 Python' }
    const py = this.pythonExe
    const run = (args, timeout, onLine) =>
      new Promise((resolve) => {
        let out = ''
        const ps = spawn(py, args, { cwd: this.comfyRoot, windowsHide: true, env: res.cleanChildEnv() })
        const dec = new TextDecoder('gbk')
        ps.stdout?.on('data', (c) => {
          const t = dec.decode(c, { stream: true })
          out = (out + t).slice(-8000)
          onLine?.(t)
        })
        ps.stderr?.on('data', (c) => {
          const t = dec.decode(c, { stream: true })
          out = (out + t).slice(-8000)
          onLine?.(t)
        })
        const timer = setTimeout(() => {
          try {
            ps.kill()
          } catch {
            /* ignore */
          }
        }, timeout)
        ps.on('error', (e) => {
          clearTimeout(timer)
          resolve({ code: -1, out: e.message })
        })
        ps.on('close', (code) => {
          clearTimeout(timer)
          resolve({ code: code ?? -1, out })
        })
      })

    this.onProgress({ phase: 'python', label: '正在检查 Python 运行环境', percent: 0.02 })
    const ver = await run(['-s', '-c', 'import sys;print(sys.version.split()[0])'], 60000)
    this.deployLog(`Python 版本检测：code=${ver.code} ${ver.out.trim().slice(0, 200)}`)
    if (ver.code !== 0) {
      return { ok: false, error: `自带的 Python 跑不起来：${ver.out.trim().slice(0, 200)}` }
    }
    const torch = await run(['-s', '-c', 'import torch;print(torch.__version__)'], 120000)
    if (torch.code === 0) {
      this.deployLog(`torch 已就绪：${torch.out.trim().slice(0, 80)}`)
      this.onProgress({ phase: 'python', label: `Python ${ver.out.trim()} / torch ${torch.out.trim()} 就绪`, percent: 0.06 })
      return { ok: true }
    }
    // torch 缺失：按 requirements.txt 补依赖（便携包正常不会走到这里）
    this.deployLog('torch 缺失，尝试按 requirements.txt 安装依赖')
    this.onProgress({ phase: 'python', label: '正在补装 Python 依赖（第一次要几分钟）', percent: 0.03 })
    const req = path.join(this.comfyRoot, 'requirements.txt')
    const pipBase = ['-s', '-m', 'pip', 'install', '--no-warn-script-location', '-i', 'https://pypi.tuna.tsinghua.edu.cn/simple']
    if (fs.existsSync(req)) {
      const r = await run([...pipBase, '-r', req], 45 * 60 * 1000, (t) => {
        this.onProgress({ phase: 'python', label: `安装依赖：${t.trim().split('\n').pop()?.slice(0, 80) || '…'}`, percent: 0.03 })
      })
      this.deployLog(`pip install -r requirements.txt 退出码 ${r.code}`)
      if (r.code === 0) return { ok: true }
    }
    return { ok: false, error: 'Python 依赖没装上，可以先跑，遇到缺模块再补' }
  }

  async _deploy() {
    if (this.external) {
      // 导入的整合包：不下载东西，直接当作已部署
      if (!this.isInstalled()) throw new Error('导入的 ComfyUI 目录不完整，请重新选择')
      return
    }
    if (this.isInstalled() && this.hasCheckpoint()) return
    // 已经解压过、只是目录没摊平（老版本留下的半成品）：就地整理，不必重下 1.6GB
    if (!this.isInstalled() && this.recoverExistingTree()) {
      this.deployLog('检测到已解压但没摊平的目录，已就地整理好，跳过下载')
      this.clearChunks(path.join(this.dataDir, 'comfyui-portable.7z'))
      this.clearDownloadState()
    }
    if (this.isInstalled() && this.hasCheckpoint()) return

    // 显存探底：没够格的 N 卡就拦下，别让人白下 6GB
    try {
      const gpus = await res.probeGpus()
      const best = gpus.reduce((a, b) => (b.vramGb > (a?.vramGb || 0) ? b : a), null)
      const tier = res.gpuTier(best ? best.vramGb * 1024 : 0)
      if (tier.id === 'CLOUD_ONLY') {
        throw new Error(`没检测到 4G 显存以上的 N 卡，本地跑不动 ComfyUI。建议用云端 API 画图；有秋叶整合包的话用「导入已有的整合包」`)
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('显存')) throw e
      /* 探测失败不拦路，让用户自己决定 */
    }

    // 磁盘检查：解压后约 6GB，加模型共需 10GB 余量
    try {
      const st = fs.statfsSync(this.dataDir)
      const freeGb = (Number(st.bavail) * Number(st.bsize)) / 1024 ** 3
      if (freeGb < 10) throw new Error(`磁盘剩余空间不足（剩 ${freeGb.toFixed(1)}G，需要 10G 以上）`)
    } catch (e) {
      if (e instanceof Error && e.message.includes('磁盘')) throw e
      /* 读不到磁盘信息就继续 */
    }

    // VC 运行库：前端在一键部署前会弹窗问用户装不装，这里只提示不再静默装
    const vc = res.checkVcRuntime()
    if (!vc.ok) {
      this.onProgress({ phase: 'vcredist', label: '缺少系统运行库（VC++），若启动失败请重新部署并选择安装', percent: 0.05 })
    }

    fs.mkdirSync(this.dataDir, { recursive: true })
    this.deployLog(`=== 开始部署：${new Date().toLocaleString()} ===`)
    this.saveDownloadState({ phase: 'portable', at: Date.now() })

    // 1) 便携版本体
    if (!this.isInstalled()) {
      const archive = path.join(this.dataDir, 'comfyui-portable.7z')
      // 挨个镜像探一下真实大小（有的镜像不支持 Range 会返回 0，那就换下一个问）
      let expected = 0
      for (const u of PORTABLE_URLS) {
        try {
          const i = await probeRemote(u)
          if (i.size > 1024 * 1024) {
            expected = i.size
            break
          }
        } catch {
          /* 下一个镜像 */
        }
      }
      const have = fileSizeOf(archive)
      const needFetch = have < 1024 * 1024 || (expected > 0 && Math.abs(have - expected) > 4096)
      this.deployLog(`安装包现状：已有 ${(have / 1024 ** 3).toFixed(2)}G，远端 ${(expected / 1024 ** 3).toFixed(2)}G，${needFetch ? '需要（继续）下载' : '已下完'}`)
      if (needFetch) {
        this.setState('preparing')
        const push = this.throttle()
        const from = have > 1024 * 1024 ? `（从 ${(have / 1024 ** 3).toFixed(2)}G 处接着下）` : ''
        try {
          await fetchWithRetry(
            PORTABLE_URLS,
            archive,
            (got, total) =>
              push({ phase: 'portable', label: `正在下载 ComfyUI 本体${from}`, received: got, total, percent: total ? got / total : 0 }),
            5,
            { signal: this.dlAbort?.signal, parallel: true },
          )
        } catch (e) {
          if (e instanceof Error && e.message === '已暂停') throw e
          throw new Error('ComfyUI 本体下载失败，请检查网络后重试（断点还在，重试接着下）')
        }
        // 下完再核一次大小，别让半截包混进解压
        if (expected > 0 && Math.abs(fileSizeOf(archive) - expected) > 4096) {
          this.deployLog(`大小仍不符：${fileSizeOf(archive)} vs ${expected}`)
        }
      }
      this.setState('preparing')
      this.onProgress({ phase: 'extract', label: '正在校验安装包', percent: 0.3 })
      // 下载完的包先过一遍完整性检查（能列出目录才算数），坏了删掉重下一次
      let archiveOk = await test7z(archive)
      this.deployLog(`安装包校验：${archiveOk ? '通过' : '损坏'}`)
      if (!archiveOk) {
        try {
          fs.rmSync(archive, { force: true })
        } catch {
          /* ignore */
        }
        // 分块残留也一起清掉，否则新下的包会被旧 chunk 干扰
        this.clearChunks(archive)
        this.onProgress({ phase: 'portable', label: '安装包损坏，重新下载', percent: 0 })
        const push2 = this.throttle()
        try {
          await fetchWithRetry(
            PORTABLE_URLS,
            archive,
            (got, total) =>
              push2({ phase: 'portable', label: '正在重新下载 ComfyUI 本体', received: got, total, percent: total ? got / total : 0 }),
            5,
            { signal: this.dlAbort?.signal, parallel: true },
          )
        } catch (e) {
          if (e instanceof Error && e.message === '已暂停') throw e
          throw new Error('ComfyUI 安装包重复下载仍失败，请换个网络环境再试')
        }
        archiveOk = await test7z(archive)
        if (!archiveOk) throw new Error('安装包两次下载都损坏，可能是镜像源问题，请稍后再试或导入秋叶整合包')
      }
      this.onProgress({ phase: 'extract', label: '正在解压 ComfyUI（约两分钟，不用动）', percent: 0.5 })
      try {
        await extract7z(archive, this.portableDir, (m) => this.deployLog(m))
      } catch (e) {
        throw new Error(`${e instanceof Error ? e.message : '解压失败'}。解压日志在 ${this.logPath}`)
      }
      // 官方包解压出来多套一层 ComfyUI_windows_portable，摊平（多层也认）
      flattenPortableDir(this.portableDir, (m) => this.deployLog(m))
      try {
        fs.rmSync(archive, { force: true })
      } catch {
        /* ignore */
      }
      if (!this.isInstalled()) {
        this.deployLog(`解压后仍找不到 python.exe 或 main.py，目录内容：${this.listTop()} `)
        throw new Error(
          `解压结果不完整（没找到自带的 Python 或 main.py）。诊断日志：${this.logPath}。` +
            `可以点「清除下载」重来，或在设置里「导入已有的整合包」直接用自己的 ComfyUI`,
        )
      }
      this.deployLog(`本体就绪：python=${this.pythonExe}`)
    }

    // 2) Python 运行环境：便携包自带解释器，这里验一遍能不能跑、缺的依赖顺手补上
    await this.ensurePythonRuntime()

    // 2) 默认底模
    if (!this.hasCheckpoint()) {
      const dest = path.join(this.ckptDir, CKPT_FILE)
      this.setState('preparing')
      const push = this.throttle()
      fs.mkdirSync(this.ckptDir, { recursive: true })
      try {
        await fetchWithRetry(
          CKPT_URLS,
          dest,
          (got, total) =>
            push({ phase: 'model', label: '正在下载默认底模 DreamShaper', received: got, total, percent: total ? got / total : 0 }),
          5,
          { signal: this.dlAbort?.signal, parallel: true },
        )
      } catch (e) {
        if (e instanceof Error && e.message === '已暂停') throw e
        throw new Error('底模下载失败，请检查网络后重试（断点还在，重试接着下）')
      }
    }

    // 3) 放大模型（小文件，顺手装上，放大类工作流开箱即用）
    const upDest = path.join(this.upscaleDir, UPSCALE_FILE)
    if (fileSizeOf(upDest) < UPSCALE_BYTES * 0.5) {
      try {
        fs.mkdirSync(this.upscaleDir, { recursive: true })
        this.onProgress({ phase: 'upscale', label: '正在下载放大模型', percent: 0.5 })
        await fetchWithRetry(UPSCALE_URLS, upDest, () => {}, 2).catch(() => {})
      } catch {
        /* 放大模型下不来不挡路 */
      }
    }

    // 4) ComfyUI-Manager 插件管理器：有了它，缺什么节点都能自己一键装，和整合包一个能力
    const mgrDir = path.join(this.comfyRoot, 'custom_nodes', 'ComfyUI-Manager')
    if (!fs.existsSync(mgrDir)) {
      try {
        const zip = path.join(this.dataDir, 'comfyui-manager.zip')
        if (fileSizeOf(zip) < 1024 * 1024) {
          this.onProgress({ phase: 'manager', label: '正在安装插件管理器', percent: 0.5 })
          const mgrUrls = [
            'https://ghproxy.net/https://codeload.github.com/ltdrdata/ComfyUI-Manager/zip/refs/heads/main',
            'https://gh-proxy.com/https://codeload.github.com/ltdrdata/ComfyUI-Manager/zip/refs/heads/main',
            'https://codeload.github.com/ltdrdata/ComfyUI-Manager/zip/refs/heads/main',
          ]
          await fetchWithRetry(mgrUrls, zip, () => {}, 2)
        }
        const nodesDir = path.join(this.comfyRoot, 'custom_nodes')
        fs.mkdirSync(nodesDir, { recursive: true })
        await extract7z(zip, nodesDir)
        const unpacked = path.join(nodesDir, 'ComfyUI-Manager-main')
        if (fs.existsSync(unpacked)) fs.renameSync(unpacked, mgrDir)
        fs.rmSync(zip, { force: true })
      } catch {
        /* 管理器装不上不挡路，界面里可以重试 */
      }
    }

    // 5) 画布桥：左边切预设时把节点图实时推到 ComfyUI 前端
    this.installBridge()
  }

  /** 离线也能用：直接扫 models 目录，列出已安装的模型文件名（含一层子目录） */  localModelLists() {
    const SCAN = {
      checkpoints: ['checkpoints'],
      loras: ['loras'],
      controlnets: ['controlnet'],
      upscaleModels: ['upscale_models'],
      vaes: ['vae'],
      unets: ['diffusion_models', 'unet'],
      clips: ['clip', 'text_encoders'],
    }
    const FILE_RE = /\.(safetensors|ckpt|pt|pth|bin|gguf)$/i
    const out = {}
    const walk = (dir, prefix, depth, bag) => {
      if (depth > 2) return
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const rel = prefix ? `${prefix}/${e.name}` : e.name
        if (e.isDirectory()) walk(path.join(dir, e.name), rel, depth + 1, bag)
        else if (FILE_RE.test(e.name)) bag.push(rel)
      }
    }
    for (const [key, dirs] of Object.entries(SCAN)) {
      const bag = []
      for (const d of dirs) walk(path.join(this.comfyRoot, 'models', d), '', 1, bag)
      out[key] = bag.sort()
    }
    return out
  }

  async start() {
    if (this.state === 'ready' && this.proc && !this.proc.killed) return this.getStatus()
    if (!this.isInstalled()) throw new Error('还没部署 ComfyUI')
    // 启动前把画布桥铺好（不在就在 Custom Nodes 里补一份）
    this.installBridge()
    this.setState('starting')
    this.onProgress({ phase: 'start', label: '正在启动内置 ComfyUI', percent: 0.5 })

    // 端口避让：8188 被占且不是 ComfyUI 就往后排；占着的正好是 ComfyUI 就直接用现成的
    let base = DEFAULT_BASE
    let chosenPort = 8188
    let reused = false
    for (let p = 8188; p <= 8200; p++) {
      const occupied = await res.probePort(p)
      if (!occupied) {
        chosenPort = p
        base = `http://127.0.0.1:${p}`
        break
      }
      try {
        const s = await getStatus(`http://127.0.0.1:${p}`)
        if (s.online) {
          chosenPort = p
          base = `http://127.0.0.1:${p}`
          reused = true
          break
        }
      } catch {
        /* 占着端口的不是 ComfyUI，继续找 */
      }
      if (p === 8200) throw new Error('8188 到 8200 端口全被占了，关掉一些程序再试')
    }
    this.base = base

    if (reused) {
      this.setState('ready')
      this.onProgress({ phase: 'start', label: `检测到已有 ComfyUI 在 ${chosenPort} 端口运行`, percent: 1 })
      return this.getStatus()
    }

    // 显存档位 → 启动参数；探测失败就按默认来
    let vramArgs = []
    try {
      const gpus = await res.probeGpus()
      const best = gpus.reduce((a, b) => (b.vramGb > (a?.vramGb || 0) ? b : a), null)
      vramArgs = res.gpuTier(best ? best.vramGb * 1024 : 0).args
    } catch {
      /* 按默认参数起 */
    }

    const args = ['-s', this.mainPy, '--port', String(chosenPort), ...vramArgs]
    if (!this.external) args.push('--windows-standalone-build')
    // 不管哪种包都别自己弹浏览器：界面只在软件内置的浏览器里开。
    // （--windows-standalone-build 默认会在启动后调 webbrowser.open 打开系统默认浏览器）
    args.push('--disable-auto-launch')
    const proc = spawn(this.pythonExe, args, {
      cwd: this.comfyRoot,
      windowsHide: true,
      env: res.cleanChildEnv(),
    })
    this.proc = proc

    // stderr 攒尾巴（GBK 解码防乱码），启动失败时翻译成人话
    const dec = new TextDecoder('gbk')
    let stderrTail = ''
    proc.stderr?.on('data', (c) => {
      stderrTail = (stderrTail + dec.decode(c, { stream: true })).slice(-8192)
    })
    proc.on('exit', () => {
      this.proc = null
      if (this.state === 'ready' || this.state === 'starting') {
        const translated = res.translateError(stderrTail)
        this.setState('stopped', translated)
      }
    })

    const deadline = Date.now() + 180000
    while (Date.now() < deadline) {
      if (!this.proc) {
        const translated = res.translateError(stderrTail)
        throw new Error(translated || 'ComfyUI 启动失败，把软件目录加进杀毒白名单再试')
      }
      try {
        const s = await getStatus(base)
        if (s.online) {
          this.setState('ready')
          this.onProgress({ phase: 'start', label: `内置 ComfyUI 已就绪（端口 ${chosenPort}）`, percent: 1 })
          return this.getStatus()
        }
      } catch {
        /* 还在加载 */
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
    const translated = res.translateError(stderrTail)
    throw new Error(translated || 'ComfyUI 启动超时，可能被杀毒软件拦了')
  }

  stop() {
    if (this.proc) {
      try {
        this.proc.kill()
      } catch {
        /* ignore */
      }
      this.proc = null
    }
    if (this.state !== 'uninstalled') this.setState('stopped')
    return this.getStatus()
  }

  uninstall() {
    this.stop()
    if (this.external) {
      // 导入的整合包是用户自己的东西，只解除关联，一个文件都不动
      this.setState('uninstalled')
      return this.getStatus()
    }
    try {
      fs.rmSync(this.dataDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    this.setState('uninstalled')
    return this.getStatus()
  }
}

/**
 * 检查一个文件夹是不是能用的 ComfyUI 安装（秋叶整合包、官方便携版、自己装的都算）。
 * 返回 { ok, pythonExe, mainPy, error }，ok 时可直接导入。
 */
function inspectComfyDir(dir) {
  const bad = (error) => ({ ok: false, error, pythonExe: '', mainPy: '' })
  if (!dir || !fs.existsSync(dir)) return bad('目标文件夹不存在')
  let stat
  try {
    stat = fs.statSync(dir)
  } catch {
    return bad('无法读取目标路径，请检查访问权限')
  }
  if (!stat.isDirectory()) return bad('当前所选路径为文件，请选择文件夹')

  const mainCandidates = [
    path.join(dir, 'ComfyUI', 'main.py'),
    path.join(dir, 'main.py'),
  ]
  const mainPy = mainCandidates.find((p) => fileSizeOf(p) > 1024)
  if (!mainPy) return bad('未在所选目录中检测到 ComfyUI 主程序（缺少 main.py），请选择整合包根目录')

  const comfyRoot = path.dirname(mainPy)
  const pyCandidates = [
    path.join(dir, 'python_embeded', 'python.exe'),
    path.join(dir, 'python', 'python.exe'),
    path.join(dir, 'venv', 'Scripts', 'python.exe'),
    path.join(comfyRoot, '..', 'python_embeded', 'python.exe'),
    path.join(comfyRoot, '..', 'python', 'python.exe'),
  ]
  // 嵌入式 python.exe 只有 100KB 左右，阈值按 40KB 算
  const pythonExe = pyCandidates.find((p) => fileSizeOf(p) > 40 * 1024)
  if (!pythonExe) return bad('已检测到 ComfyUI 目录，但未找到配套的 Python 运行环境（python.exe）')

  return { ok: true, error: '', pythonExe: path.resolve(pythonExe), mainPy: path.resolve(mainPy) }
}

module.exports.ComfyUIEngine = ComfyUIEngine
module.exports.inspectComfyDir = inspectComfyDir
module.exports.fetchWithRetry = fetchWithRetry
module.exports.fetchToFile = fetchToFile
/** zip 也走同一套解压（bsdtar 和 7-Zip 都认 zip） */
module.exports.extractZip = (zip, destDir, onLog) => extract7z(zip, destDir, onLog)
module.exports.find7zExe = find7zExe

/** 在指定工作目录里跑一个命令，返回 { code, out }（训练装依赖要用）
 *  extraEnv 会覆盖 cleanChildEnv() 的结果，比如给训练子进程加 PYTHONPATH / 离线开关。 */
module.exports.execIn = (cmd, args, cwd, timeoutMs = 600000, onLine, extraEnv) =>
  new Promise((resolve) => {
    let out = ''
    let ps
    try {
      ps = spawn(cmd, args, { cwd, windowsHide: true, env: { ...res.cleanChildEnv(), ...(extraEnv || {}) } })
    } catch (e) {
      return resolve({ code: -1, out: e instanceof Error ? e.message : String(e) })
    }
    const dec = new TextDecoder('gbk')
    const push = (c) => {
      const t = dec.decode(c, { stream: true })
      out = (out + t).slice(-60000)
      if (onLine) onLine(t)
    }
    ps.stdout?.on('data', push)
    ps.stderr?.on('data', push)
    const timer = setTimeout(() => {
      try {
        ps.kill()
      } catch {
        /* ignore */
      }
    }, timeoutMs)
    ps.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, out: out + String(e.message || e) })
    })
    ps.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, out })
    })
  })

// ---------------------------------------------------------------------------
// 模型中心：按功能分类的模型目录，下载直接落进 ComfyUI 的 models 目录。
// 所有地址都实测过连通（2026-11），hf-mirror 优先，国内可直连。
// ---------------------------------------------------------------------------

const MODEL_CATS = {
  ckpt: { dir: 'checkpoints', name: '基础底模', why: '决定基础画风与图像质量的核心大模型' },
  lora: { dir: 'loras', name: 'LoRA 微调', why: '用于叠加特定画风、角色特征或加速采样' },
  vae: { dir: 'vae', name: 'VAE 编码器', why: '改善画面色彩还原度与边缘细节表现' },
  upscale: { dir: 'upscale_models', name: '超分放大模型', why: '用于高清放大工作流的分辨率提升' },
  controlnet: { dir: 'controlnet', name: 'ControlNet', why: '精准控制线稿、人体姿态、景深与空间构图' },
  face: { dir: 'facerestore_models', name: '面部修复模型', why: '修复与增强生成图像中的面部五官细节' },
  unet: { dir: 'diffusion_models', name: 'Flux 主模型', why: 'Flux 架构工作流核心模型（存放于 diffusion_models）' },
  clip: { dir: 'text_encoders', name: 'Flux 文本编码器', why: 'Flux 架构所需的 T5 与 CLIP 文本编码组件' },
  video: { dir: 'checkpoints', name: '视频生成模型', why: '用于图生视频（Image-to-Video）动态工作流' },
}

const HF = 'https://hf-mirror.com'
const GHP = 'https://ghproxy.net/https://github.com'

// rating：S 必装神级 / A 强力推荐 / B 好用 / C 备选 / D 玩玩就行
const MODEL_CATALOG = [
  // 底模
  { id: 'ds8', cat: 'ckpt', name: 'DreamShaper 8', file: 'DreamShaper_8_pruned.safetensors', bytes: 2.0, unit: 'GB', rating: 'A',
    desc: '通用全能型底模，兼顾人物、风景与插画表现，适合作为首选基础模型',
    urls: [`${HF}/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors`] },
  { id: 'rv51', cat: 'ckpt', name: 'Realistic Vision V5.1', file: 'Realistic_Vision_V5.1.safetensors', bytes: 4.3, unit: 'GB', rating: 'A',
    desc: '写实摄影专用底模，擅长表现高保真人物肖像与自然皮肤肌理',
    urls: [`${HF}/SG161222/Realistic_Vision_V5.1_noVAE/resolve/main/Realistic_Vision_V5.1.safetensors`] },
  { id: 'cf3', cat: 'ckpt', name: 'Counterfeit V3', file: 'Counterfeit-V3.0_fp16.safetensors', bytes: 4.0, unit: 'GB', rating: 'B',
    desc: '二次元精细插画底模，画面干净利落，色彩层次通透',
    urls: [`${HF}/gsdf/Counterfeit-V3.0/resolve/main/Counterfeit-V3.0_fp16.safetensors`] },
  { id: 'aom3', cat: 'ckpt', name: 'AOM3 橘子混合', file: 'AOM3A1B_orangemixs.safetensors', bytes: 2.1, unit: 'GB', rating: 'B',
    desc: '二次元厚涂质感底模，色彩浓郁华丽，适合角色立绘与幻想题材',
    urls: [`${HF}/WarriorMama777/OrangeMixs/resolve/main/Models/AbyssOrangeMix3/AOM3A1B_orangemixs.safetensors`] },
  { id: 'majic7', cat: 'ckpt', name: 'majicMIX 写实 V7', file: 'majicmixRealistic_v7.safetensors', bytes: 2.0, unit: 'GB', rating: 'A',
    desc: '经典亚洲人像写实底模，体积轻量且光影质感优异',
    urls: [`${HF}/digiplay/majicMIX_realistic_v7/resolve/main/majicmixRealistic_v7.safetensors`] },
  { id: 'jxl9', cat: 'ckpt', name: 'Juggernaut XL V9', file: 'Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors', bytes: 6.9, unit: 'GB', rating: 'S',
    desc: 'SDXL 旗舰级写实底模，具备电影级光影与摄影质感，建议 8GB 显存以上使用',
    urls: [`${HF}/RunDiffusion/Juggernaut-XL-v9/resolve/main/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors`] },
  { id: 'animagine4', cat: 'ckpt', name: 'Animagine XL 4.0', file: 'animagine-xl-4.0.safetensors', bytes: 6.9, unit: 'GB', rating: 'A',
    desc: 'SDXL 旗舰级二次元底模，人体结构与手部细节表现稳定',
    urls: [`${HF}/cagliostrolab/animagine-xl-4.0/resolve/main/animagine-xl-4.0.safetensors`] },
  { id: 'sdxl', cat: 'ckpt', name: 'SDXL Base 1.0', file: 'sd_xl_base_1.0.safetensors', bytes: 6.9, unit: 'GB', rating: 'C', func: 'B', eff: 'C',
    desc: 'Stability AI 官方标准底模，适合作为模型微调与 LoRA 训练基底',
    urls: [`${HF}/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors`] },
  { id: 'sdturbo', cat: 'ckpt', name: 'SDXL Turbo', file: 'sd_xl_turbo_1.0_fp16.safetensors', bytes: 6.9, unit: 'GB', rating: 'B', func: 'A', eff: 'B',
    desc: '高速实时蒸馏底模，仅需 1~2 步采样即可出图，适合快速验证构图与提示词',
    urls: [`${HF}/stabilityai/sdxl-turbo/resolve/main/sd_xl_turbo_1.0_fp16.safetensors`] },
  { id: 'meinamix', cat: 'ckpt', name: 'MeinaMix V11', file: 'MeinaMix_V11.safetensors', bytes: 2.0, unit: 'GB', rating: 'A', func: 'A', eff: 'A',
    desc: '经典日系二次元底模，面部刻画细腻，低显存设备亦可流畅运行',
    urls: [`${HF}/Meina/MeinaMix/resolve/main/MeinaMix_V11.safetensors`] },
  { id: 'realvisxl', cat: 'ckpt', name: 'RealVisXL V4.0', file: 'RealVisXL_V4.0.safetensors', bytes: 6.5, unit: 'GB', rating: 'A', func: 'A', eff: 'S',
    desc: 'SDXL 高自然度写实底模，肤质与环境光影过渡柔和自然',
    urls: [`${HF}/SG161222/RealVisXL_V4.0/resolve/main/RealVisXL_V4.0.safetensors`] },
  // LoRA
  { id: 'hypersd', cat: 'lora', name: 'Hyper-SD 8步加速', file: 'Hyper-SD15-8steps-CFG-lora.safetensors', bytes: 800, unit: 'MB', rating: 'S',
    desc: '专为 SD1.5 底模设计的 8 步加速组件，大幅提升生成速度且画质损耗极低',
    urls: [`${HF}/ByteDance/Hyper-SD/resolve/main/Hyper-SD15-8steps-CFG-lora.safetensors`] },
  { id: 'hypersdxl', cat: 'lora', name: 'Hyper-SDXL 8步加速', file: 'Hyper-SDXL-8steps-CFG-lora.safetensors', bytes: 800, unit: 'MB', rating: 'A',
    desc: '专为 SDXL 底模设计的 8 步高质量采样加速组件',
    urls: [`${HF}/ByteDance/Hyper-SD/resolve/main/Hyper-SDXL-8steps-CFG-lora.safetensors`] },
  { id: 'lcm15', cat: 'lora', name: 'LCM 加速（SD1.5）', file: 'lcm-lora-sdv1-5.safetensors', bytes: 200, unit: 'MB', rating: 'S',
    desc: 'SD1.5 通用潜在一致性加速组件，支持 4 步快速采样出图',
    urls: [`${HF}/latent-consistency/lcm-lora-sdv1-5/resolve/main/pytorch_lora_weights.safetensors`] },
  { id: 'lcmsdxl', cat: 'lora', name: 'LCM 加速（SDXL）', file: 'lcm-lora-sdxl.safetensors', bytes: 400, unit: 'MB', rating: 'A',
    desc: 'SDXL 通用潜在一致性加速组件，支持 4~6 步快速出图',
    urls: [`${HF}/latent-consistency/lcm-lora-sdxl/resolve/main/pytorch_lora_weights.safetensors`] },
  { id: 'lightning4', cat: 'lora', name: 'SDXL-Lightning 4步', file: 'sdxl_lightning_4step_lora.safetensors', bytes: 400, unit: 'MB', rating: 'A', func: 'A', eff: 'A',
    desc: 'SDXL 渐进式对抗蒸馏 4 步加速组件，细节锐度优于常规 LCM',
    urls: [`${HF}/ByteDance/SDXL-Lightning/resolve/main/sdxl_lightning_4step_lora.safetensors`] },
  { id: 'lightning2', cat: 'lora', name: 'SDXL-Lightning 2步', file: 'sdxl_lightning_2step_lora.safetensors', bytes: 400, unit: 'MB', rating: 'B', func: 'A', eff: 'C',
    desc: 'SDXL 极速 2 步采样组件，适合快速批量生成构图预览草稿',
    urls: [`${HF}/ByteDance/SDXL-Lightning/resolve/main/sdxl_lightning_2step_lora.safetensors`] },
  // VAE
  { id: 'vae840', cat: 'vae', name: 'vae-ft-mse 840000', file: 'vae-ft-mse-840000-ema-pruned.safetensors', bytes: 335, unit: 'MB', rating: 'A',
    desc: 'SD1.5 标准色彩校正编码器，有效改善画面发灰与色彩暗淡问题',
    urls: [`${HF}/stabilityai/sd-vae-ft-mse-original/resolve/main/vae-ft-mse-840000-ema-pruned.safetensors`] },
  { id: 'vaexl', cat: 'vae', name: 'SDXL VAE', file: 'sdxl_vae.safetensors', bytes: 335, unit: 'MB', rating: 'B', func: 'B', eff: 'B',
    desc: 'SDXL 官方配套变分自编码器',
    urls: [`${HF}/stabilityai/sdxl-vae/resolve/main/sdxl_vae.safetensors`] },
  { id: 'vaeflux', cat: 'vae', name: 'Flux VAE（ae）', file: 'ae.safetensors', bytes: 335, unit: 'MB', rating: 'S', func: 'S', eff: 'S',
    desc: 'Flux 架构必需的图像解码器组件',
    urls: [`${HF}/black-forest-labs/FLUX.1-schnell/resolve/main/ae.safetensors`] },
  // 放大
  { id: 'u4sharp', cat: 'upscale', name: '4x-UltraSharp', file: '4x-UltraSharp.pth', bytes: 64, unit: 'MB', rating: 'S',
    desc: '通用 4 倍超分辨率放大模型，边缘锐利清晰（默认随环境自动部署）',
    urls: [`${HF}/lokCX/4x-Ultrasharp/resolve/main/4x-UltraSharp.pth`] },
  { id: 'resr4', cat: 'upscale', name: 'RealESRGAN x4plus', file: 'RealESRGAN_x4plus.pth', bytes: 64, unit: 'MB', rating: 'A',
    desc: '写实摄影图像专用的 4 倍超分辨率放大模型',
    urls: [`${GHP}/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth`] },
  { id: 'resranime', cat: 'upscale', name: 'RealESRGAN 动漫版', file: 'RealESRGAN_x4plus_anime_6B.pth', bytes: 18, unit: 'MB', rating: 'A', func: 'A', eff: 'A',
    desc: '二次元与插画专用超分模型，体积轻量且线条还原纯净',
    urls: [`${GHP}/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth`] },
  { id: 'remacri', cat: 'upscale', name: '4x Foolhardy Remacri', file: '4x_foolhardy_Remacri.pth', bytes: 64, unit: 'MB', rating: 'B', func: 'B', eff: 'A',
    desc: '自然肌理超分模型，放大后可良好保留胶片颗粒与皮肤细节纹理',
    urls: [`${HF}/FacehugmanIII/4x_foolhardy_Remacri/resolve/main/4x_foolhardy_Remacri.pth`] },
  // 修脸
  { id: 'gfpgan', cat: 'face', name: 'GFPGAN v1.4', file: 'GFPGANv1.4.pth', bytes: 333, unit: 'MB', rating: 'S',
    desc: '写实人像面部修复与五官增强模型，亦可用于历史照片翻新',
    urls: [`${GHP}/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth`] },
  { id: 'codeformer', cat: 'face', name: 'CodeFormer', file: 'codeformer.pth', bytes: 359, unit: 'MB', rating: 'A',
    desc: '高鲁棒性通用面部重建模型，兼顾写实与插画面部修复',
    urls: [`${GHP}/sczhou/CodeFormer/releases/download/v0.1.0/codeformer.pth`] },
  // ControlNet
  { id: 'cn-canny', cat: 'controlnet', name: 'ControlNet Canny', file: 'control_v11p_sd15_canny.pth', bytes: 1.45, unit: 'GB', rating: 'A',
    desc: '硬边缘线稿控制模型，精准锁定参考图的轮廓结构',
    urls: [`${HF}/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_canny.pth`] },
  { id: 'cn-depth', cat: 'controlnet', name: 'ControlNet Depth', file: 'control_v11f1p_sd15_depth.pth', bytes: 1.45, unit: 'GB', rating: 'B',
    desc: '空间景深控制模型，保持画面前后透视与立体层次关系',
    urls: [`${HF}/lllyasviel/ControlNet-v1-1/resolve/main/control_v11f1p_sd15_depth.pth`] },
  { id: 'cn-pose', cat: 'controlnet', name: 'ControlNet OpenPose', file: 'control_v11p_sd15_openpose.pth', bytes: 1.45, unit: 'GB', rating: 'A',
    desc: '人体骨骼姿态控制模型，精准复现参考图像的人物动作',
    urls: [`${HF}/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_openpose.pth`] },
  { id: 'cn-line', cat: 'controlnet', name: 'ControlNet Lineart', file: 'control_v11p_sd15_lineart.pth', bytes: 1.45, unit: 'GB', rating: 'B',
    desc: '精细线稿提取与自动上色控制模型',
    urls: [`${HF}/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_lineart.pth`] },
  { id: 'cn-scribble', cat: 'controlnet', name: 'ControlNet Scribble', file: 'control_v11p_sd15_scribble.pth', bytes: 1.45, unit: 'GB', rating: 'B',
    desc: '手绘草图控制模型，可将简笔涂鸦转化为完整构图画面',
    urls: [`${HF}/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_scribble.pth`] },
  { id: 'cn-inpaint', cat: 'controlnet', name: 'ControlNet Inpaint', file: 'control_v11p_sd15_inpaint.pth', bytes: 1.45, unit: 'GB', rating: 'A',
    desc: '局部重绘与画面修补专用控制模型',
    urls: [`${HF}/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_inpaint.pth`] },
  { id: 'cn-tile', cat: 'controlnet', name: 'ControlNet Tile', file: 'control_v11f1e_sd15_tile.pth', bytes: 1.45, unit: 'GB', rating: 'S',
    desc: '分块细节增强与高清重绘核心模型，适合搭配超分放大工作流',
    urls: [`${HF}/lllyasviel/ControlNet-v1-1/resolve/main/control_v11f1e_sd15_tile.pth`] },
  // 视频
  { id: 'svdxt', cat: 'video', name: 'SVD-XT 图生视频', file: 'svd_xt.safetensors', bytes: 4.7, unit: 'GB', rating: 'A', func: 'A', eff: 'B',
    desc: '将静态图像转化为数秒动态视频，建议 8GB 显存以上配置使用',
    urls: [`${HF}/stabilityai/stable-video-diffusion-img2vid-xt/resolve/main/svd_xt.safetensors`] },
  { id: 'svdxt11', cat: 'video', name: 'SVD-XT 1.1 图生视频', file: 'svd_xt_1_1.safetensors', bytes: 4.7, unit: 'GB', rating: 'A', func: 'A', eff: 'A',
    desc: 'SVD-XT 1.1 升级版本，镜头运动稳定性更高、画面闪烁更少',
    urls: [`${HF}/stabilityai/stable-video-diffusion-img2vid-xt-1-1/resolve/main/svd_xt_1_1.safetensors`] },
  // Flux 主模型与文本编码器（Flux 工作流缺一不可）
  { id: 'flux-schnell', cat: 'unet', name: 'Flux.1 Schnell（fp8）', file: 'flux1-schnell-fp8.safetensors', bytes: 11.9, unit: 'GB', rating: 'S', func: 'S', eff: 'S',
    desc: 'Flux 官方 4 步高速蒸馏版（FP8 量化），兼具高画质与提示词遵循度，建议 12GB 显存以上使用',
    urls: [`${HF}/Comfy-Org/flux1-schnell/resolve/main/flux1-schnell-fp8.safetensors`] },
  { id: 't5xxl', cat: 'clip', name: 'T5-XXL 文本编码器（fp8）', file: 't5xxl_fp8_e4m3fn.safetensors', bytes: 4.9, unit: 'GB', rating: 'S', func: 'S', eff: 'S',
    desc: 'Flux 双文本编码器核心组件之一（FP8 量化），运行 Flux 工作流必需',
    urls: [`${HF}/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn.safetensors`] },
  { id: 'clipl', cat: 'clip', name: 'CLIP-L 文本编码器', file: 'clip_l.safetensors', bytes: 246, unit: 'MB', rating: 'S', func: 'S', eff: 'S',
    desc: 'Flux 双文本编码器组件之二，需与 T5-XXL 配合使用',
    urls: [`${HF}/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors`] },
]

class ModelHub {
  /** getComfyRoot: () => ComfyUI 主目录（内置或外部整合包都行） */
  constructor(getComfyRoot, onProgress) {
    this.getComfyRoot = getComfyRoot
    this.onProgress = onProgress || (() => {})
    this.running = new Set()
  }

  targetFor(item) {
    const cat = MODEL_CATS[item.cat]
    return path.join(this.getComfyRoot(), 'models', cat.dir, item.file)
  }

  list() {
    return MODEL_CATALOG.map((item) => {
      const target = this.targetFor(item)
      const size = fileSizeOf(target)
      const approx = item.unit === 'GB' ? item.bytes * 1024 ** 3 : item.bytes * 1024 ** 2
      return {
        id: item.id,
        cat: item.cat,
        catName: MODEL_CATS[item.cat].name,
        name: item.name,
        file: item.file,
        sizeLabel: `约 ${item.bytes} ${item.unit}`,
        desc: item.desc,
        // 综合评级 + 两个分项：func = 功能覆盖，eff = 出图效果
        rating: item.rating || 'C',
        ratingFunc: item.func || item.rating || 'C',
        ratingEff: item.eff || item.rating || 'C',
        downloaded: size > approx * 0.9,
        downloading: this.running.has(item.id),
      }
    })
  }

  async download(id) {
    const item = MODEL_CATALOG.find((m) => m.id === id)
    if (!item) throw new Error('模型目录中不存在该模型项')
    if (this.running.has(id)) throw new Error('该模型当前正在下载中')
    const target = this.targetFor(item)
    this.running.add(id)
    const emit = (got, total) =>
      this.onProgress({ id, received: got, total, percent: total ? got / total : 0 })
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      await fetchWithRetry(item.urls, target, emit, 5, { parallel: true }).catch(() => {
        throw new Error(`${item.name} 下载失败，请检查网络连接后重试（已保留断点进度）`)
      })
      this.onProgress({ id, done: true, percent: 1 })
      return this.list()
    } finally {
      this.running.delete(id)
    }
  }
}

module.exports.ModelHub = ModelHub
