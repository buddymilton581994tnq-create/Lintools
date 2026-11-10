// API client for OpenAI-compatible image generation endpoints (relays included)

export interface ApiConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** 附加参数（JSON 文本），比如 {"vae":"...","loras":[...]}，随请求一起发给服务商，能不能用看它支持 */
  extras?: string
}

/** 解析附加参数 JSON，坏了就当没有，不挡路 */
function parseExtras(raw?: string): Record<string, unknown> {
  if (!raw || !raw.trim()) return {}
  try {
    const j = JSON.parse(raw)
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** 接口状态分类，界面上按这个给不同颜色和文案 */
export type ApiState =
  | 'unset' // 还没填地址或密钥
  | 'checking' // 正在检测
  | 'online' // 通
  | 'auth' // 401 / 403，密钥不对或没权限
  | 'notfound' // 404 / 405，接口地址不对
  | 'ratelimit' // 429，被限流
  | 'wrongbase' // 返回的是网页，多半把官网地址当接口了
  | 'offline' // 网络不通、超时、DNS 之类

export interface ApiStatus {
  online: boolean
  latencyMs: number | null
  message: string
  checkedAt: number
  state: ApiState
  httpStatus?: number
}

export interface BalanceInfo {
  available: boolean
  label: string
  detail?: string
  /** 查询失败时的原因，界面上标出来 */
  error?: string
}

export interface ModelItem {
  id: string
}

const UA_HEADERS = {}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** 接口把一整页 HTML（代理报错页、地址填错、网关掉页）当错误体返回时，
    别拿网页源代码刷屏，只说一句人话 */
function looksLikeHtml(s: string): boolean {
  return /^\s*(<!doctype html|<html[\s>])/i.test(s)
}

function describeErrorBody(data: unknown, status: number): string {
  const fromJson = (data as { error?: { message?: string } })?.error?.message
  if (fromJson) return String(fromJson).slice(0, 300)
  if (typeof data === 'string') {
    if (looksLikeHtml(data)) {
      return `接口返回了网页而不是数据（HTTP ${status}），请检查接口地址是否填对、服务商是否正常`
    }
    return data.slice(0, 200)
  }
  return `HTTP ${status}`
}

function normalizeBase(url: string): string {
  let u = url.trim().replace(/\/+$/, '')
  if (!u) return u
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  if (!u.endsWith('/v1')) u = u + '/v1'
  return u
}

export function getNormalizedBase(config: ApiConfig): string {
  return normalizeBase(config.baseUrl)
}

async function request<T>(
  config: ApiConfig,
  path: string,
  init: RequestInit = {},
  timeoutMs = 30000,
): Promise<T> {
  const base = getNormalizedBase(config)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(base + path, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
        ...UA_HEADERS,
      },
    })
    const text = await resp.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    if (!resp.ok) {
      throw new ApiError(describeErrorBody(data, resp.status), resp.status)
    }
    // 状态码正常但回来的是网页（网关/代理拦截），同样算失败
    if (typeof data === 'string' && looksLikeHtml(data)) {
      throw new ApiError(`接口返回了网页而不是数据（HTTP ${resp.status}），请检查接口地址是否填对`, resp.status)
    }
    return data as T
  } finally {
    clearTimeout(timer)
  }
}

/** 把一次失败翻译成状态分类 */
function classifyError(e: unknown): { state: ApiState; message: string; httpStatus?: number } {
  if (e instanceof ApiError) {
    const msg = e.message || `HTTP ${e.status}`
    if (e.status === 401 || e.status === 403) return { state: 'auth', message: msg, httpStatus: e.status }
    if (e.status === 404 || e.status === 405) return { state: 'notfound', message: msg, httpStatus: e.status }
    if (e.status === 429) return { state: 'ratelimit', message: msg, httpStatus: e.status }
    if (/网页而不是数据/.test(msg)) return { state: 'wrongbase', message: msg, httpStatus: e.status }
    return { state: 'offline', message: msg, httpStatus: e.status }
  }
  const msg = e instanceof Error ? e.message : String(e)
  if (/abort|timeout|timed out/i.test(msg)) return { state: 'offline', message: '请求超时，请检查网络连接或代理设置' }
  if (/Failed to fetch|NetworkError|ERR_/i.test(msg)) return { state: 'offline', message: '无法建立连接，请检查网络环境、代理配置与接口地址' }
  return { state: 'offline', message: msg || '连接失败' }
}

/** Ping /models — used both for status checks and model listing.
 *  Falls back to the billing endpoint for providers that don't expose /models. */
