// ---------------------------------------------------------------------------
// 绘画百科与专业视觉语料引擎（Corpus Engine v3）
// ---------------------------------------------------------------------------
// 职责：
//  1. 检索封存的 1030+ 组跨领域百科词库（corpus-library.json），覆盖 70 个细分专业类目。
//  2. 提供重叠消歧与最长词优先匹配的词汇解析（matchSlangGlossary），避免短词误触发。
//  3. 提供多维度的题材语境感知（detectInputContext）与多样性均衡推荐（buildFallbackOrMergeFields）。
//  4. 严格遵循用户输入与已选标签合成英文提示词（translateWithGlossary），过滤模型幻觉与口水话。
// ---------------------------------------------------------------------------

const fs = require('fs')
const path = require('path')

// 人体解剖与敏感部位保底词表。
// 外部词库缺这些词时，剩下的话会交给模型自由翻译，
// 模型容易把「肛门」理解成「门」、「乳头」理解成「头」，输出 door / head。
// 这几组词不依赖 external JSON，永久内建，且优先级高于词库同名条目。
const ANATOMY_SAFEGUARD = [
  { cat: '人体解剖', label: '乳头', terms: ['乳头', '奶头', '凸点'], en: 'nipples' },
  { cat: '人体解剖', label: '乳晕', terms: ['乳晕'], en: 'areolae' },
  { cat: '人体解剖', label: '乳房', terms: ['乳房', '胸部', '胸'], en: 'breasts' },
  { cat: '人体解剖', label: '巨乳', terms: ['巨乳', '大胸', '丰满胸部'], en: 'large breasts' },
  { cat: '人体解剖', label: '贫乳', terms: ['贫乳', '平胸', '小胸'], en: 'flat chest' },
  { cat: '人体解剖', label: '乳沟', terms: ['乳沟', '事业线'], en: 'cleavage' },
  { cat: '人体解剖', label: '肛门', terms: ['肛门', '菊花', '后穴'], en: 'anus' },
  { cat: '人体解剖', label: '臀部', terms: ['臀部', '屁股', '翘臀', '美臀'], en: 'ass' },
  { cat: '人体解剖', label: '阴部', terms: ['阴部', '私处', '下体', '阴户'], en: 'pussy' },
  { cat: '人体解剖', label: '大腿', terms: ['大腿', '大腿内侧'], en: 'thighs' },
  { cat: '人体解剖', label: '小腿', terms: ['小腿'], en: 'calves' },
  { cat: '人体解剖', label: '脚趾', terms: ['脚趾', '足趾'], en: 'toes' },
  { cat: '人体解剖', label: '脚底', terms: ['脚底', '足底', '脚掌'], en: 'soles' },
  { cat: '人体解剖', label: '腋下', terms: ['腋下', '腋窝'], en: 'armpits' },
  { cat: '人体解剖', label: '肚脐', terms: ['肚脐', '脐'], en: 'navel' },
  { cat: '人体解剖', label: '锁骨', terms: ['锁骨'], en: 'collarbone' },
  { cat: '人体解剖', label: '舌头', terms: ['舌头', '舌'], en: 'tongue' },
  { cat: '人体解剖', label: '口水', terms: ['口水', '唾液', '涎'], en: 'saliva' },
  { cat: '人体解剖', label: '汗水', terms: ['汗水', '汗珠', '流汗'], en: 'sweat' },
  { cat: '人体解剖', label: '泪水', terms: ['泪水', '眼泪'], en: 'tears' },
  { cat: '人体解剖', label: '后背', terms: ['后背', '背部'], en: 'back' },
  { cat: '人体解剖', label: '颈脖', terms: ['脖子', '颈脖', '颈部'], en: 'neck' },
]

// 二次元术语与简称保底表。
// 小模型对这类词基本不可用：实测「卓尔」会被解释成"汉语词汇，意思是卓越"，
// 「门」原样返回，「菊花」甚至翻成 daffodil（水仙）。词库没有的词必须内建。
const ANIME_SAFEGUARD = [
  { cat: '幻想种族与生物', label: '卓尔', terms: ['卓尔', '卓尔精灵', '黑暗精灵'], en: 'dark elf, drow, greyish purple skin, white hair, pointed ears' },
  { cat: '幻想种族与生物', label: '提夫林', terms: ['提夫林'], en: 'tiefling, demon horns, demon tail, colored skin, pointed ears' },
  { cat: '幻想种族与生物', label: '精灵耳', terms: ['精灵耳'], en: 'pointed ears' },
  { cat: '服饰与穿搭细节', label: '白色过膝袜', terms: ['白色过膝袜'], en: 'white thighhighs' },
  { cat: '服饰与穿搭细节', label: '黑色过膝袜', terms: ['黑色过膝袜'], en: 'black thighhighs' },
  { cat: '服饰与穿搭细节', label: '死库水', terms: ['死库水'], en: 'school swimsuit' },
  { cat: '服饰与穿搭细节', label: '机能风', terms: ['机能风'], en: 'techwear, cyberpunk jacket, tactical straps' },
  { cat: '人物与外貌特征', label: '猫耳', terms: ['猫耳'], en: 'cat ears' },
  { cat: '人体解剖', label: '凸点', terms: ['凸点'], en: 'covered nipples' },
  { cat: '人体解剖', label: '私处', terms: ['私处'], en: 'genitals' },
  { cat: '人体解剖', label: '腿环', terms: ['腿环'], en: 'thigh strap' },
  // 常见描述词：danbooru 中文表里也没有，或译名对不上
  { cat: '人体解剖', label: '睫毛', terms: ['睫毛'], en: 'eyelashes' },
  { cat: '人体解剖', label: '腰', terms: ['腰部', '细腰'], en: 'waist' },
  { cat: '发型发饰', label: '空气刘海', terms: ['空气刘海'], en: 'see-through bangs' },
  { cat: '发型发饰', label: '丸子头', terms: ['丸子头'], en: 'single hair bun' },
  { cat: '发型发饰', label: '双丸子头', terms: ['双丸子头', '双丸子'], en: 'twin buns' },
  { cat: '服饰与穿搭细节', label: 'JK制服', terms: ['jk制服'], en: 'serafuku, school uniform' },
  { cat: '服饰与穿搭细节', label: '渔网袜', terms: ['渔网袜'], en: 'fishnet pantyhose' },
  { cat: '表情与肢体动作', label: '歪头', terms: ['歪头'], en: 'head tilt' },
  // 动作词：词库只有静态姿势，这些手部与位移动作基本全缺
  { cat: '表情与肢体动作', label: '举剑', terms: ['举剑', '举刀', '举枪'], en: 'holding sword up, raised weapon' },
  { cat: '表情与肢体动作', label: '挥剑', terms: ['挥剑', '挥刀', '斩击'], en: 'swinging sword, sword slash' },
  { cat: '表情与肢体动作', label: '拔剑', terms: ['拔剑', '拔刀'], en: 'drawing sword' },
  { cat: '表情与肢体动作', label: '持剑', terms: ['持剑', '握剑', '拿着剑'], en: 'holding sword, gripping sword hilt' },
  { cat: '表情与肢体动作', label: '冲锋', terms: ['冲锋', '冲刺', '冲过来'], en: 'charging forward, dynamic action pose' },
  { cat: '表情与肢体动作', label: '奔跑', terms: ['奔跑', '跑动'], en: 'running' },
  { cat: '表情与肢体动作', label: '跳跃', terms: ['跳跃', '跳起'], en: 'jumping' },
  { cat: '表情与肢体动作', label: '跪地', terms: ['跪地', '跪倒'], en: 'kneeling on ground' },
  { cat: '表情与肢体动作', label: '蹲着', terms: ['蹲着', '蹲下'], en: 'squatting' },
  { cat: '表情与肢体动作', label: '倒地', terms: ['倒地', '倒下'], en: 'lying on ground, collapsed' },
  { cat: '表情与肢体动作', label: '仰卧', terms: ['仰卧', '仰躺'], en: 'lying on back' },
  { cat: '表情与肢体动作', label: '俯卧', terms: ['俯卧', '俯身'], en: 'lying prone' },
  { cat: '表情与肢体动作', label: '转身', terms: ['转身'], en: 'turning around' },
  { cat: '表情与肢体动作', label: '侧身', terms: ['侧身'], en: 'from side, side view' },
  { cat: '表情与肢体动作', label: '拥抱', terms: ['拥抱', '抱住'], en: 'hugging' },
  { cat: '表情与肢体动作', label: '牵手', terms: ['牵手', '十指相扣'], en: 'holding hands, interlocked fingers' },
  { cat: '表情与肢体动作', label: '比心', terms: ['比心', '爱心手势'], en: 'heart hands' },
  { cat: '表情与肢体动作', label: '招手', terms: ['招手', '挥手'], en: 'waving' },
  { cat: '表情与肢体动作', label: '敬礼', terms: ['敬礼'], en: 'saluting' },
  { cat: '表情与肢体动作', label: '遮脸', terms: ['遮脸', '挡住脸'], en: 'covering face' },
  { cat: '表情与肢体动作', label: '抚脸', terms: ['抚脸', '摸脸'], en: 'hand on own cheek' },
  { cat: '表情与肢体动作', label: '遮胸', terms: ['遮胸', '挡胸'], en: 'covering breasts, arm across chest' },
  { cat: '表情与肢体动作', label: '叉腰', terms: ['叉腰', '双手叉腰'], en: 'hands on hips' },
  { cat: '表情与肢体动作', label: '合十', terms: ['合十', '双手合十'], en: 'hands pressed together in prayer' },
  { cat: '表情与肢体动作', label: '抱膝', terms: ['抱膝', '抱住膝盖'], en: 'hugging own knees' },
  { cat: '表情与肢体动作', label: '仰头', terms: ['仰头', '抬头'], en: 'head up, looking up' },
  { cat: '表情与肢体动作', label: '低头', terms: ['低头'], en: 'head down, looking down' },
  { cat: '表情与肢体动作', label: '回头', terms: ['回头', '回眸'], en: 'looking back, turning around' },
  { cat: '场景与环境道具', label: '雪地', terms: ['雪地'], en: 'snow, snowy ground' },
  { cat: '场景与环境道具', label: '废墟', terms: ['废墟'], en: 'ruins' },
  { cat: '场景与环境道具', label: '沙漠', terms: ['沙漠'], en: 'desert' },
  { cat: '光线色调与画风构图扩充', label: '夕阳', terms: ['夕阳'], en: 'sunset' },
  { cat: '光线色调与画风构图扩充', label: '逆光', terms: ['逆光'], en: 'backlighting' },
  { cat: '光线色调与画风构图扩充', label: '侧光', terms: ['侧光'], en: 'side lighting' },
  { cat: '光线色调与画风构图扩充', label: '轮廓光', terms: ['轮廓光'], en: 'rim lighting' },
  { cat: '光线色调与画风构图扩充', label: '丁达尔效应', terms: ['丁达尔效应', '耶稣光'], en: 'god rays, volumetric lighting' },
  { cat: '构图与镜头视角', label: '广角', terms: ['广角'], en: 'wide angle' },
  { cat: '构图与镜头视角', label: '鱼眼', terms: ['鱼眼'], en: 'fisheye' },
  { cat: '构图与镜头视角', label: '仰视', terms: ['仰视'], en: 'from below' },
  { cat: '构图与镜头视角', label: '俯视', terms: ['俯视'], en: 'from above' },
  { cat: '构图与镜头视角', label: '背面', terms: ['背面'], en: 'from behind' },
]

