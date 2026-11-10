// 本地文本识别：把用户随口写的一句中文，拆成「主体 + 已命中的效果词 + 还缺什么」。
// 全是关键词规则，不联网、不调用模型，毫秒级返回。
import { PROMPT_CATEGORIES, type PromptOption } from './prompts'

export interface Hit {
  catId: string
  label: string
  en: string
}

export interface MissingSlot {
  catId: string
  name: string
  /** 一句话说清这项管什么，界面直接用 */
  why: string
  options: PromptOption[]
}

export interface Analysis {
  /** 识别出的主体短语，空字符串表示没看懂 */
  subject: string
  /** 命中的效果词 */
  hits: Hit[]
  /** 已覆盖的分类 */
  filled: string[]
  /** 还差哪几项，按补齐顺序 */
  missing: MissingSlot[]
  /** 能不能直接生成 */
  canCompose: boolean
  /** 用户写了「9比16」「16:9」这类比例时给出方向，没写就是 null */
  aspect: 'portrait' | 'landscape' | 'square' | null
  /** 给用户看的一句话 */
  hint: string
}

// 主体：出现这些词就认为用户已经说了「画什么」
const SUBJECT_WORDS = [
  // 人
  '人', '女', '男', '少女', '少年', '女孩', '男孩', '女人', '男人', '老人', '孩子', '宝宝',
  '少女感', '女仆', '骑士', '王子', '公主', '国王', '女王', '刺客', '忍者', '法师', '巫师',
  '歌手', '偶像', '舞者', '武士', '牛仔', '女巫', '吸血鬼', '天使', '恶魔', '修女', '道士',
  '精灵', '龙', '萝莉', '正太', '大叔', '哥特', 'jk', 'JK',
  // 动物
  '猫', '狗', '狼', '狐', '鸟', '马', '鱼', '鹿', '兔', '熊', '虎', '蛇', '鲸', '熊猫',
  // 机器与载具
  '机器人', '机甲', '飞船', '汽车', '摩托', '列车', '战舰', '高达',
  // 场景建筑
  '城市', '建筑', '街', '房间', '森林', '海', '山', '咖啡', '花', '树', '城堡',
  '教堂', '学校', '校园', '图书馆', '神社', '鸟居', '高塔', '桥', '废墟', '沙漠', '太空',
  // 物件食物
  '蛋糕', '玩偶', '手办', '盲盒', '剑', '刀', '枪', '书', '伞', '灯',
  // 风格类主体词
  '赛博', '古风', '汉服', '西式', '和服', '洛丽塔', '军装', '婚纱',
]