export async function checkStatus(config: ApiConfig): Promise<ApiStatus> {
  if (!config.baseUrl.trim() || !config.apiKey.trim()) {
    return { online: false, latencyMs: null, message: '未配置接口', checkedAt: Date.now(), state: 'unset' }
  }
  const start = performance.now()
  try {
    await request(config, '/models', {}, 15000)
    return {
      online: true,
      latencyMs: Math.round(performance.now() - start),
      message: '连接正常',
      checkedAt: Date.now(),
      state: 'online',
      httpStatus: 200,
    }
  } catch (e) {
    // Some providers don't implement /models — probe a secondary endpoint
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) {
      try {
        await request(config, '/dashboard/billing/subscription', {}, 15000)
        return {
          online: true,
          latencyMs: Math.round(performance.now() - start),
          message: '连接成功，请手动填写模型名',
          checkedAt: Date.now(),
          state: 'online',
          httpStatus: 200,
        }
      } catch {
        /* fall through */
      }
    }
    const c = classifyError(e)
    return {
      online: false,
      latencyMs: null,
      message: c.message,
      checkedAt: Date.now(),
      state: c.state,
      httpStatus: c.httpStatus,
    }
  }
}

export async function listModels(config: ApiConfig): Promise<ModelItem[]> {
  const data = await request<{ data?: { id: string }[] }>(config, '/models', {}, 20000)
  return (data.data || []).map((m) => ({ id: m.id }))
}

/** 记住哪些余额接口在某个配置上是不存在的，免得每 20 秒都去撞一次 404 */
const deadBalanceEndpoints = new Map<string, Set<string>>()

function balanceKey(config: ApiConfig): string {
  return `${getNormalizedBase(config)}|${config.apiKey}`
}

function isDead(key: string, path: string): boolean {
  return deadBalanceEndpoints.get(key)?.has(path) ?? false
}

function markDead(key: string, path: string): void {
  const set = deadBalanceEndpoints.get(key) || new Set<string>()
  set.add(path)
  deadBalanceEndpoints.set(key, set)
}

