// ComfyUI 与硬件探测在渲染进程一侧的封装，全部走 preload 桥，浏览器里安全降级。

export interface ComfyGpu {
  name: string
  vramGb: number
  vramFreeGb?: number
}

export interface ComfyStatus {
  online: boolean
  base: string
  os?: string
  comfyVersion?: string
  gpus: ComfyGpu[]
  error?: string
}

export interface ComfyModelLists {
  checkpoints: string[]
  loras: string[]
  controlnets: string[]
  upscaleModels: string[]
  vaes: string[]
  unets: string[]
  clips: string[]
}

export interface ComfyImage {
  filename: string
  subfolder: string
  type: string
}

export interface ComfyHistory {
  completed: boolean
  statusStr: string
  messages: string[]
  images: ComfyImage[]
}

export interface HardwareInfo {
  totalRamGb: number
  freeRamGb: number
  cpuModel: string
  cpuCores: number
  gpus: ComfyGpu[]
}

export type HwTier = 'smooth' | 'ok' | 'poor'

export interface HwEval {
  tier: HwTier
  maxVramGb: number
  totalRamGb: number
  /** 给用户看的大白话结论 */
  summary: string
}

interface ComfyBridge {
  status: (base: string) => Promise<ComfyStatus>
  models: (base: string) => Promise<ComfyModelLists>
  localModels: () => Promise<ComfyModelLists | null>
  queue: (base: string, prompt: Record<string, unknown>) => Promise<{ promptId: string }>
  history: (base: string, id: string) => Promise<ComfyHistory | null>
  view: (base: string, image: ComfyImage) => Promise<string>
  upload: (base: string, dataUrl: string, name: string) => Promise<{ name: string }>
  interrupt: (base: string) => Promise<void>
  engineStatus: () => Promise<ComfyEngineStatus>
  engineInstall: () => Promise<{ ok: boolean; status?: ComfyEngineStatus; error?: string }>
  engineStart: () => Promise<{ ok: boolean; status?: ComfyEngineStatus; error?: string }>
  engineStop: () => Promise<ComfyEngineStatus>
  enginePause: () => Promise<ComfyEngineStatus>
  enginePurge: () => Promise<ComfyEngineStatus>
  engineUninstall: () => Promise<ComfyEngineStatus>
  engineAdopt: (dir: string) => Promise<{ ok: boolean; status?: ComfyEngineStatus; error?: string }>
  engineDetach: () => Promise<ComfyEngineStatus>
  downloadState: () => Promise<DownloadState>
  onResumeAvailable: (cb: (p: { partial: boolean; installed: boolean }) => void) => () => void
  openLog: () => Promise<{ ok: boolean; path?: string; error?: string }>
  onEngineProgress: (cb: (p: ComfyEngineProgress) => void) => () => void
  onEngineStatus: (cb: (s: ComfyEngineStatus) => void) => () => void
}

/** 上次下载的残留信息 */
export interface DownloadState {
  partial: boolean
  installed: boolean
  state: string
  dir?: string
  logPath?: string
  savedState?: { phase?: string; at?: number } | null
}

/** 内置 ComfyUI 引擎状态 */
export interface ComfyEngineStatus {
  state: 'uninstalled' | 'stopped' | 'preparing' | 'starting' | 'ready' | 'error'
  ready: boolean
  installed: boolean
  hasCheckpoint: boolean
  error: string
  dir?: string
  external?: boolean
  /** 引擎实际监听的地址（端口避让后可能不是 8188） */
  base?: string
  /** 磁盘上有上次没下完的残留，可以询问是否接续 */
  partialDownload?: boolean
  downloadBytes: number
}

export interface ComfyEngineProgress {
  phase: string
  label: string
  received?: number
  total?: number
  percent?: number
}

interface SysBridge {
  hardware: () => Promise<HardwareInfo>
  environment?: () => Promise<EnvironmentInfo>
  mockTest?: (scenario: string) => Promise<MockTestResult>
  vcCheck?: () => Promise<VcCheckResult>
  vcInstall?: () => Promise<VcInstallResult>
}

export interface VcCheckResult {
  vcOk: boolean
  wu: { disabled: boolean; stopped: boolean; unknown: boolean }
}

