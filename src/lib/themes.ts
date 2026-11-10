// 主题系统：不止换颜色，连字体、圆角、发光一起换。
// 原理：给 <html> 打 data-theme，themes.css 里按属性选择器整套覆盖。
export interface ThemeDef {
  id: string
  name: string
  desc: string
  /** 主题代表色，画背景动画和预览圆点用 */
  accent: string
  /** canvas 背景动画用的 rgb 三元组 */
  accentRgb: string
  /** 推荐字体名（给用户照着找的） */
  font: string
  /** 字体文件放进 fonts 目录后生效的文件名 */
  fontFile: string
}

export const THEMES: ThemeDef[] = [
  { id: 'neon', name: '暗夜霓虹', desc: '默认。以 logo 为基调，银紫荧光、加粗黑体。', accent: '#b9aefc', accentRgb: '185,174,252', font: 'Adobe 黑体 Std', fontFile: 'AdobeHeitiStd.otf' },
  { id: 'ink', name: '水墨丹青', desc: '宣纸纹理背景搭配水墨色调与传统书法字体。', accent: '#44403c', accentRgb: '68,64,60', font: '今昔豪龙', fontFile: 'JinXiHaoLong.otf' },
  { id: 'paper', name: '白昼纸墨', desc: '米白纸面、墨色靛蓝，翻书的感觉。', accent: '#4f46e5', accentRgb: '79,70,229', font: '思源宋体', fontFile: 'SourceHanSerifSC.otf' },
  { id: 'violet', name: '赛博紫夜', desc: '深邃暗紫背景搭配高对比霓虹紫红高光。', accent: '#a78bfa', accentRgb: '167,139,250', font: '站酷高端黑', fontFile: 'ZcoolGaoDuanHei.ttf' },
  { id: 'mono', name: '雾灰极简', desc: '中性灰阶配色、直角边框与等宽字体，呈现极简工业风格。', accent: '#a1a1aa', accentRgb: '161,161,170', font: '更纱黑体 Mono SC', fontFile: 'SarasaMonoSC.ttf' },
]

const KEY = 'lin-toolbox-theme'
export const THEME_EVENT = 'lin-theme-changed'

export function currentThemeId(): string {
  try {
    return localStorage.getItem(KEY) || 'neon'
  } catch {
    return 'neon'
  }
}

export function currentTheme(): ThemeDef {
  return THEMES.find((t) => t.id === currentThemeId()) || THEMES[0]
}

/** 启动时调用：只贴属性，不广播（界面还没画） */
export function initTheme() {
  document.documentElement.dataset.theme = currentThemeId()
}

/** 设置面板里切换主题：贴属性 + 存本地 + 广播给背景动画 */
export function applyTheme(id: string) {
  if (!THEMES.some((t) => t.id === id)) id = 'neon'
  document.documentElement.dataset.theme = id
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: id }))
}