function mergeAnatomySafeguard(lib) {
  // 无条件放在最前面。词库里可能有同名词条但意思完全不同
  // （比如「菊花」在花卉分类里是 chrysanthemum），保底表要先命中。
  return ANATOMY_SAFEGUARD.concat(ANIME_SAFEGUARD, COLOR_PART_SAFEGUARD, lib)
}

// 颜色 + 部位 的组合词。
// 词库只收固定短语，「黑色长发」「红瞳」这类现拼的组合必然落空，
// 落了空就会丢给模型自由发挥。这里按 13 色 × 10 部位预生成，约 130 条。
const COLOR_PART_SAFEGUARD = (() => {
  const colors = [
    ['黑', 'black'], ['白', 'white'], ['红', 'red'], ['蓝', 'blue'],
    ['绿', 'green'], ['紫', 'purple'], ['粉', 'pink'], ['橙', 'orange'],
    ['黄', 'yellow'], ['棕', 'brown'], ['灰', 'grey'], ['银', 'silver'],
  ]
  const parts = [
    ['长发', 'long hair'], ['短发', 'short hair'], ['卷发', 'curly hair'],
    ['头发', 'hair'], ['双马尾', 'twintails'], ['眼睛', 'eyes'],
    ['眼瞳', 'eyes'], ['瞳孔', 'eyes'], ['眉毛', 'eyebrows'], ['皮肤', 'skin'],
  ]
  // 中文里「红瞳」「红色瞳孔」两种写法都要能命中
  const prefixes = ['%s', '%s色']
  const out = []
  for (const [cc, ce] of colors) {
    for (const [pc, pe] of parts) {
      for (const p of prefixes) {
        const term = p.replace('%s', cc) + pc
        out.push({ cat: '颜色与部位', label: `${cc}${pc}`, terms: [term], en: `${ce} ${pe}` })
      }
    }
  }
  // 金发是 blonde，不是 gold hair
  out.push({ cat: '颜色与部位', label: '金发', terms: ['金发', '金色头发'], en: 'blonde hair' })
  out.push({ cat: '颜色与部位', label: '银发', terms: ['银发', '银色头发'], en: 'silver hair' })
  out.push({ cat: '颜色与部位', label: '红瞳', terms: ['红瞳', '红色瞳孔', '血色瞳孔'], en: 'red eyes' })
  return out
})()

let _cachedLib = null
let _cachedAt = 0
let _cachedMtime = 0

/**
 * 加载百科词库（优先读取内置最新词库，若外部自定义目录存在更新的词库则按修改时间择优）
 */
function loadLibrary(customDirs = []) {
  const now = Date.now()
  if (_cachedLib && now - _cachedAt < 30000) return _cachedLib

  const bundledPath = path.join(__dirname, 'corpus-library.json')
  const candidates = [bundledPath]
  for (const d of customDirs) {
    if (!d) continue
    candidates.push(path.join(d, 'runtime', 'corpus-library.json'))
    candidates.push(path.join(d, 'corpus-library.json'))
  }

  let bestPath = null
  let bestSize = -1
  let bestMtime = -1

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue
      const st = fs.statSync(p)
      if (!st.isFile() || st.size < 1024) continue
      // 优先选择条目更丰富或更新的词库版本
      if (st.size > bestSize || (st.size === bestSize && st.mtimeMs > bestMtime)) {
        bestPath = p
        bestSize = st.size
        bestMtime = st.mtimeMs
      }
    } catch {
      /* ignore */
    }
  }

  if (bestPath) {
    try {
      if (_cachedLib && bestMtime === _cachedMtime) {
        _cachedAt = now
        return _cachedLib
      }
      const raw = JSON.parse(fs.readFileSync(bestPath, 'utf8'))
      if (Array.isArray(raw) && raw.length > 0) {
        _cachedLib = mergeAnatomySafeguard(raw)
        _cachedAt = now
        _cachedMtime = bestMtime
        return _cachedLib
      }
    } catch {
      /* try fallback */
    }
  }

  _cachedLib = mergeAnatomySafeguard([])
  return _cachedLib
}

