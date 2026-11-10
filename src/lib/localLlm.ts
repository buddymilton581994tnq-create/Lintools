// 本地 AI（ds4f）在渲染进程一侧的封装。
// 下载、解压、启动、推理都在主进程，这里只做类型 + 转发。
// 浏览器里跑 vite dev 时没有 window.lintools，所有方法安全降级。

export interface AiModelInfo {
  id: string
  name: string
  label: string
  note: string
  bytes: number
}

export interface AiStatus {
  state: 'uninstalled' | 'stopped' | 'preparing' | 'starting' | 'ready' | 'error'
  ready: boolean
  installed: boolean
  error: string
  modelId: string
  modelName: string
  modelLabel: string
  modelNote: string
  modelBytes: number
  port: number
  dir?: string
  catalog: AiModelInfo[]
}

export interface AiProgress {
  phase: string
  label: string
  received?: number
  total?: number
  percent?: number
  speedBps?: number
  etaSec?: number | null
}

export interface AiDelta {
  requestId?: string
  text?: string
  reasoning?: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface InstallResult {
  ok: boolean
  status?: AiStatus
  error?: string
}

export type CloseAction = 'tray' | 'quit' | 'cancel'

interface Bridge {
  ai: {
    status: () => Promise<AiStatus>
    install: (modelId?: string) => Promise<InstallResult>
    start: () => Promise<InstallResult>
    stop: () => Promise<AiStatus>
    uninstall: () => Promise<AiStatus>
    chat: (p: {
      requestId: string
      messages: ChatMessage[]
      temperature?: number
      maxTokens?: number
    }) => Promise<{ ok: boolean; text?: string; error?: string }>
    onProgress: (cb: (p: AiProgress) => void) => () => void
    onStatus: (cb: (s: AiStatus) => void) => () => void
    onDelta: (cb: (d: AiDelta) => void) => () => void
  }
  app?: {
    onCloseRequest: (cb: () => void) => () => void
    respondClose: (action: CloseAction, remember: boolean) => Promise<void>
  }
}

function bridge(): Bridge['ai'] | null {
  const w = window as unknown as { lintools?: Bridge }
  return w.lintools?.ai ?? null
}

function appBridge(): Bridge['app'] | null {
  const w = window as unknown as { lintools?: Bridge }
  return w.lintools?.app ?? null
}

/** 点了窗口叉号（主进程拦下后通知界面弹卡片）；返回退订函数 */
export function onCloseRequest(cb: () => void): () => void {
  const b = appBridge()
  return b ? b.onCloseRequest(cb) : () => {}
}

/** 把关闭选择送回主进程 */
export async function respondClose(action: CloseAction, remember: boolean): Promise<void> {
  const b = appBridge()
  if (b) await b.respondClose(action, remember)
}

export function hasAiBridge(): boolean {
  return bridge() !== null
}

export async function getAiStatus(): Promise<AiStatus | null> {
  const b = bridge()
  if (!b) return null
  try {
    return await b.status()
  } catch {
    return null
  }
}

export async function installAi(modelId?: string): Promise<InstallResult> {
  const b = bridge()
  if (!b) return { ok: false, error: '仅桌面端支持本地模型' }
  return b.install(modelId)
}

export async function startAi(): Promise<InstallResult> {
  const b = bridge()
  if (!b) return { ok: false, error: '仅桌面端支持本地模型' }
  return b.start()
}

export async function uninstallAi(): Promise<AiStatus | null> {
  const b = bridge()
  if (!b) {
    return null
  }
  return b.uninstall()
}

export function onAiProgress(cb: (p: AiProgress) => void): () => void {
  const b = bridge()
  return b ? b.onProgress(cb) : () => {}
}

export function onAiStatus(cb: (s: AiStatus) => void): () => void {
  const b = bridge()
  return b ? b.onStatus(cb) : () => {}
}

/** 走本地模型做一次流式对话，reasoning 是思考过程，text 是正文 */
export async function chatAi(
  messages: ChatMessage[],
  onDelta: (d: { text?: string; reasoning?: string }) => void,
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const b = bridge()
  if (!b) throw new Error('仅桌面端支持本地模型')
  const requestId = `r${Date.now()}`
  const off = b.onDelta((d) => {
    if (d.requestId && d.requestId !== requestId) return
    onDelta(d)
  })
  try {
    const res = await b.chat({ requestId, messages, ...opts })
    if (!res.ok) throw new Error(res.error || '本地模型调用失败')
    return res.text || ''
  } finally {
    off()
  }
}
