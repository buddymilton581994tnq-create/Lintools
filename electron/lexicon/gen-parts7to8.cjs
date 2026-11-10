'use strict'
const fs = require('fs')
const path = require('path')

const lexiconDir = path.join(__dirname, 'lexicon')
fs.mkdirSync(lexiconDir, { recursive: true })

function pack(cat, rows) {
  return rows.map(([termsStr, label, en]) => ({
    cat,
    terms: termsStr.split('|').map((s) => s.trim()).filter(Boolean),
    label,
    en,
  }))
}

// ===========================================================================
// 卷七：服装制版原子词（领型/袖型/裙型/内搭/特殊材质）、特效魔法、分镜排版、冷门世界观
// ===========================================================================
const part7AtomicAndWorldviews = [
  ...pack('服装领型与袖型细节', [
    ['水手领|海军领', '海军水手领', 'classic sailor collar with contrasting stripe trim'],
    ['娃娃领|彼得潘领', '圆角蕾丝娃娃领', 'rounded Peter Pan collar edged with delicate lace'],
    ['立领|中华立领|盘扣立领', '中式织锦盘扣立领', 'traditional mandarin stand collar with handmade frog button clasp'],
    ['高领|堆堆领|半高领', '修身针织高领', 'snug ribbed turtleneck collar'],
    ['方领|法式方领|露锁骨方领', '法式复古大方领', 'wide French square neckline framing collarbones'],
    ['一字肩|一字领|卡肩礼服领', '优雅露肩一字领', 'off-the-shoulder bardot neckline exposing shoulders'],
    ['深V领|交叉V领', '修饰颈线深V领', 'plunging V-neckline'],
    ['挂脖领|绕颈削肩|halter', '优雅绕颈削肩挂脖领', 'halter neck strap tied behind nape, bare shoulders'],
    ['心形领|抹胸领|sweetheart neckline', '复古抹胸心形领', 'structured sweetheart bustier neckline'],
    ['荷叶领|拉夫领|伊丽莎白褶领|ruff', '古典多层风琴褶拉夫领', 'elaborate Elizabethan pleated organza ruff collar'],
    ['泡泡袖|公主袖|灯笼袖', '蓬松薄纱公主泡泡袖', 'voluminous sheer puff sleeves gathered at cuffs'],
    ['羊腿袖|复古宫廷袖', '维多利亚古典羊腿袖', '1890s gigot leg-of-mutton sleeves tapering tightly to forearm'],
    ['喇叭袖|水袖|钟形大袖|振袖长袂', '飘逸层叠蕾丝喇叭袖', 'flared bell sleeves with cascading lace cuffs'],
    ['主教袖|系带开叉袖', '垂坠感丝绸主教灯笼袖', 'billowing sheer silk bishop sleeves buttoned at wrist'],
    ['冰袖|分离袖|袖套|detached sleeves', '二次元露肩分离式长袖套', 'detached wide flared sleeves held above elbows with ribbon bands, bare shoulders'],
    ['朱丽叶袖|宫廷分段泡袖', '浪漫古典朱丽叶分段袖', 'romantic Juliet sleeve puffed at shoulder and fitted down forearm']
  ]),

  ...pack('裙型、裤型与局部穿搭原子词', [
    ['百褶裙|学院格纹裙|JK短裙', '高腰格纹刀褶百褶裙', 'high-waisted knife-pleated tartan mini skirt'],
    ['伞裙|大摆裙|圆裙|赫本裙', '优雅过膝复古高腰大摆伞裙', '1950s Audrey Hepburn style full-circle A-line midi skirt'],
    ['鱼尾裙|包臀鱼尾礼服裙', '勾勒曲线修身丝缎鱼尾裙', 'figure-hugging mermaid trumpet skirt flaring below knees'],
    ['蛋糕裙|多层荷叶边塔裙', '层叠蕾丝花边蓬松蛋糕塔裙', 'tiered ruffled chiffon layer cake skirt'],
    ['前短后长裙|燕尾裙|不对称斜裁裙', '飘逸前短后长燕尾纱裙', 'asymmetrical high-low hem tulle skirt with flowing back train'],
    ['花苞裙|郁金香裙|气球蓬裙', '俏皮立体褶皱花苞短裙', 'sculptural gathered bubble hem mini skirt'],
    ['纱裙|仙女网纱裙|tulle skirt', '轻盈多层雾感网纱长裙', 'ethereal multi-layered misty tulle maxi skirt'],
    ['背带裙|背带裤|工装连体裤', '复古学院牛角扣背带裙', 'vintage pinafore suspender dress over blouse'],
    ['热裤|牛仔毛边短裤|皮短裤', '高腰磨边丹宁牛仔热裤', 'high-waisted frayed-hem denim daisy dukes shorts'],
    ['阔腿裤|垂感西装裤|水手阔腿裤', '潇洒高腰垂坠感西装阔腿裤', 'high-waisted wide-leg tailored pleated trousers'],
    ['灯笼裤|哈伦裤|西域纱裤', '轻盈半透金丝雪纺灯笼裤', 'sheer gold-trimmed silk harem pants gathered at ankles'],
    ['工装裤|伞兵裤|机能多袋束脚裤', '多口袋飘带战术束脚工装裤', 'tactical multi-pocket cargo joggers with hanging webbing straps'],
    ['腰封|宽皮腰带|金属腰链|束腰封', '雕花银扣皮革塑形宽腰封', 'wide cinched leather waist corset belt with engraved silver buckle'],
    ['披肩|皮草披肩|蕾丝坎肩|云肩', '珍珠流苏苏绣四合如意云肩', 'traditional Chinese embroidered cloud-collar (yunjian) with dangling pearl tassels'],
    ['手套|蕾丝长手套|歌剧丝缎手套|露指战术手套|猫爪手套', '优雅肘上丝缎歌剧长手套', 'elbow-length glossy white satin opera gloves'],
    ['面纱|半透黑纱|珠帘面纱|狐狸面具|威尼斯舞会面具|防毒面具', '半遮面神秘金丝刺绣薄纱面帘', 'translucent gold-embroidered sheer face veil revealing expressive eyes']
  ]),

  ...pack('冷门科幻、奇幻与复古未来世界观美学', [
    ['太阳朋克|solarpunk|生态乌托邦|绿植玻璃未来城', '阳光绿植与流线白瓷光伏融合的太阳朋克生态城', 'Solarpunk utopia aesthetic, Art Nouveau curved glass towers covered in lush hanging gardens, wind turbines, warm sunlight'],
    ['柴油朋克|dieselpunk|二战复古重工业柳钉机械', '1940年代铆钉钢板重油烟雾柴油朋克美学', '1940s gritty Dieselpunk aesthetic, riveted heavy steel plating, roaring radial piston engines, brass gauges, oil smoke'],
    ['原子朋克|atompunk|1950年代太空竞赛复古科幻|辐射风', '1950年代镀铬流线鱼鳍火箭原子朋克美学', '1950s retro-futuristic Atompunk style, Googie architecture, chrome tailfins, bubble-helmet raygun sci-fi'],
    ['发条朋克|clockwork punk|达芬奇手稿机械风', '精密镂空黄铜游丝发条机械朋克美学', 'Renaissance Clockpunk aesthetic, intricate exposed brass escapement gears,mainsprings, Leonardo parchment blueprints'],
    ['丝绸朋克|silkpunk|机关术|木牛流马东方奇幻机械', '竹木丝绸与青铜齿轮结合的东方机关术丝绸朋克', 'Oriental Silkpunk aesthetic, giant bamboo-and-silk mechanical wings, bronze interlocking luopan gears, glowing paper lanterns'],
    ['生化朋克|biopunk|基因培养皿荧光有机科技', '幽绿营养液玻璃培养舱与有机神经科技生化朋克', 'Biopunk laboratory aesthetic, glowing emerald nutrient tanks, translucent organic tubing, genetic helix holograms'],
    ['磁带未来主义|cassette futurism|80年代CRT按键机械太空舱|异形1工业风', '80年代厚重机械键盘与琥珀色CRT监视器磁带未来主义', '1980s Cassette Futurism aesthetic, chunky tactile mechanical switches, amber monochrome CRT monitors, coiled cords, beige ABS plastic'],
    ['残酷主义|粗野主义建筑|brutalism|沙丘巨物风|BDO巨构恐惧', '沙丘式压迫感几何裸露混凝土巨构建筑美学', 'monolithic Brutalist megastructure architecture, raw board-formed concrete slabs, tiny human figure for colossal scale'],
    ['中式民俗怪谈|中式梦核|纸人红轿冥婚微恐|规则怪谈美学', '幽暗冷绿雾气配大红纸灯笼的中式民俗悬疑美学', 'eerie Chinese folklore horror aesthetic, coldjade mist contrasted with glowing blood-red paper lanterns, weathered ancestral courtyard'],
    ['哥特血源风|维多利亚克苏鲁|雅楠古街夜雨', '血源诅咒式尖塔铁栅栏湿滑鹅卵石黑夜古街', 'Bloodborne inspired Victorian Gothic nightmare cityscape, towering spires, wrought-iron streetlamps in cold fog, wet cobblestones'],
    ['剑与魔法|JRPG王道奇幻|浮空岛水晶塔', '碧空云海与古代魔法水晶环绕的JRPG浮空遗迹', 'classic high-fantasy JRPG world, floating grassy sky islands with cascading waterfalls, giant glowing mana crystal spire']
  ]),

  ...pack('魔法元素、粒子流体与超自然画面特效', [
    ['火焰特效|青莲业火|凤凰烈焰|火星飞溅', '盘旋升腾的半透明炽热金红火焰与飞舞火星', 'swirling tongues of roaring translucent golden-crimson fire and glowing floating embers'],
    ['冰霜魔法|冰晶碎裂|绝对零度寒气|六角雪花冰凌', '空气凝结锐利剔透的发光蓝白冰晶棱柱与寒雾', 'razor-sharp translucent sapphire ice crystals erupting in mid-air with freezing mist trails'],
    ['雷电特效|紫电青霜|电弧环绕|闪电链', '噼啪跃动的高亮蓝白与电光紫高压闪电电弧', 'crackling arcs of blinding electric cyan-violet plasma lightning branching across body'],
    ['水魔法|悬浮水球|水龙卷|清澈流体飞溅', '失重悬浮折射光影的清澈螺旋水流缎带', 'zero-gravity ribbons of crystal-clear liquid water swirling gracefully with suspended droplets and refraction'],
    ['圣光魔法|金色羽毛飘落|神圣法阵|金色粒子', '神圣柔和的鎏金几何魔法阵与飘落发光白羽', 'intricate glowing golden geometric magic circle beneath feet, drifting luminous white feathers and light particles'],
    ['暗影黑雾|深渊黑炎|彼岸花瓣飞散|乌鸦群飞', '翻涌的黑紫深渊魔气与纷飞的暗红花瓣乌鸦羽毛', 'tendrils of shadowy obsidian-violet dark miasma smoke mixed with scattering black raven feathers and crimson petals'],
    ['星辰魔法|银河星屑|星座连线|极光星云流体', '指尖流淌的璀璨深空星云尘埃与发光黄金星轨', 'cosmic nebula stardust and glowing golden constellation lines swirling around fingertips'],
    ['全息UI|科幻HUD界面|悬浮半透明代码框', '悬浮在空气中的半透明青色全息数据投影交互界面', 'floating translucent cyan holographic HUD data screens and geometric wireframes casting soft glow'],
    ['花吹雪|漫天玫瑰花瓣|金色银杏叶飞舞|蒲公英绒毛', '微风卷起漫天飞舞的柔焦半透明樱花瓣雨', 'whirlwind of thousands of soft-focus translucent pink sakura petals dancing across the frame'],
    ['蝴蝶群|发光蓝闪蝶|萤火虫夏夜微光', '幽暗夜色中成群飞舞的发光大蓝闪蝶与黄绿萤火虫', 'swarm of iridescent glowing blue morpho butterflies and warm fireflies illuminating the twilight air']
  ]),

  ...pack('分镜排版、边框设计与特殊画幅形式', [
    ['塔罗牌|穆夏卡牌框|烫金羊皮纸边框|库洛牌风', '烫金神秘学星象日月雕花塔罗牌卡面构图', 'ornate gilded Tarot card illustration layout, intricate astrological sun-and-moon border filigree, Roman numeral header'],
    ['立绘卡牌|SSR抽卡立绘|满破立绘背景特效', '手游SSR满破动态张力华丽背景特效大立绘', 'gacha game SSR awakened splash art, dynamic diagonal action pose surrounded by elaborate elemental props and effects'],
    ['杂志封面|Vogue时尚大片排版|日杂风留白排版', '高级时尚摄影大片质感构图预留干净版式空间', 'high-fashion editorial magazine cover photography, crisp studio styling, clean negative space at top for masthead'],
    ['四格漫画|多格漫画分镜|电影上下黑边字幕截图', '2.35:1宽银幕电影上下黑边带胶片质感剧照', '2.35:1 letterboxed cinema frame still, subtle cinematic film grain, poignant dramatic storytelling moment'],
    ['贴纸风|模切白边贴纸|手帐拼贴画|knolling平铺整齐陈列', '强迫症治愈系90度俯拍物品整齐几何平铺陈列', 'knolling flat-lay photography, everyday items and accessories arranged in crisp parallel 90-degree geometric order'],
    ['等距微缩房间|isometric|剖面小窝盒子模型', '精致可爱的45度等轴测微缩立体剖面小房间盒子', 'cute isometric 3D cutaway diorama box room, warm miniature furniture details, floating isolated on clean backdrop']
  ])
]