// ---------------------------------------------------------------------------
// 维度分类映射：严格采用用户定义的 8 大分类体系
// ---------------------------------------------------------------------------
const CATEGORY_TO_DIM = [
  {
    dim: '人物与外貌特征',
    short: '人物与外貌特征',
    preferred: ['双马尾', '呆毛', '姬发式', '黑长直', '异色瞳', '三白眼', '丹凤吊眼角', '银发', '精灵尖耳', '成熟御姐', '清秀美少年'],
    fallback: [
      { label: '双马尾', en: 'twintails, twin high pigtails' },
      { label: '呆毛', en: 'single hair strand sticking up, ahoge' },
      { label: '姬发式', en: 'hime cut, straight bangs with cheek-length sidelocks' },
      { label: '异色瞳', en: 'heterochromia, two different colored eyes' },
      { label: '柔顺黑长直', en: 'long straight black hair' },
      { label: '月白银发', en: 'platinum silver-white hair' },
    ],
    why: '发色瞳色与体态特征',
    cats: [
      '人物与外貌特征',
      '人物与亚文化',
      '幻想种族与生物',
      '职业与身份设定',
      '发型发饰',
      '发色与染发工艺',
      '眼瞳、五官与妆容纹饰',
      '身材与解剖细节',
      '发型细分扩充',
      '二次元身体与皮肤特征',
    ],
    aliases: ['人物与外貌特征', '人物', '角色', '主体', '人物外貌', '外貌', '发型', '发色', '五官', '眼睛', '眼瞳', '面容', '身份'],
  },
  {
    dim: '服装与穿搭细节',
    short: '服装与穿搭细节',
    preferred: ['水手服', '汉服', '旗袍', '绝对领域', '连衣裙', '白衬衫', '洛丽塔', '巫女服', '连裤袜', '露肩穿法', '分离式袖子'],
    fallback: [
      { label: '水手服', en: 'Japanese sailor school uniform, serafuku' },
      { label: '汉服', en: 'traditional Chinese hanfu, flowing wide sleeves, silk robes, delicate embroidery' },
      { label: '旗袍', en: 'form-fitting Chinese cheongsam dress, silk qipao, satin sheen, high slit' },
      { label: '绝对领域', en: 'thighhigh stockings with short skirt, exposed thigh gap, zettai ryouiki' },
      { label: '优雅连衣裙', en: 'elegant dress' },
      { label: '清爽白衬衫', en: 'crisp white shirt' },
    ],
    why: '服饰款式与局部穿搭',
    cats: [
      '服装与穿搭细节',
      '二次元与流行服饰',
      '中国历代与东方传统服饰',
      '西方历史礼服与甲胄军装',
      '袜类、鞋履与首饰细节',
      '服装领型与袖型细节',
      '裙型、裤型与局部穿搭原子词',
      '服饰鞋袜细分扩充',
      '二次元服装单品与冷门穿搭细节',
      '冷门面料与制版纺织工艺',
    ],
    aliases: ['服装与穿搭细节', '服装', '服饰', '穿搭', '衣着', '配饰', '首饰', '鞋袜', '甲胄'],
  },
  {
    dim: '表情与肢体动作',
    short: '表情与肢体动作',
    preferred: ['浅笑', '半睁鄙视眼', '傲娇表情', '三无冷漠脸', '单手托腮', '回眸', '安静坐姿', '自然站姿', '双手合十', '撑着伞'],
    fallback: [
      { label: '温柔浅笑', en: 'gentle soft smile' },
      { label: '半睁鄙视眼', en: 'half-closed eyes, unamused deadpan glare, jitome' },
      { label: '傲娇表情', en: 'tsundere, blushing, looking away annoyed, pouting' },
      { label: '三无冷漠脸', en: 'expressionless, stoic cold face, kuudere, calm gaze' },
      { label: '单手托腮', en: 'resting chin on hand, fingers gently curled' },
      { label: '安静坐姿', en: 'sitting gracefully' },
    ],
    why: '神情眼神与肢体动态',
    cats: [
      '表情与肢体动作',
      '表情神态与微表情',
      '人体姿势、互动动态与手部特写',
      '视线与眼部微动态',
      '嘴型与唇部微动作',
      '手部精细动作与互动',
      '身体微观魅力特征',
      '表情眼神与肢体动态扩充',
      '日常动作、生活瞬间与情绪故事感补充',
    ],
    aliases: ['表情与肢体动作', '表情动作', '动作', '姿势', '姿态', '表情', '神态', '眼神', '手势', '动态'],
  },
  {
    dim: '构图与镜头视角',
    short: '构图与镜头视角',
    preferred: ['面部特写', '半身像', '七分身膝上景', '全身像', '俯视视角', '仰视视角', '回眸视角', '背景虚化景深', '倾斜构图', '近大远小透视'],
    fallback: [
      { label: '面部特写', en: 'tight close-up on face, detailed facial portrait' },
      { label: '半身像', en: 'medium shot from waist up, upper body portrait' },
      { label: '七分身膝上景', en: 'medium long shot from knees up, cowboy shot' },
      { label: '仰视视角', en: "low angle shot, worm's-eye view, looking up at subject, from below" },
      { label: '俯视视角', en: 'high angle shot, looking down at subject, from above' },
      { label: '背景虚化景深', en: 'shallow depth of field, creamy bokeh, blurry background, sharp focus on subject' },
    ],
    why: '机位透视与景别景深',
    cats: [
      '构图与镜头视角',
      '构图法则與特殊机位',
      '专业相机、胶片型号与光学特效',
    ],
    aliases: ['构图与镜头视角', '镜头构图', '构图', '镜头', '镜头景别', '景别', '机位', '视角', '透视', '景深'],
  },
  {
    dim: '光影与色彩氛围',
    short: '光影与色彩氛围',
    preferred: ['丁达尔体积光', '边缘轮廓光', '明暗对比光', '树影斑驳光', '水底焦散光斑', '黄金时刻', '柔焦漫射光', '清冷蓝调光线', '温馨琥珀暖光'],
    fallback: [
      { label: '丁达尔体积光', en: 'volumetric lighting, god rays, sunbeams piercing through mist' },
      { label: '边缘轮廓光', en: 'strong rim lighting, glowing backlit contour' },
      { label: '树影斑驳光', en: 'dappled sunlight filtering through leaves, komorebi' },
      { label: '明暗对比光', en: 'dramatic chiaroscuro lighting, deep shadows and bright highlights' },
      { label: '柔焦漫射光', en: 'soft diffused lighting' },
      { label: '清冷蓝调光线', en: 'cool blue hour lighting' },
    ],
    why: '布光逻辑与色彩影调',
    cats: [
      '光影与色彩氛围',
      '影视级布光与自然大气光学',
      '精选大师配色方案与中国传统色卡',
      '自然光影、天气与环境氛围细分词条',
      '大气光学现象、天象奇观与四时气候',
    ],
    aliases: ['光影与色彩氛围', '光影', '光线', '布光', '色调', '色彩', '配色', '氛围'],
  },
  {
    dim: '画风与艺术媒介',
    short: '画风与艺术媒介',
    preferred: ['赛璐璐平涂', '厚涂肌理感', '水彩晕染风', '纯线稿', '手绘水彩', '厚涂油画', '二次元插画', '新海诚风', '吉卜力风'],
    fallback: [
      { label: '赛璐璐平涂', en: 'crisp anime cel shading, flat color blocks, clean lineart' },
      { label: '厚涂肌理感', en: 'thick impasto oil painting, heavy visible brushstrokes, textured canvas' },
      { label: '水彩晕染风', en: 'traditional watercolor painting, soft wet-on-wet color bleeding, textured paper' },
      { label: '纯线稿', en: 'clean monochrome lineart, ink drawing, uncolored sketch' },
      { label: '柔焦通透插画', en: 'luminous soft-focus anime illustration' },
      { label: '古典油画肌理', en: 'classical oil painting on linen canvas' },
    ],
    why: '美学流派与笔触媒介',
    cats: [
      '画风与艺术媒介',
      '二次元与数字插画细分风格',
      '西方美术史与经典画派（含冷门流派）',
      '中国画、东方美学与世界非遗工艺（极冷门全覆盖）',
      '3D渲染、故障艺术与互联网先锋美学',
      '画布纸张基底与手工笔触肌理',
      '高频画师与名家美学风格',
      '主流二游与知名IP视觉审美体系',
    ],
    aliases: ['画风与艺术媒介', '画风', '风格', '艺术风格', '流派', '笔触', '媒介', '画师'],
  },
  {
    dim: '场景与环境道具',
    short: '场景与环境道具',
    preferred: ['樱花街道', '放学黄昏天台', '哥特古堡卧室', '日式缘侧', '森林秘境', '海边沙滩', '花束', '油纸伞', '长剑', '复古书房'],
    fallback: [
      { label: '放学黄昏天台', en: 'school rooftop at sunset, chain-link fence' },
      { label: '日式缘侧走廊', en: 'traditional Japanese wooden engawa veranda, courtyard view' },
      { label: '哥特古堡卧室', en: 'Gothic castle bedroom, velvet curtains, candlelight' },
      { label: '樱花纷飞街道', en: 'street lined with blooming cherry blossoms, falling petals' },
      { label: '静谧森林秘境', en: 'serene sunlit forest clearing' },
      { label: '海边蔚蓝沙滩', en: 'sandy beach by crystal blue ocean, gentle waves' },
    ],
    why: '空间环境与伴随道具',
    cats: [
      '场景与环境道具',
      '东方古建、西式建筑与超现实秘境空间',
      '自然地貌、极端气象与宇宙奇观',
      '中国传统节庆、二十四节气与民俗非遗场景',
      '日式风物、青春校园与怀旧生活空间',
      '世界各地标奇景与古典欧式场景',
      '科幻太空、奇幻地下城与超现实奇观空间',
      '科幻机甲、枪械军武、冷兵器与奇幻法器',
      '乐器、载具与精致日常静物道具',
      '花卉植物与奇幻生态细节',
      '真实与幻想动物伴侣',
      '室内陈设与唯美道具微观词条',
    ],
    aliases: ['场景与环境道具', '场景', '场景背景', '背景', '环境', '建筑', '空间', '室内', '风景', '道具'],
  },
  {
    dim: '材质与特效细节',
    short: '材质与特效细节',
    preferred: ['故障色差特效', '丝绸缎面光泽', '金属拉丝反光', '蕾丝镂空花边', '薄纱半透明质感', '魔法星辰粒子', '飘落花瓣雨', '晶莹水滴折射'],
    fallback: [
      { label: '丝绸缎面光泽', en: 'flowing silk fabric, satin sheen, delicate embroidery' },
      { label: '金属拉丝反光', en: 'metallic luster, brushed steel, sharp reflections' },
      { label: '薄纱半透明质感', en: 'sheer translucent fabric, fine nylon texture' },
      { label: '故障色差特效', en: 'slight chromatic aberration, RGB color shift glitch effect' },
      { label: '蕾丝镂空花边', en: 'intricate floral lace trim' },
      { label: '发光粒子特效', en: 'glowing floating light particles' },
    ],
    why: '物理材质与粒子特效',
    cats: [
      '材质与特效细节',
      '微观材质物理与诱人美食特写',
      '魔法元素、粒子流体与超自然画面特效',
      '全品类材质、表面光感与物理状态微距词库',
    ],
    aliases: ['材质与特效细节', '材质特效', '材质', '肌理', '质感', '面料', '特效', '魔法', '粒子'],
  },
]

// 容易在长句中产生歧义的单字词名单（仅当独立出现或有边界时匹配）
const AMBIGUOUS_SINGLE_CHARS = new Set(['人', '女', '男', '猫', '狗', '鸟', '花', '树', '海', '山', '街', '星', '月', '雨', '雪', '雾', '风', '光', '影', '剣', '刀', '枪', '书', '伞', '灯', '粉'])