export interface VcInstallResult {
  ok: boolean
  wuOff: boolean
  /** 关闭 Windows 更新失败时的原因（没权限之类） */
  wuNote?: string
  error?: string
}

export const vcCheck = (): Promise<VcCheckResult | null> => {
  const b = sysBridge()
  if (!b?.vcCheck) return Promise.resolve(null)
  return b.vcCheck().catch(() => null)
}

export const vcInstall = (): Promise<VcInstallResult | null> => {
  const b = sysBridge()
  if (!b?.vcInstall) return Promise.resolve(null)
  return b.vcInstall().catch(() => null)
}

/** 完整环境诊断（模块三汇总）：档位、运行库、磁盘、端口、建议目录 */
export interface EnvironmentInfo {
  totalRamGb: number
  freeRamGb: number
  cpuModel: string
  cpuCores: number
  gpus: { name: string; vramGb: number; driver?: string }[]
  tier: { id: string; label: string; args: string[]; advice: string }
  vcRuntime: { ok: boolean; path: string }
  disks: { drives: { drive: string; root: string; freeGb: number; isSystem: boolean }[]; best: { drive: string; root: string; freeGb: number } | null }
  port8188Busy: boolean
  suggestedEngineDir: string
}

export interface MockTestResult {
  scenario: string
  mock?: Record<string, unknown>
  decision?: Record<string, unknown>
  error?: string
}

function comfyBridge(): ComfyBridge | null {
  const w = window as unknown as { lintools?: { comfy?: ComfyBridge } }
  return w.lintools?.comfy ?? null
}

function sysBridge(): SysBridge | null {
  const w = window as unknown as { lintools?: { sys?: SysBridge } }
  return w.lintools?.sys ?? null
}

export function hasComfyBridge(): boolean {
  return comfyBridge() !== null
}

export const comfyStatus = (base: string) => {
  const b = comfyBridge()
  if (!b) return Promise.resolve<ComfyStatus>({ online: false, base, gpus: [], error: '仅桌面端可用' })
  return b.status(base)
}

export const comfyModels = async (base: string): Promise<ComfyModelLists | null> => {
  const b = comfyBridge()
  if (!b) return null
  try {
    return await b.models(base)
  } catch {
    return null
  }
}

/** 离线兜底：直接扫本地 models 目录，ComfyUI 没启动也能列出已装模型 */
export const comfyLocalModels = async (): Promise<ComfyModelLists | null> => {
  const b = comfyBridge()
  if (!b?.localModels) return null
  try {
    return await b.localModels()
  } catch {
    return null
  }
}

export const comfyQueue = (base: string, prompt: Record<string, unknown>) => {
  const b = comfyBridge()
  if (!b) return Promise.reject(new Error('仅桌面端可用'))
  return b.queue(base, prompt)
}

export const comfyHistory = async (base: string, id: string): Promise<ComfyHistory | null> => {
  const b = comfyBridge()
  if (!b) return null
  try {
    return await b.history(base, id)
  } catch {
    return null
  }
}

export const comfyView = (base: string, image: ComfyImage): Promise<string> => {
  const b = comfyBridge()
  if (!b) return Promise.reject(new Error('仅桌面端可用'))
  return b.view(base, image)
}

export const comfyUpload = (base: string, dataUrl: string, name: string) => {
  const b = comfyBridge()
  if (!b) return Promise.reject(new Error('仅桌面端可用'))
  return b.upload(base, dataUrl, name)
}

export const comfyInterrupt = (base: string) => comfyBridge()?.interrupt(base)

// ---- 内置 ComfyUI 引擎 ----
export const comfyEngineStatus = (): Promise<ComfyEngineStatus | null> => {
  const b = comfyBridge()
  return b ? b.engineStatus().catch(() => null) : Promise.resolve(null)
}
type EngineOpResult = { ok: boolean; status?: ComfyEngineStatus; error?: string }
export const comfyEngineInstall = (): Promise<EngineOpResult> => {
  const b = comfyBridge()
  return b ? b.engineInstall() : Promise.resolve({ ok: false, error: '仅桌面端可用' })
}
export const comfyEngineStart = (): Promise<EngineOpResult> => {
  const b = comfyBridge()
  return b ? b.engineStart() : Promise.resolve({ ok: false, error: '仅桌面端可用' })
}
export const comfyEngineStop = () => comfyBridge()?.engineStop()
export const comfyEnginePause = () => comfyBridge()?.enginePause()
export const comfyEnginePurge = () => comfyBridge()?.enginePurge()
export const comfyEngineUninstall = () => comfyBridge()?.engineUninstall()
export const comfyEngineAdopt = (dir: string) => {
  const b = comfyBridge()
  return b ? b.engineAdopt(dir) : Promise.resolve({ ok: false, error: '仅桌面端可用' })
}
export const comfyEngineDetach = () => comfyBridge()?.engineDetach()

