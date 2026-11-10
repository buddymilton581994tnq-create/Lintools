// 模型中心：按功能分类的模型目录，一键下载到 ComfyUI 的 models 目录。
export interface ModelItem {
  id: string
  cat: string
  catName: string
  name: string
  file: string
  sizeLabel: string
  desc: string
  /** 综合评级：S 必装 / A 推荐 / B 好用 / C 备选 / D 玩玩 */
  rating?: string
  /** 功能评级：能做多少事、覆盖多少场景 */
  ratingFunc?: string
  /** 呈现效果评级：出图精细度、审美表现 */
  ratingEff?: string
  downloaded: boolean
  downloading: boolean
}

export interface ModelProgress {
  id: string
  received?: number
  total?: number
  percent?: number
  done?: boolean
}

interface ModelsBridge {
  list: () => Promise<ModelItem[]>
  download: (id: string) => Promise<{ ok: boolean; list?: ModelItem[]; error?: string }>
  onProgress: (cb: (p: ModelProgress) => void) => () => void
}

function modelsBridge(): ModelsBridge | null {
  const w = window as unknown as { lintools?: { models?: ModelsBridge } }
  return w.lintools?.models ?? null
}

export const modelList = (): Promise<ModelItem[]> => {
  const b = modelsBridge()
  return b ? b.list().catch(() => []) : Promise.resolve([])
}

export const modelDownload = (id: string): Promise<{ ok: boolean; list?: ModelItem[]; error?: string }> => {
  const b = modelsBridge()
  return b ? b.download(id) : Promise.resolve({ ok: false, error: '仅桌面端可用' })
}

export const onModelProgress = (cb: (p: ModelProgress) => void) => {
  const b = modelsBridge()
  return b ? b.onProgress(cb) : () => {}
}