/**
 * 扫描用户输入，按「最长词优先 + 区间覆盖消歧」匹配百科词条
 */
/**
 * 多义词上下文消歧。
 * 「菊花」在口语里指肛门，字面义是花卉，单靠词表裁定必然有一边闹笑话，
 * 所以按输入里出现的旁证词判断：先看植物语境，再看人体语境，
 * 都没有线索时按本软件的人物绘画定位走人体义。
 * 以后遇到同类词（比如「肉丝」指丝袜还是菜），照这个结构往里加即可。
 */
const CONTEXT_SENSITIVE = {
  菊花: {
    flower: /花束|一束|一朵|一枝|一盆|花店|花园|花田|盆栽|插花|花瓣|花艺|鲜花|盛开|凋谢|绽放|花丛|花瓶|赏花|采花|种花|花香|花蕊|花语|菊展|黄色花瓣/,
    body: /露|裸|胸|臀|腿|股|后庭|插入|掰|内裤|耻|肛|趴|翘|揉|舔|拍打/,
    flowerEn: 'chrysanthemum, layered yellow petals, autumn flower',
    flowerCat: '花卉与植物',
  },
}

function resolveContextual(term, entry, input) {
  const rule = CONTEXT_SENSITIVE[String(term).trim()]
  if (!rule) return { en: entry.en, cat: entry.cat, label: entry.label }
  if (rule.flower.test(input)) {
    return { en: rule.flowerEn, cat: rule.flowerCat, label: '菊花（花卉）' }
  }
  // 人体语境，或没有明确线索时按人物绘画的默认义
  return { en: entry.en, cat: entry.cat, label: entry.label }
}

function matchSlangGlossary(userText, customDirs = []) {
  const raw = String(userText || '').trim()
  if (!raw) return []
  const input = raw.toLowerCase()
  const lib = loadLibrary(customDirs)

  // 收集所有候选命中区间
  const candidates = []
  for (const entry of lib) {
    if (!entry || !Array.isArray(entry.terms)) continue
    for (const t of entry.terms) {
      if (!t) continue
      const tl = String(t).trim().toLowerCase()
      if (!tl) continue

      // 单字词一律要求前后有边界。
      // 中文没有词分隔符，单字一旦允许内部命中就会截胡：
      // 「肛门」命中「门」→ door，「乳头」命中「头」→ head。
      // 原来只对 AMBIGUOUS_SINGLE_CHARS 名单里的字做检查，名单外的单字仍然会误触发。
      if (tl.length === 1) {
        // 如果整个输入只是这个单字，或者前后是标点/空格才算命中
        const esc = tl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re = new RegExp(`(?:^|[\\s,，。、；;！!？?])${esc}(?:$|[\\s,，。、；;！!？?])`)
        const m = re.exec(input)
        if (m) {
          const idx = input.indexOf(tl, m.index)
          candidates.push({ entry, term: t, tl, start: idx, end: idx + tl.length, len: tl.length })
        }
        continue
      }

      if (/^[a-z0-9\s-]+$/i.test(tl) && tl.length <= 3) {
        const esc = tl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re = new RegExp(`\\b${esc}\\b`, 'i')
        const m = re.exec(input)
        if (m) {
          candidates.push({ entry, term: t, tl, start: m.index, end: m.index + tl.length, len: tl.length })
        }
        continue
      }

      let pos = input.indexOf(tl)
      if (pos !== -1) {
        candidates.push({ entry, term: t, tl, start: pos, end: pos + tl.length, len: tl.length })
      }
    }
  }

  // 按匹配长度降序排列（长词优先覆盖短词），同长度按出现位置升序。
  // 人体解剖保底词条排在最前，避免被词库里的同形异义词（菊花 = 花卉）抢走。
  for (const c of candidates) {
    c.pri = c.entry.cat === '人体解剖' ? 1 : 0
  }
  candidates.sort((a, b) => b.pri - a.pri || b.len - a.len || a.start - b.start)

  const covered = new Uint8Array(input.length)
  const hits = []
  const seenEn = new Set()

  for (const c of candidates) {
    if (seenEn.has(c.entry.en)) continue
    // 检查该区间是否已被更长的专业词完全覆盖
    let overlapCount = 0
    for (let i = c.start; i < c.end; i++) {
      if (covered[i]) overlapCount++
    }
    if (overlapCount === c.len) continue

    for (let i = c.start; i < c.end; i++) covered[i] = 1
    seenEn.add(c.entry.en)
    const resolved = resolveContextual(c.term, c.entry, input)
    hits.push({
      cat: resolved.cat,
      label: resolved.label,
      matchedTerm: c.term,
      terms: c.entry.terms,
      en: resolved.en,
      pos: c.start,
    })
  }

  // 按在用户输入中的出现顺序返回，保证提示词主次自然
  hits.sort((a, b) => a.pos - b.pos)
  return hits
}

/**
 * 深度识别用户输入的题材语境，驱动多维度智能推荐
 */
function detectInputContext(text) {
  const t = String(text || '').toLowerCase()
  const isCharacter =
    /女|男|人|娘|姐|妹|哥|弟|少|萝|正太|骑士|巫|仙|神|魔|妖|精灵|天使|偶像|学生|护士|女仆|新娘|公主|王|武士|侠|刺客|研究|宇航|舞|模特|肖像|立绘|头像|自拍|girl|boy|woman|man|lady|portrait/.test(t)
  const isOriental =
    /汉服|古风|国风|旗袍|中式|唐|宋|明|魏晋|敦煌|水墨|工笔|仙侠|武侠|道士|剑客|江湖|青绿|故宫|江南|长安|苗|和服|浴衣|巫女|神社|京都|浮世绘|茶道|建盏|苏绣|园林|山海经|麒麟|苍龙/.test(t)
  const isAcgCute =
    /二次元|动漫|日系|萝莉|猫娘|狐娘|兔娘|犬娘|狼娘|jk|水手服|洛丽塔|地雷|量产|天使界隈|女仆|偶像|手办|盲盒|像素|平涂|赛璐璐|原画|轻小说|anime|manga|chibi/.test(t)
  const isGothicDark =
    /哥特|暗黑|吸血鬼|恶魔|修女|魔女|女巫|病娇|废墟|教堂|黑纱|骷髅|血|诅咒|克苏鲁|诡异|怪谈|夜魔|暗夜|gothic|dark/.test(t)
  const isSciFi =
    /赛博|机甲|科幻|太空|宇宙|未来|机械|义体|黑客|高达|霓虹|全息|废土|蒸汽朋克|飞船|宇航|实验室|空间站|漫游车|战机|潜艇|对撞机|cyberpunk|mecha|scifi/.test(t)
  const isWesternFantasy =
    /奇幻|魔法|精灵|龙|骑士|古堡|宫廷|洛可可|维多利亚|巴洛克|神话|女武神|独角兽|狮鹫|德鲁伊|圣剑|塔罗|炼金|奥术|北欧|古希腊|古埃及|fantasy|magic|knight/.test(t)
  const isLandscapeArch =
    /风景|山|海|森林|雪山|沙漠|湖|河|草原|峡谷|冰川|极光|星空|云海|建筑|大桥|城市|街景|古镇|庭院|园林|教堂|美术馆|天文台|日食|彩虹|火烧云|雾凇|landscape|architecture/.test(t)
  const isStillLifeFood =
    /美食|食物|甜点|蛋糕|面包|咖啡|茶|点心|料理|水果|静物|香水|花瓶|器物|瓷器|水晶|钟表|陀飞轮|书籍|邮票|唱片|food|still life/.test(t)
  const isPhotography =
    /写实|摄影|照片|胶片|相机|人像摄影|街拍|纪实|微距|长曝光|特写|棚拍|时尚大片|杂志|photorealistic|photo|camera|film/.test(t)
  const isStageMusic =
    /舞台|演唱会|音乐厅|交响|乐团|摇滚|爵士|歌剧|芭蕾|走秀|T台|乐器|钢琴|小提琴|吉他|古筝|琵琶|戏剧|concert|stage/.test(t)

  // 判断是否为纯风景/静物/建筑（不含人物）
  const isNonHumanScene = !isCharacter && (isLandscapeArch || isStillLifeFood)

  return {
    isCharacter: isCharacter || (!isNonHumanScene && !isSciFi),
    isOriental,
    isAcgCute,
    isGothicDark,
    isSciFi,
    isWesternFantasy,
    isLandscapeArch,
    isStillLifeFood,
    isPhotography,
    isStageMusic,
    isNonHumanScene,
  }
}

/**
 * 字符串稳定哈希，用于在保证确定性的同时提供丰富轮换
 */