/** 上次下载有没有没下完的残留（进工作流模式时用来弹窗问一句） */
export const comfyDownloadState = (): Promise<DownloadState | null> => {
  const b = comfyBridge()
  if (!b?.downloadState) return Promise.resolve(null)
  return b.downloadState().catch(() => null)
}
export const onComfyResumeAvailable = (cb: (p: { partial: boolean; installed: boolean }) => void) => {
  const b = comfyBridge()
  return b?.onResumeAvailable ? b.onResumeAvailable(cb) : () => {}
}
export const openComfyLog = (): Promise<{ ok: boolean; path?: string; error?: string }> => {
  const b = comfyBridge()
  return b?.openLog ? b.openLog() : Promise.resolve({ ok: false, error: '仅桌面端可用' })
}
export const onComfyEngineProgress = (cb: (p: ComfyEngineProgress) => void) => {
  const b = comfyBridge()
  return b ? b.onEngineProgress(cb) : () => {}
}
export const onComfyEngineStatus = (cb: (s: ComfyEngineStatus) => void) => {
  const b = comfyBridge()
  return b ? b.onEngineStatus(cb) : () => {}
}

export const probeHardware = (): Promise<HardwareInfo | null> => {
  const b = sysBridge()
  if (!b) return Promise.resolve(null)
  return b.hardware().catch(() => null)
}

export const probeEnvironment = (): Promise<EnvironmentInfo | null> => {
  const b = sysBridge()
  if (!b?.environment) return Promise.resolve(null)
  return b.environment().catch(() => null)
}

export const runMockTest = (scenario: string): Promise<MockTestResult | null> => {
  const b = sysBridge()
  if (!b?.mockTest) return Promise.resolve(null)
  return b.mockTest(scenario).catch(() => null)
}

/** 进度小数（0~1）→ 百分比文本，最多两位小数 */
export const fmtPct = (frac: number) => String(Math.round(frac * 10000) / 100)

/**
 * 硬件评估：显存优先取 ComfyUI 上报的（准），离线时退到系统探测。
 * 流畅 = 显存≥8G 且内存≥16G；凑合 = 显存≥4G 且内存≥8G；再低就是不建议。
 */
export function evalHardware(hw: HardwareInfo | null, comfy: ComfyStatus | null): HwEval {
  const sysVram = hw?.gpus?.length ? Math.max(...hw.gpus.map((g) => g.vramGb || 0)) : 0
  const comfyVram = comfy?.gpus?.length ? Math.max(...comfy.gpus.map((g) => g.vramGb || 0)) : 0
  const maxVramGb = comfyVram || sysVram
  const totalRamGb = hw?.totalRamGb || 0

  let tier: HwTier = 'poor'
  if (maxVramGb >= 8 && totalRamGb >= 16) tier = 'smooth'
  else if (maxVramGb >= 4 && totalRamGb >= 8) tier = 'ok'
  else if (maxVramGb === 0 && totalRamGb >= 16) tier = 'ok' // 纯 CPU 慢跑

  const gpuName = comfy?.gpus?.[0]?.name || hw?.gpus?.[0]?.name || '未识别到独立显卡'
  const vramText = maxVramGb > 0 ? `${maxVramGb}G 显存` : '无可用显存'
  const summary =
    tier === 'smooth'
      ? `${gpuName}（${vramText}）+ ${totalRamGb}G 内存，可流畅运行全部工作流`
      : tier === 'ok'
        ? `${gpuName}（${vramText}）+ ${totalRamGb}G 内存，适合运行轻量级工作流，高负载任务耗时较长`
        : `${gpuName}（${vramText}）+ ${totalRamGb}G 内存，硬件配置较低，建议优先选用 SD1.5 轻量工作流`
  return { tier, maxVramGb, totalRamGb, summary }
}
