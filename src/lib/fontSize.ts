// 全局字号：改 <html> 的 font-size，界面里 rem 单位会跟着整体缩放。
export interface FontSizeDef {
  id: string
  name: string
  px: number
}

export const FONT_SIZES: FontSizeDef[] = [
  { id: 'small', name: '小', px: 14 },
  { id: 'standard', name: '标准', px: 16 },
  { id: 'large', name: '大', px: 18 },
  { id: 'xlarge', name: '特大', px: 20 },
]

const KEY = 'lin-toolbox-fontsize'
// 默认「大」，老板嫌字小
const DEFAULT_ID = 'large'

export function currentFontSizeId(): string {
  try {
    const v = localStorage.getItem(KEY)
    if (v && FONT_SIZES.some((s) => s.id === v)) return v
  } catch {
    /* ignore */
  }
  return DEFAULT_ID
}

export function currentFontSize(): FontSizeDef {
  return FONT_SIZES.find((s) => s.id === currentFontSizeId()) || FONT_SIZES[2]
}

/** 启动时调用：界面画出来之前就贴好字号，避免闪一下 */
export function initFontSize() {
  document.documentElement.style.fontSize = `${currentFontSize().px}px`
}

/** 设置面板里切换字号：贴样式 + 存本地 */
export function applyFontSize(id: string) {
  const s = FONT_SIZES.find((x) => x.id === id) || FONT_SIZES[2]
  document.documentElement.style.fontSize = `${s.px}px`
  try {
    localStorage.setItem(KEY, s.id)
  } catch {
    /* ignore */
  }
}