function stableHash(str) {
  let h = 2166136261
  const s = String(str || '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * 从指定分类池中按语境相关性与类别多样性抽取候选词
 */
function pickContextOptions(lib, cats, userText, excludedSet, count = 6, randomize = false) {
  const pool = lib.filter((x) => cats.includes(x.cat))
  const text = String(userText || '').toLowerCase()
  const ctx = detectInputContext(text)
  const isGenericInput =
    !ctx.isOriental &&
    !ctx.isAcgCute &&
    !ctx.isGothicDark &&
    !ctx.isSciFi &&
    !ctx.isWesternFantasy &&
    !ctx.isStageMusic
  const seed = randomize ? Math.floor(Math.random() * 100000) : stableHash(text)

  const scored = []
  for (let idx = 0; idx < pool.length; idx++) {
    const item = pool[idx]
    if (!item || !item.en || !item.label) continue
    if (excludedSet.has(item.en.toLowerCase()) || excludedSet.has(item.label.toLowerCase())) continue

    let score = 0
    // 用户已经明确写在输入里的词不再重复出现在推荐栏
    const alreadyInInput = item.terms.some((t) => t && t.length >= 2 && text.includes(String(t).toLowerCase()))
    if (alreadyInInput) score -= 50

    const blob = `${item.cat} ${item.label} ${item.terms.join(' ')} ${item.en}`.toLowerCase()
    if (ctx.isOriental && /汉服|古风|唐|宋|明|敦煌|水墨|工笔|中式|和服|京都|古典|青绿|旗袍|茶|园林|飞檐|山海经/.test(blob)) score += 6
    if (ctx.isAcgCute && /二次元|日系|动漫|洛丽塔|水手服|双马尾|猫|少女|可爱|平涂|厚涂|轻小说/.test(blob)) score += 6
    if (ctx.isGothicDark && /哥特|暗黑|黑|血|夜|修女|恶魔|废墟|烟熏|冷|玫瑰花窗|巴洛克/.test(blob)) score += 6
    if (ctx.isSciFi && /赛博|机甲|科幻|机械|霓虹|全息|太空|未来|电子|空间站|战机|蓝图/.test(blob)) score += 6
    if (ctx.isWesternFantasy && /奇幻|魔法|骑士|宫廷|维多利亚|洛可可|神话|奥术|塔罗|独角兽|狮鹫/.test(blob)) score += 6
    if (ctx.isLandscapeArch && /建筑|风景|山|海|云|光|日|月|星|雾|冰|峡谷|森林|园林|教堂|大桥/.test(blob)) score += 6
    if (ctx.isStillLifeFood && /美食|茶|咖啡|蛋糕|静物|瓷|水晶|玻璃|微距|花|烘焙|料理/.test(blob)) score += 6
    if (ctx.isPhotography && /摄影|胶片|镜头|景深|光圈|快门|布光|逆光|特写|纪实|杂志/.test(blob)) score += 5
    if (ctx.isStageMusic && /舞台|音乐|追光|乐团|剧场|聚光灯|干冰|激光|T台/.test(blob)) score += 6

    // 当用户输入是通用基础描述（如「一个女生」）时，优先推荐日常通用的场景、服饰、光影与构图，避免默认堆砌冷门奇观或异兽设定
    if (isGenericInput) {
      if (item.cat === '世界神话、东方仙侠与民俗传说体系' || item.cat === '幻想种族与生物' || item.cat === '舞台戏剧灯光、演艺空间与视听现场' || item.cat === '平面设计、书籍装帧与版式构成') {
        score -= 8
      }
      if (/日常|街|卧室|房间|咖啡|校园|海边|森林|庭院|柔光|自然光|黄金时刻|逆光|电影|水彩|厚涂|胶片|写实|动漫|浅笑|自然站姿|半身|全身|特写|长发|短发|连衣裙|衬衫|毛衣|少女|邻家|文艺|温柔/.test(blob)) {
        score += 5.5
      }
      if (/黑洞|蓝图|工程|对撞机|深渊|王座|核聚变|解剖|克苏鲁|红外|针孔|移膜|故障|粗野主义|独角兽|森林之神|漩涡圈圈眼|机械耳|板甲/.test(blob)) {
        score -= 7
      }
    }

    // 换一批时注入随机扰动，常规推荐时使用基于输入的稳定散列保证体验一致且不单调
    const jitter = randomize
      ? (Math.random() * 4.5)
      : (((stableHash(`${item.label}:${seed}:${idx}`) % 1000) / 1000) * 2.0)

    scored.push({ item, score: score + jitter, cat: item.cat })
  }

  scored.sort((a, b) => b.score - a.score)

  // 类别轮转均衡抽取：避免同一维度下的候选全部挤在同一个子分类
  const picked = []
  const usedLabels = new Set()
  const catBuckets = new Map()
  for (const s of scored) {
    if (!catBuckets.has(s.cat)) catBuckets.set(s.cat, [])
    catBuckets.get(s.cat).push(s)
  }

  const bucketKeys = Array.from(catBuckets.keys()).sort(
    (a, b) => (catBuckets.get(b)[0]?.score || 0) - (catBuckets.get(a)[0]?.score || 0),
  )
  let round = 0
  while (picked.length < count && round < 20) {
    let addedInRound = false
    for (const k of bucketKeys) {
      if (picked.length >= count) break
      const list = catBuckets.get(k)
      if (round < list.length) {
        const cand = list[round].item
        if (!usedLabels.has(cand.label)) {
          usedLabels.add(cand.label)
          picked.push({ label: cand.label, en: cand.en })
          addedInRound = true
        }
      }
    }
    if (!addedInRound) break
    round++
  }

  return picked
}

/**
 * 优先从语料库中取出通用常用词，让推荐贴近日常而非冷门奇观
 */
function pickPreferred(lib, cats, preferred, excludedSet, count = 6) {
  const pool = lib.filter((x) => cats.includes(x.cat))
  const picked = []
  const used = new Set()
  for (const pref of preferred || []) {
    for (const item of pool) {
      if (!item || !item.label || !item.en) continue
      if (used.has(item.label)) continue
      if (excludedSet.has(item.en.toLowerCase()) || excludedSet.has(item.label.toLowerCase())) continue
      const hit =
        item.label.includes(pref) || (Array.isArray(item.terms) && item.terms.some((t) => String(t).includes(pref)))
      if (hit) {
        used.add(item.label)
        picked.push({ label: item.label, en: item.en })
        break
      }
    }
    if (picked.length >= count) break
  }
  return picked
}

/**
 * 匹配指定维度名称对应的百科分类组（支持别名与模糊匹配）
 */
function matchDimensionGroup(dimName) {
  const clean = String(dimName || '').trim()
  if (!clean) return CATEGORY_TO_DIM[0]

  for (const g of CATEGORY_TO_DIM) {
    if (g.dim === clean || g.dim.includes(clean) || clean.includes(g.dim)) return g
    if (g.aliases && g.aliases.some((a) => a === clean || clean.includes(a) || a.includes(clean))) return g
  }
  return CATEGORY_TO_DIM[0]
}

/**
 * 根据维度名返回候选词池（供外部直接调用）
 */
function matchDimensionBank(dimName, userText = '', customDirs = []) {
  const lib = loadLibrary(customDirs)
  const group = matchDimensionGroup(dimName)
  return pickContextOptions(lib, group.cats, userText, new Set(), 12, false)
}

/**
 * 为推理提示构造精炼的参考语料摘要
 */
function retrieveCorpusForInput(userText, targetDims = [], customDirs = []) {
  const hits = matchSlangGlossary(userText, customDirs)
  const lines = []
  if (hits.length > 0) {
    lines.push('【精准词条映射】：')
    for (const h of hits.slice(0, 12)) {
      lines.push(`- 「${h.matchedTerm}」(${h.cat}) => ${h.en}`)
    }
  }
  return { hits, promptBlock: lines.join('\n') }
}

/**
 * 生成或补齐推荐维度（支持单维度换一批、指定维度列表补全、以及全自动题材感知推荐）
 */
function buildFallbackOrMergeFields(userText, requestedNames = [], excludedTerms = [], customDirs = []) {
  const lib = loadLibrary(customDirs)
  const excludedSet = new Set(
    (excludedTerms || []).map((s) => String(s || '').trim().toLowerCase()).filter(Boolean),
  )
  const ctx = detectInputContext(userText)

  // 1. 单维度精准刷新（「换一批」）
  if (Array.isArray(requestedNames) && requestedNames.length === 1) {
    const targetName = requestedNames[0]
    const group = matchDimensionGroup(targetName)
    return [
      {
        name: group.short || targetName,
        why: group.why,
        options: pickContextOptions(lib, group.cats, userText, excludedSet, 6, true),
      },
    ]
  }

  // 2. 根据题材语境决定推荐维度的先后顺序与组合（始终返回完整的 8 大分类或非人物 6 大分类）
  let orderedGroups = []
  if (ctx.isNonHumanScene) {
    const nonHumanOrder = [
      '场景与环境道具',
      '画风与艺术媒介',
      '光影与色彩氛围',
      '构图与镜头视角',
      '材质与特效细节',
    ]
    orderedGroups = nonHumanOrder.map((n) => CATEGORY_TO_DIM.find((g) => g.dim === n)).filter(Boolean)
  } else {
    orderedGroups = [...CATEGORY_TO_DIM]
  }

  const targetCount = ctx.isNonHumanScene ? 5 : 8
  const result = []
  for (const g of orderedGroups.slice(0, targetCount)) {
    let opts = []
    if (!ctx.isGeneric || ['人物', '少女', '少年', '女孩', '男孩', '女生', '男生', '女人', '男人'].some((w) => String(userText || '').includes(w))) {
      // 先取 3 个本类目高口碑代表词，再取 3 个语境动态词，既保证每个分类一目了然又兼顾多样性
      opts = pickPreferred(lib, g.cats, g.preferred, excludedSet, 3)
    }
    const ctxOpts = pickContextOptions(lib, g.cats, userText, excludedSet, 6, true).filter(
      (x) => !opts.some((o) => o.label === x.label || o.en === x.en),
    )
    opts = opts.concat(ctxOpts).slice(0, 6)
    if (opts.length < 6) {
      const extra = pickContextOptions(lib, g.cats, userText, excludedSet, 6, false).filter(
        (x) => !opts.some((o) => o.label === x.label || o.en === x.en),
      )
      opts = opts.concat(extra).slice(0, 6)
    }
    if (opts.length < 6 && Array.isArray(g.fallback) && g.fallback.length) {
      const picked = g.fallback
        .filter(
          (x) =>
            !excludedSet.has(String(x.en).toLowerCase()) &&
            !excludedSet.has(String(x.label).toLowerCase()) &&
            !opts.some((o) => o.label === x.label || o.en === x.en),
        )
        .slice(0, 6 - opts.length)
      opts = opts.concat(picked)
    }
    if (opts.length > 0) {
      result.push({
        name: g.short || g.dim,
        why: g.why,
        options: opts,
      })
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// 十大精细化编译准则（确定性规则 + 语义顺位重排 + 自造词拆解引擎）
// ---------------------------------------------------------------------------
const NEGATIVE_TRANSFORM_RULES = [
  { re: /不戴眼镜|没戴眼镜|无眼镜|摘下眼镜/g, en: 'unadorned face, clear eyes' },
  { re: /不穿鞋|没穿鞋|不穿袜子|没穿袜子|光脚|赤足|赤脚/g, en: 'bare feet, barefoot, exposed ankles' },
  { re: /没有表情|面无表情|不笑|冷脸/g, en: 'expressionless, stoic neutral face, closed mouth' },
  { re: /背景不要人|背景无人|空无一人|没人/g, en: 'deserted empty background, solitary figure' },
  { re: /不戴帽子|没戴帽子|无帽/g, en: 'uncovered head, flowing hair' },
]

const HAND_ACTION_RULES = [
  { re: /拿着?剑|握着?剑|持剑|提剑/g, en: 'gripping sword hilt firmly with one hand, detailed fingers' },
  { re: /拿着?刀|握着?刀|持刀/g, en: 'gripping blade hilt firmly with hand, detailed fingers' },
  { re: /托着?下巴|托腮|撑着脸/g, en: 'resting chin on hand, fingers gently curled' },
  { re: /双手合十|合十祈祷/g, en: 'hands pressed together in prayer in front of chest, detailed fingers' },
  { re: /捧着?花|抱花|手捧鲜花/g, en: 'holding bouquet gently with both hands, detailed fingers' },
  { re: /弹琴|抚琴|弹吉他|弹钢琴/g, en: 'fingers poised on instrument strings, detailed hand anatomy' },
  { re: /拿着?书|捧书|看书|读书/g, en: 'holding open book with both hands, detailed fingers' },
  { re: /撑着?伞|打着?伞|执伞/g, en: 'holding umbrella handle with one hand, detailed fingers' },
]

const WUXIA_CONCEPT_RULES = [
  { re: /剑气纵横|万剑归宗|剑芒/g, en: 'glowing sword energy slashes, flying debris, dynamic wind shockwaves' },
  { re: /仙气飘飘|羽化登仙|仙风道骨|谪仙/g, en: 'ethereal atmosphere, floating silk ribbons, glowing light particles, swirling mist' },
  { re: /赛博修仙|赛博道士|科技修真/g, en: 'cyberpunk taoist priest, holographic glowing talisman, neon-lit traditional robe, mechanical prayer beads' },
  { re: /尸山血海|修罗场|古战场/g, en: 'dark gritty battlefield, broken weapons stuck in ground, ominous red fog, dramatic dark shadows' },
]

const CAMERA_SAFETY_RULES = [
  { re: /看镜头|正视镜头|直视镜头|看着镜头/g, en: 'looking directly at viewer, eye contact' },
  { re: /背对镜头|背向镜头/g, en: 'view from behind, back turned to viewer' },
  { re: /面对镜头|朝向镜头/g, en: 'facing viewer, front view' },
]

const MATERIAL_LUSTER_RULES = [
  { re: /金属|铠甲|盔甲|甲胄|刀剑|重剑|银甲|铁甲/, en: 'metallic luster, brushed steel, sharp reflections' },
  { re: /丝绸|绸缎|汉服|礼服|旗袍|罗裙|锦缎/, en: 'flowing silk fabric, satin sheen, delicate embroidery' },
  { re: /皮革|皮衣|风衣|机能风|战术/, en: 'matte leather texture, tactical nylon, detailed stitching' },
  { re: /丝袜|连裤袜|黑丝|白丝|薄纱|轻纱/, en: 'sheer translucent fabric, fine nylon texture' },
]

const COLOR_MAP = {
  雪白: 'snow-white', 纯白: 'pure white', 苍白: 'pale white', 银白: 'silver-white', 白: 'white',
  猩红: 'crimson red', 血红: 'blood-red', 赤红: 'scarlet red', 朱红: 'vermilion red', 酒红: 'burgundy red', 红: 'crimson red',
  漆黑: 'pitch-black', 暗黑: 'dark black', 玄黑: 'jet-black', 墨黑: 'ink-black', 黑: 'pitch-black',
  蔚蓝: 'azure blue', 冰蓝: 'ice-blue', 深蓝: 'deep navy blue', 宝蓝: 'sapphire blue', 蓝: 'blue',
  翠绿: 'emerald green', 墨绿: 'dark forest green', 青绿: 'cyan-green', 绿: 'green',
  金黄: 'golden blonde', 鎏金: 'gilded gold', 灿金: 'bright gold', 金: 'golden', 黄: 'yellow',
  紫罗兰: 'violet', 暗紫: 'dark purple', 紫: 'purple',
  樱粉: 'cherry pink', 粉红: 'pastel pink', 粉: 'soft pink',
  银灰: 'silver-grey', 银: 'silver', 灰: 'ash grey',
  青: 'cyan', 橙: 'amber orange', 褐: 'chestnut brown', 棕: 'brown',
}

const PART_MAP = {
  长发: 'long hair', 短发: 'short hair', 双马尾: 'twintails', 马尾: 'ponytail', 卷发: 'wavy hair', 秀发: 'flowing hair', 发: 'hair', 毛: 'hair',
  眼眸: 'eyes', 眼瞳: 'eyes', 双眸: 'eyes', 眼睛: 'eyes', 瞳: 'eyes', 眼: 'eyes',
  长裙: 'long dress', 连衣裙: 'dress', 礼服: 'silk gown', 汉服: 'traditional hanfu robe', 旗袍: 'cheongsam dress', 裙: 'skirt',
  衬衫: 'shirt', 风衣: 'trench coat', 外套: 'jacket', 披风: 'cloak', 斗篷: 'cape', 铠甲: 'plate armor', 丝袜: 'thighhigh stockings',
  翅膀: 'wings', 羽翼: 'feathered wings', 双翼: 'wings', 角: 'horns', 龙角: 'dragon horns', 耳: 'ears', 尾: 'tail', 唇: 'lips',
}

/**
 * 解析中文「颜色 + 部位/服饰」紧耦合短语（准则 2：防串色绑定 & 准则 6：白毛红瞳纠偏）
 */
function extractColorPartBindings(cnText) {
  const bindings = []
  let text = String(cnText || '')
  // 典型复合四字/六字词：如「白毛红瞳」「黑发红眼」「银发蓝瞳」「白发苍苍」
  const pairRe = /(雪白|纯白|银白|猩红|血红|漆黑|冰蓝|深蓝|翠绿|金黄|樱粉|暗紫|白|红|黑|蓝|绿|金|紫|粉|银|灰|青)(发|毛|长发|短发|眼|瞳|眸|裙|衣|甲)/g
  let m
  while ((m = pairRe.exec(text)) !== null) {
    const cEn = COLOR_MAP[m[1]] || 'colored'
    const pEn = PART_MAP[m[2]] || 'feature'
    bindings.push({ matched: m[0], en: `${cEn} ${pEn}`, slot: 4 })
  }
  return bindings
}

/**
 * 中文自造词/未知复合词的词根拆解器（防止模型瞎翻或漏翻）
 */
const ROOT_CHAR_GLOSSARY = [
  ['赛博', 'cyberpunk high-tech'], ['机能', 'techwear tactical'], ['蒸汽', 'steampunk brass gear'],
  ['哥特', 'Gothic dark'], ['洛丽塔', 'Lolita frilly'], ['古风', 'traditional Chinese'],
  ['国风', 'oriental aesthetic'], ['仙侠', 'xianxia immortal'], ['武侠', 'wuxia martial arts'],
  ['废土', 'post-apocalyptic wasteland'], ['末日', 'apocalyptic ruined'], ['暗黑', 'dark fantasy'],
  ['星辰', 'starry cosmic'], ['星空', 'starry sky'], ['月光', 'moonlit'], ['银河', 'milky way galaxy'],
  ['琉璃', 'translucent glazed glass'], ['水晶', 'crystal'], ['翡翠', 'jadeite'], ['流光', 'flowing luminous light'],
  ['幻影', 'phantom afterimage'], ['霓虹', 'neon glowing'], ['全息', 'holographic'], ['机械', 'mechanical cybernetic'],
  ['灵气', 'glowing spiritual aura'], ['符文', 'glowing runes'], ['法阵', 'magic circle'], ['结界', 'glowing barrier'],
  ['少女', 'young girl'], ['少年', 'young boy'], ['女子', 'young woman'], ['男子', 'young man'],
  ['剑客', 'swordsman'], ['侠客', 'wandering martial artist'], ['仙子', 'celestial fairy maiden'],
  ['神女', 'divine goddess'], ['魔女', 'witch'], ['骑士', 'armored knight'], ['机娘', 'mecha musume girl'],
]

function decomposeUnknownCn(remText) {
  const out = []
  let s = String(remText || '').replace(/非常|超级|极其|特别|十分|无比|绝美|超凡|极致/g, '')
  for (const [cn, en] of ROOT_CHAR_GLOSSARY) {
    if (s.includes(cn)) {
      out.push(en)
      s = s.split(cn).join('')
    }
  }
  return { extraEn: out, leftover: s.trim() }
}

/**
 * 判断英文短语属于 6 大顺位中的哪一顺位（准则 1：Token 权重前置定律）
 * 顺位1: 核心画质与媒介画风
 * 顺位2: 主体数量与核心身份
 * 顺位3: 核心动作与镜头视角
 * 顺位4: 面部五官、发型与服饰细节
 * 顺位5: 背景环境与道具
 * 顺位6: 光影氛围与色调
 */
function classifyPromptSlot(phrase, catHint = '') {
  const p = phrase.toLowerCase()
  if (catHint) {
    if (/画风|美术|中国画|3D渲染|画布|画师|二游|排版|光学画质/.test(catHint)) return 1
    if (/人物与亚文化|幻想种族|职业与身份|神话体系/.test(catHint)) return 2
    if (/构图|相机|分镜|摄影流派|人体姿势|微动作|手部精细动作|日常动作/.test(catHint)) return 3
    if (/服饰|服装|袜类|裙型|发型|发色|眼瞳|身材|身体|面料/.test(catHint)) return 4
    if (/建筑|地貌|节庆|风物|地标|太空|空间|机甲|乐器|花卉|动物|陈设|器物|炼金|航空|生态|美食|烘焙/.test(catHint)) return 5
    if (/布光|色彩|配色|光线|光影|天象|灯光|粒子/.test(catHint)) return 6
  }
  if (/\b(masterpiece|best quality|watercolor|impasto|cel shading|oil painting|ink wash|sketch|lineart|pixel art|3d render|photorealistic|anime style|art style|brushstrokes)\b/.test(p)) return 1
  if (/\b(1girl|1boy|2girls|2boys|solo|girl|boy|woman|man|lady|idol|knight|priest|miko|femboy|otoko no ko|gyaru|ojou-sama|goddess|witch|swordsman|figure)\b/.test(p)) return 2
  if (/\b(shot|view|angle|from below|from above|from behind|looking|standing|sitting|kneeling|holding|gripping|resting|hands|fingers|pose|foreshortening|fisheye|close-up|upper body|full body|portrait|bokeh|depth of field)\b/.test(p)) return 3
  if (/\b(hair|bangs|twintails|ponytail|ahoge|eyes|iris|pupils|jitome|sanpaku|tareme|tsurime|heterochromia|smile|expression|face|ears|horns|wings|dress|skirt|uniform|serafuku|gakuran|hanfu|cheongsam|qipao|armor|stockings|pantyhose|socks|sleeves|silk|leather|metallic|bare feet|barefoot)\b/.test(p)) return 4
  if (/\b(lighting|light|sunlight|moonlight|backlighting|rim light|volumetric|god rays|chiaroscuro|caustics|neon|shadows|glow|atmosphere|tone|chromatic aberration|fog|mist)\b/.test(p)) return 6
  return 5
}

/**
 * 严格根据用户输入与已选标签合成英文提示词（全面执行十大精细化编译准则）
 */
function translateWithGlossary(subjectText, styleText, modelTranslatedRemaining = '', customDirs = []) {
  let workingSubj = String(subjectText || '')
    .replace(/非常|超级|极其|特别|十分|无比|绝美/g, '')
    .trim()

  const slottedPhrases = [] // { en, slot }

  // 1. 优先拦截否定句式并转为正向视觉状态词（准则 5）
  for (const rule of NEGATIVE_TRANSFORM_RULES) {
    if (rule.re.test(workingSubj)) {
      slottedPhrases.push({ en: rule.en, slot: 4 })
      workingSubj = workingSubj.replace(rule.re, ' ')
    }
  }

  // 2. 拦截手部交互与复杂动作，补充物理骨骼接触拆解（准则 4）
  for (const rule of HAND_ACTION_RULES) {
    if (rule.re.test(workingSubj)) {
      slottedPhrases.push({ en: rule.en, slot: 3 })
      workingSubj = workingSubj.replace(rule.re, ' ')
    }
  }

  // 3. 拦截中式古典与网文四字意境词，拆解为实体道具+粒子+光影（准则 8）
  for (const rule of WUXIA_CONCEPT_RULES) {
    if (rule.re.test(workingSubj)) {
      slottedPhrases.push({ en: rule.en, slot: 5 })
      workingSubj = workingSubj.replace(rule.re, ' ')
    }
  }

  // 4. 拦截看镜头等相机污染词（准则 7）
  for (const rule of CAMERA_SAFETY_RULES) {
    if (rule.re.test(workingSubj)) {
      slottedPhrases.push({ en: rule.en, slot: 3 })
      workingSubj = workingSubj.replace(rule.re, ' ')
    }
  }

  // 5. 提取色彩+部位防串色绑定短语（准则 2 & 准则 6）
  const colorBindings = extractColorPartBindings(workingSubj)
  for (const b of colorBindings) {
    slottedPhrases.push({ en: b.en, slot: b.slot })
  }

  // 6. 图书馆词典精准匹配（最长词优先消歧） + UniversalTagTranslator 通用外部索引扫描
  const hits = matchSlangGlossary(workingSubj, customDirs)
  for (const h of hits) {
    slottedPhrases.push({ en: h.en, slot: classifyPromptSlot(h.en, h.cat) })
  }
  const translatorScan = getUniversalTranslator(customDirs).scanHits(workingSubj)
  for (const th of translatorScan.hits) {
    slottedPhrases.push({ en: th.en, slot: classifyPromptSlot(th.en) })
  }

  // 7. 服装与物体的材质光泽强制补全（准则 3）
  for (const rule of MATERIAL_LUSTER_RULES) {
    if (rule.re.test(subjectText)) {
      slottedPhrases.push({ en: rule.en, slot: 4 })
    }
  }

  // 8. 清洗并纠偏模型对剩余自由词的翻译（准则 7、9、10）
  let cleanedModel = String(modelTranslatedRemaining || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^(?:english\s+tags|output|translation|prompt|result)\s*[:：-]\s*/i, '')
    .replace(/[\u4e00-\u9fa5。，、！？；：“”‘’（）《》【】]+/g, ' ')
    .replace(/[\r\n.]+/g, ', ')
    .replace(/_/g, ' ')
    .replace(/\blooking at (the )?camera\b/gi, 'looking directly at viewer, eye contact')
    .replace(/\bfacing (the )?camera\b/gi, 'facing viewer, front view')
    .replace(/\bcamera\b/gi, 'viewer')
    .replace(/\b(no|without|not)\s+[a-z]+\b/gi, '')
    .replace(/\b(ladyboy|trans girl)\b/gi, 'femboy, androgynous boy')
    .replace(/\s+/g, ' ')
    .trim()

  if (cleanedModel) {
    for (const seg of cleanedModel.split(',')) {
      const s = seg.trim()
      if (s.length >= 2) {
        slottedPhrases.push({ en: s, slot: classifyPromptSlot(s) })
      }
    }
  }

  // 9. 用户点选的细节推荐标签与风格标签
  if (styleText && styleText !== 'photo-realistic, soft light' && styleText !== 'none') {
    for (const seg of String(styleText).split(',')) {
      const s = seg.trim()
      if (s.length >= 2) {
        slottedPhrases.push({ en: s, slot: classifyPromptSlot(s) })
      }
    }
  }

  // 10. 按 1 -> 6 顺位稳定排序并去重合并（准则 1、9、10）
  slottedPhrases.sort((a, b) => a.slot - b.slot)

  const parts = []
  const seenTokens = new Set()

  const addPhrase = (phrase) => {
    const subParts = String(phrase || '')
      .split(',')
      .map((s) => s.trim().replace(/^[-•*]+\s*/, '').replace(/_/g, ' '))
      .filter((s) => s.length >= 2 && /[a-zA-Z]/.test(s))
    for (const sp of subParts) {
      const key = sp.toLowerCase()
      if (seenTokens.has(key)) continue
      let redundant = false
      for (const existing of seenTokens) {
        if (existing.length > key.length + 4 && existing.includes(key)) {
          redundant = true
          break
        }
      }
      if (redundant) continue
      seenTokens.add(key)
      parts.push(sp)
    }
  }

  for (const item of slottedPhrases) {
    addPhrase(item.en)
  }

  if (parts.length === 0 && subjectText.trim()) {
    // 兜底：若全是纯英文或未知自造词，先走词根拆解
    const { extraEn } = decomposeUnknownCn(subjectText)
    for (const e of extraEn) addPhrase(e)
    if (parts.length === 0 && /[a-zA-Z]/.test(subjectText)) {
      return subjectText.replace(/[\u4e00-\u9fa5]+/g, '').trim()
    }
  }

  return parts.join(', ')
}

// ---------------------------------------------------------------------------
// 通用底层翻译与检索组件（UniversalTagTranslator）
// 纯粹依靠动态 JSON 索引文件（master_index.json / corpus-library.json）进行最长词优先匹配、替换与模糊检索
// ---------------------------------------------------------------------------
class UniversalTagTranslator {
  constructor(indexFilePath = path.join(__dirname, 'master_index.json'), customDirs = []) {
    this.indexFilePath = indexFilePath
    this.customDirs = Array.isArray(customDirs) ? customDirs : []
    this.tagMapping = {}
    this.sortedKeys = []
    this.loadedAt = 0
    this.loadIndex()
  }

  loadIndex() {
    const map = {}
    // 1. 先从标准词库归一化挂载
    try {
      const lib = loadLibrary(this.customDirs)
      const normLib = this._normalizeData(lib)
      Object.assign(map, normLib)
    } catch {
      /* ignore */
    }

    // 2. 再动态加载 master_index.json（支持外部无限扩充覆盖）
    const candidateFiles = [
      this.indexFilePath,
      path.join(__dirname, 'master_index.json'),
      ...this.customDirs.filter(Boolean).flatMap((d) => [
        path.join(d, 'master_index.json'),
        path.join(d, 'runtime', 'master_index.json'),
      ]),
    ]
    for (const file of candidateFiles) {
      if (!file || !fs.existsSync(file)) continue
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
        Object.assign(map, this._normalizeData(raw))
      } catch {
        /* ignore */
      }
    }

    this.tagMapping = map
    this.sortedKeys = Object.keys(map).sort((a, b) => b.length - a.length)
    this.loadedAt = Date.now()
    return Object.keys(this.tagMapping).length
  }

  _normalizeData(data) {
    const flatMap = {}
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item && typeof item === 'object') {
          const en = item.en || item.tag
          if (!en) continue
          const enClean = String(en).trim()
          const zhPrimary = item.zh || item.name || item.label
          if (zhPrimary) {
            flatMap[String(zhPrimary).trim().toLowerCase()] = enClean
          }
          if (Array.isArray(item.terms)) {
            for (const t of item.terms) {
              if (t) flatMap[String(t).trim().toLowerCase()] = enClean
            }
          }
        }
      }
    } else if (data && typeof data === 'object') {
      const recursiveExtract = (node) => {
        if (Array.isArray(node)) {
          for (const sub of node) recursiveExtract(sub)
        } else if (node && typeof node === 'object') {
          if ('zh' in node && 'en' in node && node.zh && node.en) {
            flatMap[String(node.zh).trim().toLowerCase()] = String(node.en).trim()
          } else {
            for (const [k, v] of Object.entries(node)) {
              if (v && typeof v === 'object') {
                recursiveExtract(v)
              } else if (typeof v === 'string' && String(k).length < 20) {
                flatMap[String(k).trim().toLowerCase()] = v.trim()
              }
            }
          }
        }
      }
      recursiveExtract(data)
    }
    return flatMap
  }

  /**
   * 扫描输入句子，按最长词优先（无重叠区间）提取命中的中文词条与未命中的剩余文本
   */
  scanHits(userInput) {
    if (!userInput || typeof userInput !== 'string') {
      return { translatedText: '', hits: [], remainingText: '' }
    }
    if (Date.now() - this.loadedAt > 30000) this.loadIndex()

    let processedText = userInput.trim()
    let remainingText = processedText
    const hits = []
    if (!this.sortedKeys.length) {
      return { translatedText: processedText, hits, remainingText }
    }

    const lowerInput = processedText.toLowerCase()
    const occupied = new Array(processedText.length).fill(false)
    const matchedSpans = []

    for (const zhKey of this.sortedKeys) {
      if (zhKey.length < 2) continue
      let startIdx = lowerInput.indexOf(zhKey)
      while (startIdx !== -1) {
        const endIdx = startIdx + zhKey.length
        let overlap = false
        for (let i = startIdx; i < endIdx; i++) {
          if (occupied[i]) {
            overlap = true
            break
          }
        }
        if (!overlap) {
          for (let i = startIdx; i < endIdx; i++) occupied[i] = true
          const enVal = this.tagMapping[zhKey]
          matchedSpans.push({ start: startIdx, end: endIdx, zh: processedText.slice(startIdx, endIdx), key: zhKey, en: enVal })
          hits.push({ zh: zhKey, en: enVal })
        }
        startIdx = lowerInput.indexOf(zhKey, startIdx + 1)
      }
    }

    if (matchedSpans.length > 0) {
      matchedSpans.sort((a, b) => b.start - a.start)
      for (const sp of matchedSpans) {
        processedText = `${processedText.slice(0, sp.start)}${sp.en}${processedText.slice(sp.end)}`
        remainingText = `${remainingText.slice(0, sp.start)} ${remainingText.slice(sp.end)}`
      }
    }

    return { translatedText: processedText, hits, remainingText: remainingText.trim() }
  }

  /**
   * 通用句子翻译与替换核心方法（与 Python 版 translate_sentence 对齐）
   */
  translateSentence(userInput) {
    return this.scanHits(userInput).translatedText
  }

  /**
   * 关键词实时检索方法：支持按中文或英文模糊搜索词库与外部索引，返回标准词条列表
   */
  searchTags(query, limit = 24) {
    const q = String(query || '').trim().toLowerCase()
    if (!q) return []
    if (Date.now() - this.loadedAt > 30000) this.loadIndex()

    const lib = loadLibrary(this.customDirs)
    const results = []
    const seenEn = new Set()

    // 1. 先从带分类的完整百科词库检索（精确前缀 > 包含匹配）
    const exactMatches = []
    const partialMatches = []
    for (const item of lib) {
      if (!item || !item.en || !item.label) continue
      const enLower = String(item.en).toLowerCase()
      const labelLower = String(item.label).toLowerCase()
      const terms = Array.isArray(item.terms) ? item.terms.map((t) => String(t).toLowerCase()) : []

      if (labelLower === q || terms.includes(q) || enLower === q) {
        exactMatches.push({ zh: item.label, en: item.en, cat: item.cat || '通用词条', score: 100 })
      } else if (labelLower.startsWith(q) || terms.some((t) => t.startsWith(q))) {
        exactMatches.push({ zh: item.label, en: item.en, cat: item.cat || '通用词条', score: 85 })
      } else if (labelLower.includes(q) || terms.some((t) => t.includes(q)) || enLower.includes(q)) {
        partialMatches.push({ zh: item.label, en: item.en, cat: item.cat || '通用词条', score: 60 - Math.min(20, labelLower.length) })
      }
    }

    for (const m of [...exactMatches.sort((a, b) => b.score - a.score), ...partialMatches.sort((a, b) => b.score - a.score)]) {
      const k = m.en.toLowerCase()
      if (!seenEn.has(k)) {
        seenEn.add(k)
        results.push({ label: m.zh, zh: m.zh, en: m.en, cat: m.cat })
        if (results.length >= limit) return results
      }
    }

    // 2. 再从外部 master_index 扁平索引补充检索
    for (const zhKey of this.sortedKeys) {
      const enVal = this.tagMapping[zhKey]
      if (!enVal) continue
      const k = enVal.toLowerCase()
      if (seenEn.has(k)) continue
      if (zhKey.includes(q) || k.includes(q)) {
        seenEn.add(k)
        results.push({ label: zhKey, zh: zhKey, en: enVal, cat: '外部索引' })
        if (results.length >= limit) break
      }
    }

    return results
  }
}

let _sharedTranslator = null
function getUniversalTranslator(customDirs = []) {
  if (!_sharedTranslator) {
    _sharedTranslator = new UniversalTagTranslator(path.join(__dirname, 'master_index.json'), customDirs)
  } else if (Array.isArray(customDirs) && customDirs.length > 0) {
    _sharedTranslator.customDirs = customDirs
  }
  return _sharedTranslator
}

module.exports = {
  loadLibrary,
  matchSlangGlossary,
  matchDimensionBank,
  retrieveCorpusForInput,
  buildFallbackOrMergeFields,
  translateWithGlossary,
  detectInputContext,
  decomposeUnknownCn,
  UniversalTagTranslator,
  getUniversalTranslator,
}