/** Try common OpenAI-style billing endpoints; degrade gracefully */
export async function getBalance(config: ApiConfig): Promise<BalanceInfo> {
  if (!config.baseUrl.trim() || !config.apiKey.trim()) {
    return { available: false, label: '未配置', error: '未配置接口' }
  }
  const key = balanceKey(config)
  let lastErr = ''
  // 1) subscription + usage（new-api / one-api 系的中转站都用这套，放第一位，少撞一次 404）
  if (!isDead(key, 'subscription')) {
    try {
      const sub = await request<{
        hard_limit_usd?: number
        soft_limit_usd?: number
        has_payment_method?: boolean
      }>(config, '/dashboard/billing/subscription', {}, 15000)
      if (typeof sub.hard_limit_usd === 'number') {
        let used: number | null = null
        try {
          const now = new Date()
          const start = new Date(now.getTime() - 99 * 86400000)
          const fmt = (d: Date) => d.toISOString().slice(0, 10)
          const usage = await request<{ total_usage?: number }>(
            config,
            `/dashboard/billing/usage?start_date=${fmt(start)}&end_date=${fmt(now)}`,
            {},
            15000,
          )
          if (typeof usage.total_usage === 'number') used = usage.total_usage / 100
        } catch {
          /* usage optional */
        }
        // Absurdly large hard limits mean pay-as-you-go keys: the API cannot see
        // the account balance, so report usage instead of a fake remaining amount.
        if (sub.hard_limit_usd >= 1_000_000) {
          return {
            available: true,
            label: used != null ? `已用 $${used.toFixed(2)}` : '按量计费',
            detail:
              used != null
                ? '近 99 天消耗，余额请去后台查看'
                : '按量计费，未开放用量查询',
          }
        }
        const remain = used != null ? sub.hard_limit_usd - used : null
        return {
          available: true,
          label: remain != null ? `$${remain.toFixed(2)}` : `$${sub.hard_limit_usd.toFixed(2)}`,
          detail:
            remain != null
              ? `已用 $${(used ?? 0).toFixed(2)} / 额度 $${sub.hard_limit_usd.toFixed(2)}`
              : `总额度 $${sub.hard_limit_usd.toFixed(2)}`,
        }
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      markDead(key, 'subscription')
    }
  }
  // 2) credit_grants（老版 OpenAI 的查询方式）
  if (!isDead(key, 'grants')) {
    try {
      const d = await request<{ total_granted?: number; total_used?: number; total_available?: number }>(
        config,
        '/dashboard/billing/credit_grants',
        {},
        15000,
      )
      if (typeof d.total_available === 'number') {
        return {
          available: true,
          label: `$${d.total_available.toFixed(2)}`,
          detail: `已用 $${(d.total_used ?? 0).toFixed(2)} / 总额 $${(d.total_granted ?? 0).toFixed(2)}`,
        }
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      markDead(key, 'grants')
    }
  }
  // 3) OpenRouter-style /credits
  if (!isDead(key, 'credits')) {
    try {
      const d = await request<{ data?: { total_credits?: number; total_usage?: number } }>(
        config,
        '/credits',
        {},
        15000,
      )
      if (d.data && typeof d.data.total_credits === 'number') {
        const remain = d.data.total_credits - (d.data.total_usage ?? 0)
        return {
          available: true,
          label: `$${remain.toFixed(2)}`,
          detail: `已用 $${(d.data.total_usage ?? 0).toFixed(2)} / 额度 $${d.data.total_credits.toFixed(2)}`,
        }
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      markDead(key, 'credits')
    }
  }
  return { available: false, label: '余额不可查', error: lastErr || '当前服务商未开放余额查询接口' }
}

export interface GenerateParams {
  prompt: string
  size: string
  quality: string
}

export interface GenerateResult {
  imageData: string // data URL or remote URL
  mime: string
  elapsedMs: number
}

export async function generateImage(
  config: ApiConfig,
  params: GenerateParams,
  timeoutMs = 280000,
): Promise<GenerateResult> {
  const start = performance.now()
  const data = await request<{
    data?: { b64_json?: string; url?: string; revised_prompt?: string }[]
  }>(
    config,
    '/images/generations',
    {
      method: 'POST',
      body: JSON.stringify({
        model: config.model,
        prompt: params.prompt,
        n: 1,
        size: params.size,
        quality: params.quality,
        ...parseExtras(config.extras),
      }),
    },
    timeoutMs,
  )
  return parseImageResult(data, start)
}

/** Image-to-image via /images/edits (multipart upload) */
export async function editImage(
  config: ApiConfig,
  params: GenerateParams,
  image: Blob,
  filename: string,
  timeoutMs = 280000,
): Promise<GenerateResult> {
  const base = getNormalizedBase(config)
  const start = performance.now()
  const form = new FormData()
  form.append('model', config.model)
  form.append('prompt', params.prompt)
  form.append('n', '1')
  form.append('size', params.size)
  form.append('quality', params.quality)
  form.append('image', image, filename)
  for (const [k, v] of Object.entries(parseExtras(config.extras))) {
    form.append(k, typeof v === 'string' ? v : JSON.stringify(v))
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(base + '/images/edits', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
    })
    const text = await resp.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    if (!resp.ok) {
      throw new ApiError(describeErrorBody(data, resp.status), resp.status)
    }
    if (typeof data === 'string' && looksLikeHtml(data)) {
      throw new ApiError(`接口返回了网页而不是数据（HTTP ${resp.status}），请检查接口地址是否填对`, resp.status)
    }
    return parseImageResult(data as { data?: { b64_json?: string; url?: string }[] }, start)
  } finally {
    clearTimeout(timer)
  }
}

function parseImageResult(
  data: { data?: { b64_json?: string; url?: string }[] },
  start: number,
): GenerateResult {
  const item = data.data?.[0]
  if (!item) throw new Error('未返回图片数据')
  const elapsedMs = Math.round(performance.now() - start)
  if (item.b64_json) {
    return { imageData: `data:image/png;base64,${item.b64_json}`, mime: 'image/png', elapsedMs }
  }
  if (item.url) {
    return { imageData: item.url, mime: 'image/png', elapsedMs }
  }
  throw new Error('返回结果里没有图片链接或数据')
}

/** Streaming chat completion (SSE). onDelta receives raw text for display;
 *  reasoning text is flagged so the caller can keep the final prompt clean. */
export async function chatCompletionStream(
  config: ApiConfig,
  model: string,
  messages: { role: string; content: string }[],
  onDelta: (text: string, isReasoning: boolean) => void,
  timeoutMs = 120000,
): Promise<void> {
  const base = getNormalizedBase(config)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const resp = await fetch(base + '/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages, stream: true }),
    })
    if (!resp.ok) {
      const text = await resp.text()
      let data: unknown = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = text
      }
      throw new ApiError(describeErrorBody(data, resp.status), resp.status)
    }
    const reader = resp.body?.getReader()
    if (!reader) throw new Error('接口不支持流式返回')
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') return
        try {
          const json = JSON.parse(payload) as {
            choices?: { delta?: { content?: string; reasoning_content?: string } }[]
          }
          const delta = json.choices?.[0]?.delta
          if (delta?.reasoning_content) onDelta(delta.reasoning_content, true)
          if (delta?.content) onDelta(delta.content, false)
        } catch {
          /* partial json line, ignore */
        }
      }
    }
  } finally {
    clearTimeout(timer)
  }
}