// 常见说法到效果词的映射，命中后按对应分类算「已有」
const SYNONYMS: Array<{ k: string[]; catId: string; label: string; en: string }> = [
  // 时间天气
  { k: ['夜晚', '夜里', '深夜', '晚上'], catId: 'timeweather', label: '夜晚', en: 'nighttime, dark ambient' },
  { k: ['白天', '阳光', '晴天'], catId: 'lighting', label: '自然光', en: 'natural daylight, soft sunlight' },
  { k: ['黄昏', '日落', '傍晚'], catId: 'lighting', label: '黄金时刻', en: 'golden hour light, warm sunset glow' },
  { k: ['清晨', '黎明', '日出'], catId: 'lighting', label: '清晨', en: 'early morning light, soft dawn' },
  { k: ['雨', '下雨'], catId: 'timeweather', label: '雨天', en: 'rainy day, rain drops' },
  { k: ['雪', '下雪', '冬天'], catId: 'timeweather', label: '雪景', en: 'snowy scene, falling snowflakes' },
  { k: ['雾'], catId: 'timeweather', label: '雾气', en: 'misty atmosphere, soft fog' },
  { k: ['樱花'], catId: 'timeweather', label: '樱花季', en: 'cherry blossom season, falling petals' },
  { k: ['枫叶', '秋天'], catId: 'timeweather', label: '秋日红叶', en: 'autumn maple leaves' },
  // 画风
  { k: ['霓虹', '赛博朋克', '赛博'], catId: 'style', label: '赛博朋克', en: 'cyberpunk style, neon-soaked city' },
  { k: ['厚涂'], catId: 'style', label: '厚涂插画', en: 'thick impasto illustration' },
  { k: ['水彩'], catId: 'style', label: '水彩手绘', en: 'watercolor painting, hand-drawn texture' },
  { k: ['油画'], catId: 'style', label: '油画古典', en: 'classical oil painting' },
  { k: ['浮世绘'], catId: 'style', label: '浮世绘', en: 'ukiyo-e woodblock print style' },
  { k: ['水墨'], catId: 'style', label: '国风水墨', en: 'chinese ink painting style' },
  { k: ['写实', '照片', '摄影'], catId: 'style', label: '写实摄影', en: 'photorealistic, ultra-detailed photography' },
  { k: ['二次元', '动漫', '日系'], catId: 'style', label: '日系动漫', en: 'anime style, japanese illustration' },
  { k: ['古风', '国风'], catId: 'style', label: '国风水墨', en: 'chinese ink painting style' },
  { k: ['像素'], catId: 'style', label: '像素艺术', en: 'pixel art, retro game style' },
  { k: ['3D', '盲盒'], catId: 'style', label: '3D 渲染', en: '3D render, polished CGI' },
  { k: ['蒸汽波'], catId: 'style', label: '蒸汽波', en: 'vaporwave aesthetic, retro digital' },
  { k: ['梦核'], catId: 'style', label: '梦核', en: 'dreamcore, surreal nostalgic atmosphere' },
  { k: ['胶片', '复古'], catId: 'style', label: '复古胶片', en: 'retro film photography, grain texture' },
  { k: ['哥特'], catId: 'style', label: '哥特暗黑', en: 'gothic dark aesthetic' },
  // 场景
  { k: ['房间', '屋里', '室内', '卧室'], catId: 'scene', label: '温馨卧室', en: 'cozy bedroom interior' },
  { k: ['街'], catId: 'scene', label: '都市夜景', en: 'urban night street' },
  { k: ['森林', '树林'], catId: 'scene', label: '森林秘境', en: 'mysterious forest' },
  { k: ['海边', '沙滩', '海'], catId: 'scene', label: '海边黄昏', en: 'seaside at dusk' },
  { k: ['太空', '宇宙', '星'], catId: 'scene', label: '太空舱内', en: 'space station interior, stars outside' },
  { k: ['废墟'], catId: 'scene', label: '废墟', en: 'abandoned ruins, overgrown' },
  { k: ['教堂'], catId: 'scene', label: '教堂彩窗', en: 'church interior with stained glass' },
  { k: ['咖啡馆'], catId: 'scene', label: '咖啡馆', en: 'cozy coffee shop' },
  { k: ['图书馆'], catId: 'scene', label: '图书馆', en: 'old library, tall bookshelves' },
  { k: ['沙漠'], catId: 'scene', label: '沙漠', en: 'vast desert dunes' },
  { k: ['雪山', '雪山巅'], catId: 'scene', label: '雪山', en: 'snow-capped mountains' },
  { k: ['樱花'], catId: 'scene', label: '樱花道', en: 'cherry blossom path' },
  // 构图与镜头
  { k: ['特写'], catId: 'composition', label: '面部特写', en: 'close-up on face' },
  { k: ['全身'], catId: 'composition', label: '全身立绘', en: 'full body shot' },
  { k: ['半身'], catId: 'composition', label: '半身肖像', en: 'half body portrait' },
  { k: ['俯视', '鸟瞰'], catId: 'composition', label: '俯视', en: 'top-down bird view' },
  { k: ['仰视'], catId: 'composition', label: '仰视', en: 'low angle looking up' },
  { k: ['拍摄角度', '度角', '°'], catId: 'composition', label: '指定角度', en: 'specific camera angle' },
  { k: ['景深', '虚化'], catId: 'composition', label: '背景虚化', en: 'shallow depth of field, bokeh' },
  // 色调
  { k: ['冷调', '冷色调'], catId: 'color', label: '冷色调', en: 'cold color palette' },
  { k: ['暖调', '暖色调'], catId: 'color', label: '暖色调', en: 'warm color palette' },
  { k: ['黑白'], catId: 'color', label: '黑白', en: 'monochrome, black and white' },
  { k: ['粉', '粉色'], catId: 'color', label: '粉色系', en: 'soft pink palette' },
]

