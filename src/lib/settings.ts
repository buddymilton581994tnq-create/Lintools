// 软件设置：部署路径、图片保存位置、导入外部整合包。浏览器里没有桥，全部安全降级。
import type { AiStatus } from './localLlm'
import type { ComfyEngineStatus } from './comfyui'

export interface AppDirs {
  aiDir: string
  comfyDir: string
  imgDir: string
  aiDirCustom: boolean
  comfyDirCustom: boolean
  imgDirCustom: boolean
  comfyExternal: { root: string; pythonExe: string; mainPy: string } | null
  /** ComfyUI 是否开机后台自动启动（默认 true） */
  comfyAutoStart?: boolean
}

export interface ComfyPaths {
  deployed: boolean
  nodesDir: string
  modelsDir: string
  nodesLinked: boolean
  modelsLinked: boolean
}

interface SettingsBridge {
  get: () => Promise<AppDirs>
  pickDir: (title?: string) => Promise<string | null>
  setAiDir: (dir: string | null) => Promise<AiStatus>
  setComfyDir: (dir: string | null) => Promise<ComfyEngineStatus>
  setImgDir: (dir: string | null) => Promise<{ ok: boolean; dir?: string; error?: string }>
  setComfyAuto?: (on: boolean) => Promise<{ ok: boolean; comfyAutoStart: boolean }>
}

interface ImagesBridge {
  save: (dataUrl: string, name: string) => Promise<{ ok: boolean; path?: string; dir?: string; error?: string }>
}

interface ComfyPathsBridge {
  get: () => Promise<ComfyPaths>
  move: (kind: 'nodes' | 'models', target: string | null) => Promise<{ ok: boolean; error?: string }>
}

function settingsBridge(): SettingsBridge | null {
  const w = window as unknown as { lintools?: { settings?: SettingsBridge } }
  return w.lintools?.settings ?? null
}

function imagesBridge(): ImagesBridge | null {
  const w = window as unknown as { lintools?: { images?: ImagesBridge } }
  return w.lintools?.images ?? null
}

function comfyPathsBridge(): ComfyPathsBridge | null {
  const w = window as unknown as { lintools?: { comfyPaths?: ComfyPathsBridge } }
  return w.lintools?.comfyPaths ?? null
}

export const getAppDirs = (): Promise<AppDirs | null> => {
  const b = settingsBridge()
  return b ? b.get().catch(() => null) : Promise.resolve(null)
}

export const pickDir = (title?: string): Promise<string | null> => {
  const b = settingsBridge()
  return b ? b.pickDir(title).catch(() => null) : Promise.resolve(null)
}

export const setAiDir = (dir: string | null) => settingsBridge()?.setAiDir(dir)
export const setComfyDir = (dir: string | null) => settingsBridge()?.setComfyDir(dir)
export const setComfyAuto = (on: boolean) =>
  settingsBridge()?.setComfyAuto?.(on) ?? Promise.resolve({ ok: false, comfyAutoStart: on })
export const setImgDir = (dir: string | null) =>
  settingsBridge()?.setImgDir(dir) ?? Promise.resolve({ ok: false, error: '仅桌面端可用' })

/** 把一张图存进图片保存目录，返回完整路径 */
export const saveImageToDir = (
  dataUrl: string,
  name: string,
): Promise<{ ok: boolean; path?: string; dir?: string; error?: string }> => {
  const b = imagesBridge()
  return b ? b.save(dataUrl, name) : Promise.resolve({ ok: false, error: '仅桌面端可用' })
}

/** 云端返回的临时图片链接交给后端下载落盘，防链接过期和跨域拦截 */
export const fetchImageToDir = (
  url: string,
  name: string,
): Promise<{ ok: boolean; path?: string; dataUrl?: string; error?: string }> => {
  const w = window as unknown as { lintools?: { images?: { fetchUrl?: (u: string, n: string) => Promise<{ ok: boolean; path?: string; dataUrl?: string; error?: string }> } } }
  const fn = w.lintools?.images?.fetchUrl
  return fn ? fn(url, name) : Promise.resolve({ ok: false, error: '仅桌面端可用' })
}

export const getComfyPaths = (): Promise<ComfyPaths | null> => {
  const b = comfyPathsBridge()
  return b ? b.get().catch(() => null) : Promise.resolve(null)
}

export const moveComfyPath = (kind: 'nodes' | 'models', target: string | null) => {
  const b = comfyPathsBridge()
  return b ? b.move(kind, target) : Promise.resolve({ ok: false, error: '仅桌面端可用' })
}