// ===========================================================================
// 卷八：丰富动植物品种、乐器载具、生活道具与电影大师色彩美学
// ===========================================================================
const part8FloraFaunaCinema = [
  ...pack('花卉植物与奇幻生态细节', [
    ['蓝玫瑰|碎冰蓝玫瑰|黑玫瑰|红玫瑰|蔷薇花墙', '带着晨露水珠的丝绒深红与碎冰蓝玫瑰花丛', 'velvety deep crimson and frosted ice-blue roses glistening with morning dewdrops'],
    ['绣球花|紫阳花|梅雨季蓝紫绣球', '梅雨细雨中团簇盛开的清透蓝紫渐变紫阳花', 'lush clusters of pastel blue-and-violet hydrangea blooms wet with summer rain'],
    ['白百合|铁炮百合|铃兰|郁金香|鸢尾花|睡莲', '纯洁垂首的白色铃兰小花与清透绿叶', 'delicate nodding white lily-of-the-valley bell flowers with dewy green leaves'],
    ['昙花|月下美人|夜来香|紫藤花瀑|流苏紫藤', '月夜下如紫色瀑布般垂落的梦幻紫藤花廊', 'cascading curtains of luminous lavender wisteria blossoms hanging overhead at night'],
    ['荷花|青莲|残荷听雨|竹叶|红梅|傲雪寒梅|白山茶', '薄雾荷塘中亭亭玉立的粉白荷花与滚珠碧绿荷叶', 'serene pink-tipped white lotus flower rising above misty pond water, crystal water beads onjade lotus leaves'],
    ['发光蘑菇|幽灵菇|水晶植物|世界树巨木', '散发幽蓝微光的半透明森林奇幻荧光伞菌群', 'clusters of translucent bioluminescent blue forest mushrooms glowing softly on mossy bark']
  ]),

  ...pack('真实与幻想动物伴侣', [
    ['黑猫|异瞳白猫|布偶猫|三花猫|橘猫|缅因猫', '毛发蓬松柔顺蓝眼睛的海豹双色布偶猫', 'fluffy blue-eyed bicolor Ragdoll cat with silky long fur'],
    ['柴犬|萨摩耶|哈士奇|边境牧羊犬|杜宾犬|白狼', '威风凛凛银白厚实毛发的雪原巨型白狼', 'majestic giant arctic white wolf with thick silver-white fur and piercing amber eyes'],
    ['白狐|九尾灵狐|雪貂|垂耳兔|小熊猫|梅花鹿|发光水林灵鹿', '林间雾气中鹿角缠绕发光花枝的纯白灵鹿', 'ethereal pure-white forest stag with glowing blossoms entwined around crystal antlers'],
    ['乌鸦|渡鸦|白鸽|雪鸮猫头鹰|仙鹤|丹顶鹤|青鸾白凤|孔雀', '展翅欲飞羽翼优雅分明的洁白丹顶仙鹤', 'graceful red-crowned white crane spreading layered ink-tipped wings in flight'],
    ['锦鲤|红白鎏金长尾锦鲤|深海蓝鲸|发光水母', '如轻纱般在空中或深水飘游的半透明长尾鎏金锦鲤', 'flowing veil-tailed red-and-gold koi fish swimming gracefully with shimmering scales'],
    ['西方巨龙|冰霜巨龙|东方青龙|白龙|烛龙', '云海雷霆间盘旋的修长威严金鳞东方神龙', 'majestic celestial Chinese azure-and-gold dragon coiling through storm clouds, flowing whiskers, pearl of lightning']
  ]),

  ...pack('电影大师与著名动画导演色彩影调', [
    ['王家卫风|重庆森林杜可风|霓虹迷离红绿影调', '王家卫电影式浓郁祖母绿与暖黄霓虹暧昧胶片影调', 'Wong Kar-wai & Christopher Doyle cinematography, lush saturated emerald greens and warm tungsten yellows, motion blur nostalgia'],
    ['韦斯安德森风|布达佩斯大饭店糖果粉彩对称', '布达佩斯大饭店式高明度茱萸粉与薄荷绿对称美学', 'Wes Anderson Grand Budapest Hotel palette, whimsical dusty pastel pink, mint green, and mustard yellow, deadpan symmetry'],
    ['银翼杀手2049|维伦纽瓦橙色沙尘与冷蓝巨物影调', '银翼杀手2049式恢弘冷青雾气与高饱和橙黄雾霾影调', 'Denis Villeneuve & Roger Deakins Blade Runner 2049 color grading, monolithic atmospheric orange haze and stark cold teal'],
    ['岩井俊二风|情书雪景逆光|青春透明感过曝柔光', '岩井俊二《情书》式清透高调自然逆光青春胶片感', 'Shunji Iwai Love Letter aesthetic, airy overexposed natural backlighting, pure nostalgic winter snow and sheer white curtain'],
    ['是枝裕和|小森食光海街日记|清淡日系夏日胶片', '日系海街日记式清爽低对比青蓝夏日生活胶片调', 'Hirokazu Kore-eda Japanese summer slice-of-life film tone, gentle cyan-green foliage, natural cicada-summer sunlight'],
    ['今敏风|红辣椒千年女优超现实梦境蒙太奇', '今敏动画式绚丽繁复超现实梦境视觉拼贴奇观', 'Satoshi Kon Paprika inspired surreal anime visual spectacle, vivid psychological color contrast, dreamlike reality-bending details'],
    ['扳机社风|Trigger今石洋之边缘行者荧光撞色张力透视', '扳机社式夸张透视锐利阴影与高饱和荧光霓虹撞色', 'Studio Trigger Hiroyuki Imaishi anime style, hyper-dynamic foreshortening, sharp geometric colored shadows, electric neon palette'],
    ['京阿尼风|京都动画紫罗兰永恒花园极致细腻光影发丝', '京都动画剧场版级细腻瞳孔反光与华丽微风发丝光效', 'Kyoto Animation Violet Evergarden movie quality, breathtakingly detailed eye reflections, billowing fabric, golden dappled light'],
    ['飞碟社风|ufotable绚烂光污染粒子燃烧刀光特效', 'ufotable剧场版级数字摄影光晕与流光溢彩粒子特效', 'ufotable digital compositing anime aesthetic, dazzling chromatic light particles, intense glowing blade trails, deep atmospheric contrast'],
    ['新房昭之风|物语系列几何色块歪头剪影怪诞美学', '物语系列式大胆纯色几何背景与戏剧性仰角构图', 'Shaft studio Akiyuki Shinbo aesthetic, avant-garde flat graphic color backgrounds, stark architectural shadows, iconic head-tilt']
  ]),

  ...pack('乐器、载具与精致日常静物道具', [
    ['大提琴|小提琴|三角钢琴|古典竖琴|电吉他|贝斯', '聚光灯下乌木抛光三角钢琴与纷飞琴谱', 'glossy ebony grand piano with open lid reflecting warm light, floating sheet music pages'],
    ['复古机车|咖啡骑士摩托|赛博重机|阿基拉红色摩托', '流线型红色科幻重型摩托漂移电光轨迹', 'futuristic crimson cyber-motorcycle leaning into a high-speed drift with neon taillight trails'],
    ['蒸汽火车|银河铁道列车|复古有轨电车|海景电车窗边', '驶过蔚蓝海岸线的复古绿皮木质车厢电车窗畔', 'vintage wooden-interior coastal tram car window overlooking sparkling turquoise ocean waves under summer clouds'],
    ['透明雨伞|蕾丝阳伞|红油纸伞|和伞', '挂满晶莹雨珠映射霓虹光斑的透明塑胶长柄伞', 'clear vinyl umbrella covered in sparkling raindrops reflecting colorful city street lights'],
    ['高脚红酒杯|下午茶骨瓷杯|鸡尾酒冰块|香水瓶|沙漏', '雕花水晶高脚杯盛着宝石红液体与细腻光影折射', 'cut-crystal stemmed wineglass swirling with ruby liquid, casting sharp prismatic caustics on white tablecloth'],
    ['信封火漆印|羽毛笔墨水瓶|古旧怀表|复古拍立得相机|游戏手柄', '融化暗金火漆印章封口的羊皮信封与鹅毛笔', 'aged parchment letter sealed with crimson-gold wax stamp beside a brass inkwell and white quill']
  ])
]

fs.writeFileSync(path.join(lexiconDir, 'part7-atomic-worldviews.json'), JSON.stringify(part7AtomicAndWorldviews, null, 2), 'utf8')
fs.writeFileSync(path.join(lexiconDir, 'part8-flora-fauna-cinema.json'), JSON.stringify(part8FloraFaunaCinema, null, 2), 'utf8')
console.log('Generated parts 7-8:', part7AtomicAndWorldviews.length + part8FloraFaunaCinema.length)