/** 依次补齐的顺序：先环境再风格，最后光影和构图 */
const FILL_ORDER: Array<{ catId: string; name: string; why: string }> = [
  { catId: 'scene', name: '场景', why: '环境背景' },
  { catId: 'style', name: '画风', why: '画面风格' },
  { catId: 'lighting', name: '光影', why: '光线明暗' },
  { catId: 'composition', name: '构图', why: '视角景别' },
]

function findCategory(catId: string) {
  return PROMPT_CATEGORIES.find((c) => c.id === catId)
}

/** 取几个常用项当候选（不打散原有顺序，取前几个） */
function candidates(catId: string, take = 6): PromptOption[] {
  const cat = findCategory(catId)
  return cat ? cat.options.slice(0, take) : []
}

export function analyzeText(raw: string): Analysis {
  const text = (raw || '').trim()
  const hits: Hit[] = []
  const filled = new Set<string>()

  const push = (h: Hit) => {
    if (hits.some((x) => x.en === h.en || x.label === h.label)) return
    hits.push(h)
    filled.add(h.catId)
  }

  // 按标点切成小段，逐段归类：哪段是主体、哪段说的是风格/光影/角度……
  // 这样「一个女生，35度拍摄角度」就不会把整串当成主体
  const segments = text
    .split(/[,，。;；、\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)

  // 1) 逐段命中同义词和词库标签，并记下哪一段说了效果词
  const segMatched = segments.map(() => false)
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const segLower = seg.toLowerCase()
    const before = hits.length
    for (const s of SYNONYMS) {
      if (s.k.some((k) => segLower.includes(k.toLowerCase()))) {
        push({ catId: s.catId, label: s.label, en: s.en })
      }
    }
    for (const cat of PROMPT_CATEGORIES) {
      for (const opt of cat.options) {
        if (!opt.label) continue
        if (seg.includes(opt.label)) push({ catId: cat.id, label: opt.label, en: opt.en })
      }
    }
    if (hits.length > before) segMatched[i] = true
  }

  // 2) 主体：第一个含有主体词的小段，只留这一段，不把整句都算成主体；
  //    认不出「谁/什么」时，把第一个没说效果词的小段当主体；段段都在说效果就拿第一段。
  //    用户随口写的词不该被判成「主体不明确」。
  let subject = ''
  for (const seg of segments) {
    if (SUBJECT_WORDS.some((w) => seg.includes(w))) {
      subject = seg
      break
    }
  }
  if (!subject && segments.length > 0) {
    subject = segments.find((_, i) => !segMatched[i]) || segments[0]
  }
  const longEnough = text.replace(/\s+/g, '').length >= 4

  // 画面比例：「9比16」「16:9」「3：4」这种写法都认
  let aspect: Analysis['aspect'] = null
  const rm = text.match(/(\d{1,2})\s*[:：比]\s*(\d{1,2})/)
  if (rm) {
    const w = Number(rm[1])
    const h = Number(rm[2])
    if (w > 0 && h > 0) aspect = w === h ? 'square' : w > h ? 'landscape' : 'portrait'
  }

  // 3) 还缺什么
  const missing: MissingSlot[] = []
  for (const slot of FILL_ORDER) {
    if (filled.has(slot.catId)) continue
    const opts = candidates(slot.catId)
    if (!opts.length) continue
    missing.push({ catId: slot.catId, name: slot.name, why: slot.why, options: opts })
  }

  // 4) 判定：主体兜底后，只要写了东西就能生成，缺的只当建议
  let canCompose = false
  let hint = ''
  if (!text) {
    hint = '请输入画面描述以自动识别要素'
  } else if (!longEnough) {
    hint = '再写几个字，描述更清楚些'
  } else {
    canCompose = true
    if (filled.size === 0) {
      hint = '可直接生成，也可补充场景与画风'
    } else {
      hint = missing.length ? `可直接生成，也可补充 ${missing.length} 项细节` : '要素完整，可直接生成图像'
    }
  }

  return { subject, hits, filled: [...filled], missing, canCompose, aspect, hint }
}
