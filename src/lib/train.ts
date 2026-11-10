// LoRA 训练在渲染进程一侧的封装：训练跑在主进程 + ComfyUI 自带的 Python 上。
export interface TrainEnvStatus {
  ready: boolean
  scripts: boolean
  deps: boolean
  training: boolean
  pythonReady: boolean
  outputDir?: string
  error?: string
}

export interface TrainProgress {
  phase: string
  label: string
  percent?: number
  received?: number
  total?: number
}

export interface TrainConfig {
  datasetDir: string
  outputName: string
  activation: string
  caption: string
  baseModel: string
  resolution: number
  epochs: number
  lr: number
  dim: number
  alpha: number
  lowvram: boolean
}

interface TrainBridge {
  status: () => Promise<TrainEnvStatus>
  setup: () => Promise<{ ok: boolean; error?: string }>
  start: (cfg: Partial<TrainConfig>) => Promise<{ ok: boolean; error?: string }>
  stop: () => Promise<{ ok: boolean }>
  pickDataset: () => Promise<string | null>
  reveal: () => Promise<{ ok: boolean; path?: string; error?: string }>
  onLog: (cb: (t: string) => void) => () => void
  onProgress: (cb: (p: TrainProgress) => void) => () => void
}

function bridge(): TrainBridge | null {
  const w = window as unknown as { lintools?: { train?: TrainBridge } }
  return w.lintools?.train ?? null
}

export const trainStatus = (): Promise<TrainEnvStatus | null> => {
  const b = bridge()
  return b ? b.status().catch(() => null) : Promise.resolve(null)
}

export const trainSetup = () => bridge()?.setup() ?? Promise.resolve({ ok: false, error: '仅桌面端可用' })
export const trainStart = (cfg: Partial<TrainConfig>) =>
  bridge()?.start(cfg) ?? Promise.resolve({ ok: false, error: '仅桌面端可用' })
export const trainStop = () => bridge()?.stop() ?? Promise.resolve({ ok: false })
export const trainPickDataset = (): Promise<string | null> => {
  const b = bridge()
  return b ? b.pickDataset().catch(() => null) : Promise.resolve(null)
}
export const trainReveal = () => bridge()?.reveal() ?? Promise.resolve({ ok: false, error: '仅桌面端可用' })
export const onTrainLog = (cb: (t: string) => void) => {
  const b = bridge()
  return b ? b.onLog(cb) : () => {}
}
export const onTrainProgress = (cb: (p: TrainProgress) => void) => {
  const b = bridge()
  return b ? b.onProgress(cb) : () => {}
}
