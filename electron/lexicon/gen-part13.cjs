'use strict'
const fs = require('fs')
const path = require('path')

const lexiconDir = __dirname

function pack(cat, rows) {
  return rows.map(([termsStr, label, en]) => ({
    cat,
    terms: termsStr.split('|').map((s) => s.trim()).filter(Boolean),
    label,
    en,
  }))
}

// 卷十三：Danbooru 二次元/服装/饰品/身体/表情/镜头 细分词典
const part13 = [
  ...pack('二次元身体与皮肤特征', [
    ['尖耳朵|妖精耳|精灵耳|pointed ears', '修长精灵尖耳', 'pointed elf ears'],
    ['机械耳|电子耳|mechanical ears', '科幻发光机械耳', 'mechanical cybernetic ears'],
    ['垂耳|耷拉耳朵', '软萌下垂兽耳', 'droopy animal ears'],
    ['光环|头顶光环|机械光环|几何光环|halo', '悬浮发光几何光环', 'floating glowing halo above head'],
    ['翅膀|白翼|羽翼|单翼|不对称翅膀', '洁白层叠羽翼', 'feathered angel wings'],
    ['恶魔翼|蝙蝠翼|龙翼|骨翼', '暗黑皮革恶魔蝠翼', 'leathery bat demon wings'],
    ['机械翼|光翼|能量羽翼|高达光翼', '全息流光机械装甲翼', 'glowing holographic mechanical wings'],
    ['蝴蝶翅膀|精灵薄翼|透明虫翼', '幻彩半透明精灵蝶翼', 'iridescent translucent fairy butterfly wings'],
    ['恶魔尾|心形尾巴|魅魔尾', '细长心形尖端恶魔尾', 'slender spade-tipped demon tail'],
    ['猫尾|双尾猫又|摇晃尾巴', '灵动弯曲毛茸猫尾', 'curled fluffy cat tail'],
    ['狐尾|蓬松大尾巴|白尖狐尾', '蓬松柔软白尖狐尾', 'huge fluffy white-tipped fox tail'],
    ['龙尾|鳞片长尾', '修长覆鳞龙尾', 'long scaled dragon tail'],
    ['机械尾|数据线尾巴', '发光接口机械长尾', 'segmented cybernetic cable tail'],
    ['鹿角|树枝角|水晶角', '晶莹剔透分叉水晶鹿角', 'branching translucent crystal antlers'],
    ['鬼角|单角|双角|弯角', '额前弯曲龙角鬼角', 'curved horns on forehead'],
    ['酒窝|梨涡|嘴角笑窝', '甜美脸颊浅浅梨涡', 'cute cheek dimples when smiling'],
    ['泪痣|眼角痣|胸口痣|美人痣', '眼下精致小巧泪痣', 'delicate beauty mark under eye'],
    ['纹身|刺青|蝴蝶纹身|肩部纹身|腿部纹身', '精致暗黑花纹刺青', 'intricate decorative tattoo on skin'],
    ['绷带|缠绕绷带|战损绷带|手指绷带', '缠绕手臂的白色医疗绷带', 'wrapped white medical bandages'],
    ['眼罩|单眼眼罩|蕾丝眼罩|医疗眼罩', '哥特黑色蕾丝单眼眼罩', 'black lace eyepatch covering one eye'],
    ['伤疤|刀疤|脸颊伤痕|战损痕迹', '冷酷脸颊细微战斗伤痕', 'subtle cool battle scar across cheek'],
    ['晒痕|泳衣晒痕|比基尼晒痕|tanlines', '健康小麦肌清晰泳衣晒痕', 'distinct sun-kissed bikini tanlines'],
    ['苍白皮肤|吸血鬼冷白皮|病弱白皙', '毫无血色的冷调瓷白肌肤', 'porcelain pale snow-white complexion'],
    ['古铜色皮肤|蜜糖色肌肤|健康小麦色', '光泽感健康蜜糖小麦色肌肤', 'glossy sun-tanned honey-bronze skin'],
    ['人偶关节|木偶关节|机械球形关节|doll joints', '精致球体人偶陶瓷关节', 'articulated ball-jointed doll limbs'],
    ['发光皮肤纹路|赛博义体接缝|cyberware lines', '科幻面部与身体义体接缝线', 'subtle cybernetic panel lines on skin'],
    ['湿润皮肤|出汗|运动微汗|水珠光泽', '晶莹汗珠与光泽感湿润肌肤', 'glistening wet skin with tiny sweat droplets']
  ]),

  ...pack('二次元服装单品与冷门穿搭细节', [
    ['吊带背心|细肩带背心|camisole', '修身真丝细吊带背心', 'fitted silk camisole top with spaghetti straps'],
    ['抹胸|裹胸|tube top|缠胸布|さらし', '修身无肩带抹胸上衣', 'strapless fitted tube top'],
    ['露脐装|短款上衣|crop top', '露出纤细腰线的短款露脐装', 'cropped top exposing slender midriff and navel'],
    ['开衫|针织开衫|学院毛衣开衫|cardigan', '宽松软糯学院风针织开衫', 'oversized unbuttoned knit cardigan'],
    ['马甲|西装马甲|针织背心|vest', '修身英伦风排扣西装马甲', 'tailored buttoned waistcoat vest'],
    ['斗篷披肩|小披肩|红帽兜帽|capelet', '系带蕾丝短款肩部小披肩', 'frilly lace-trimmed shoulder capelet with ribbon tie'],
    ['百褶长裙|风琴褶半身长裙', '垂坠感及踝风琴百褶长裙', 'ankle-length accordion pleated maxi skirt'],
    ['开叉裙|高开叉长裙|侧开叉包臀裙', '露出修长腿部线条的高开叉长裙', 'high side-slit skirt revealing long leg'],
    ['透视裙|薄纱罩裙|半透明纱裙|see-through', '若隐若现半透明欧根纱外裙', 'translucent sheer organza overlay skirt'],
    ['荷叶边围裙|女仆围裙|心形围裙|裸体围裙', '纯白荷叶边蝴蝶结系带围裙', 'ruffled white lace pinafore apron tied with a big back bow'],
    ['连体衣|紧身连体衣|体操连体衣|leotard', '修身剪裁高弹力连体衣', 'form-fitting sleek leotard bodysuit'],
    ['巫师袍|法袍|星空长袍|学院魔法袍', '绣满暗金星象纹样的宽大魔法袍', 'flowing arcane wizard robe embroidered with gold constellations'],
    ['道袍|水袖仙衣|鹤氅|羽衣', '仙气飘飘宽袖丝绸流云鹤氅', 'ethereal Taoist crane-feather silk cloak with billowing sleeves'],
    ['袈裟|僧衣|禅服', '古朴素雅麻布禅意僧袍', 'austere linen Buddhist monk robe and prayer beads'],
    ['狩衣|平安时代阴阳师服|公家装束', '日本平安时代宽袖织锦狩衣', 'Heian-period Japanese onmyoji kariginu silk hunting robe'],
    ['大正女仆|和风女仆|矢絣围裙装', '大正浪漫和服袖配蕾丝围裙女仆装', 'Taisho Roman kimono-sleeve maid uniform with white lace apron'],
    ['哥特修女|高开叉修女礼服|暗黑修道服', '哥特暗黑金边修身修女黑袍', 'gothic black-and-gold trimmed nun habit with high slit'],
    ['赛博女仆|机能女仆|发光围裙装', '赛博荧光管道战术机能女仆装', 'cyberpunk techwear maid outfit with glowing neon piping and tactical buckles'],
    ['旗袍女仆|中华娘女仆装', '盘扣立领改良旗袍式荷叶边女仆装', 'Chinese qipao-inspired maid dress with mandarin collar and ruffled apron'],
    ['兔耳连帽衫|猫耳卫衣|兽耳外套', '带长长的垂耳兔耳朵宽松连帽卫衣', 'oversized pastel hoodie with long floppy bunny ears on the hood'],
    ['水手服领巾|三角巾|丝巾领结', '飘逸丝绸水手领三角领巾', 'silk sailor neckerchief tied neatly at chest'],
    ['吊带背带|皮质枪套背带|战术肩带|harness', '酷飒皮革金属环胸前装饰背带', 'stylish leather body harness straps with silver O-rings'],
    ['腿环|蕾丝腿环|皮质大腿环|战术腿包', '点缀在大腿处的精致蕾丝皮质腿环', 'delicate lace and leather thigh garter strap'],
    ['臂环|金丝臂钏|袖箍|armband', '缠绕上臂的鎏金敦煌花纹臂钏', 'ornate gilded filigree upper-arm bracelet (armlet)'],
    ['脚链|铃铛脚链|红绳脚链|珍珠脚链|anklet', '纤细脚踝处系着的红绳金铃脚链', 'dainty red cord anklet with tiny golden bell around ankle'],
    ['单边耳挂|精灵耳挂|流苏耳骨夹', '贴合耳廓的银丝流苏精灵耳骨夹', 'silver filigree elf ear cuff with dangling chains'],
    ['发簪|白玉簪|木簪|团扇发钗|流苏步摇', '温润羊脂白玉雕刻兰花长发簪', 'carved mutton-fat white jade hairpin tucked into hair bun'],
    ['发带|蕾丝发带|红丝带|蝴蝶结发箍', '编入发丝的宽边丝绒蝴蝶结发带', 'wide velvet ribbon headband tied in a bow'],
    ['耳机|挂脖耳机|复古铁三角耳机|入耳式耳返', '挂在脖颈间的银色金属复古头戴耳机', 'retro brushed-aluminum headphones resting around neck'],
    ['防风镜|飞行员护目镜|蒸汽朋克铜护目镜|goggles', '斜戴在额头上的黄铜皮革护目镜', 'brass steampunk aviator goggles perched on forehead'],
    ['口罩|黑色机能面罩|蕾丝半面罩|狐狸半面具', '斜戴在耳侧的日式彩绘白狐半脸面具', 'hand-painted white kitsune fox mask worn tilted on side of head'],
    ['丝带缠绕|红线缠绕|花藤缠绕手臂', '指尖与手腕间缠绕的命运红丝线', 'delicate crimson fate ribbon thread entwined around fingers and wrists']
  ]),

  ...pack('室内陈设与唯美道具微观词条', [
    ['落地镜|复古雕花全身镜|化妆镜灯泡', '巴洛克鎏金雕花画框椭圆全身落地镜', 'ornate Baroque gilded oval floor mirror'],
    ['水晶吊灯|烛台吊灯|琉璃灯|蒂凡尼台灯', '折射璀璨光斑的复古彩色玻璃蒂凡尼台灯', 'vintage Tiffany stained-glass dragonfly table lamp casting warm glow'],
    ['浴缸|猫脚浴缸|玫瑰花瓣浴|温泉木桶', '撒满红玫瑰花瓣与泡沫的复古黄铜猫脚浴缸', 'vintage clawfoot porcelain bathtub filled with warm water, white bubbles, and floating rose petals'],
    ['鸟笼|复古黄铜大鸟笼|花艺鸟笼', '缠绕白蔷薇藤蔓的复古欧式黄铜缕空鸟笼', 'antique brass filigree birdcage entwined with blooming white climbing roses'],
    ['画架|木质画架|调色盘|油画颜料管', '沾满斑斓油彩的木质画架与实木调色板', 'wooden studio easel holding an unfinished canvas beside a paint-daubed palette'],
    ['地球仪|黄铜浑天仪|复古航海星图', '精密旋转的古典黄铜浑天仪与羊皮航海图', 'antique brass armillary sphere and rolled parchment star charts'],
    ['黑胶唱片机|大喇叭留声机|磁带随身听|CD机', '黄铜大喇叭缓缓旋转黑胶唱片的古典留声机', 'antique wooden gramophone with polished brass horn spinning a vinyl record'],
    ['下午茶架|三层甜点台|马卡龙|草莓塔|骨瓷茶壶', '摆满法式马卡龙与红茶骨瓷杯的银质三层下午茶架', 'three-tier silver afternoon tea stand laden with pastel macarons, strawberry tarts, and bone china teapot'],
    ['高脚杯|香槟塔|威士忌水晶杯|鸡尾酒调酒杯', '冒着细密金色气泡的修长水晶香槟杯', 'fluted crystal champagne glass with rising golden bubbles'],
    ['风铃|玻璃江户风铃|铜风铃|短册纸签', '绘制金鱼水纹随风摇曳的透明玻璃风铃', 'clear hand-painted glass Edo furin wind chime with fluttering paper strip'],
    ['捕梦网|羽毛捕梦网|风干花束|尤加利叶', '悬挂在窗前的白色羽毛蕾丝捕梦网', 'handwoven white lace and feather dreamcatcher hanging by window'],
    ['烛台|银质多头烛台|漂浮蜡烛|融化白蜡', '滴落蜡泪摇曳火苗的古典银质五头枝形烛台', 'ornate silver five-branch candelabra with melting white taper candles'],
    ['古籍|魔法书|烫金皮面书|散落书页', '书页泛黄悬浮发光符文的厚重皮面烫金魔导书', 'thick leather-bound grimoire with gold-tooled cover and glowing floating pages'],
    ['国际象棋|水晶棋盘|扑克牌飞舞|骰子', '黑白大理石棋盘上散落的雕花水晶国际象棋子', 'carved crystal and onyx chess pieces on a polished marble chessboard'],
    ['纸鹤|千纸鹤|发光折纸鹤|纸飞机', '成群飞舞的半透明发光折纸千纸鹤', 'flock of glowing translucent origami paper cranes flying through air'],
    ['红苹果|石榴籽|樱桃|葡萄藤|切开的柠檬', '晶莹如红宝石般饱满欲滴的新鲜石榴籽与果实', 'split ripe pomegranate revealing jewel-like glistening crimson seeds'],
    ['气泡水|波子汽水|奶油冰激凌苏打|棒棒糖', '插着红樱桃与香草冰激凌球的翠绿哈密瓜奶油苏打水', 'vibrant emerald melon cream soda topped with vanilla ice cream scoop and maraschino cherry']
  ]),

  ...pack('自然光影、天气与环境氛围细分词条', [
    ['树叶透光|木漏日|komorebi|林间碎金光', '穿过层叠翠绿树冠洒下的斑驳光影与微尘', 'komorebi dappled sunlight filtering through lush green tree canopy'],
    ['雨后初晴|彩虹|水洼倒影|湿润青苔', '雨后初晴石板路积水清晰倒映蓝天与彩虹', 'freshly rained cobblestone path with crystal puddles reflecting rainbow and clearing sky'],
    ['漫天飞雪|暴风雪|雪花落在睫毛上|呵气成霜', '细密晶莹的六角雪花静静飘落在发梢与睫毛上', 'delicate hexagonal snowflakes resting on hair and long eyelashes in winter air'],
    ['浓雾|晨雾|海雾|迷雾森林|烟雾缭绕', '乳白色静谧晨雾在幽深林间缓缓流淌', 'thick ethereal morning fog drifting softly between dark tree trunks'],
    ['火烧云|晚霞满天|紫粉黄昏云海', '漫天绚烂如油画般的紫罗兰与鎏金橘粉晚霞云海', 'breathtaking sunset sky ablaze with violet, magenta, and molten gold afterglow clouds'],
    ['流星雨|彗星划过夜空|双月同辉|月食红月', '璀璨彗星与流星雨划破深邃蔚蓝的夜空', 'radiant blue comet with long stardust tail streaking across starry night sky'],
    ['血月|暗红满月|哥特夜空', '哥特式阴云夜空中高悬的巨大暗红血月', 'giant ominous blood-red full moon hanging low in dark Gothic night sky'],
    ['水底视角|阳光穿透海面|气泡上升|深海失重', '清澈蔚蓝海底仰望阳光穿透波浪形成的光柱与上升气泡', 'underwater view looking up at shimmering sunbeams piercing ocean surface, rising silver air bubbles'],
    ['水面波纹|涟漪|一滴水落入水面皇冠水花', '指尖轻触平静水面荡开一圈圈晶莹同心圆涟漪', 'concentric crystal water ripples spreading across mirror-calm water surface'],
    ['羽毛飘落|白羽纷飞|黑羽散落', '空气中失重缓缓飘落的洁白柔软羽毛', 'soft white feathers drifting weightlessly through the air'],
    ['火星四溅|篝火余烬|金色光点漂浮', '夜风中盘旋上升的温暖篝火金色火星与光斑', 'swirling warm golden fire embers and glowing bokeh sparks rising into night air'],
    ['花瓣雨|玫瑰花雨|樱吹雪|银杏叶雨', '微风中漫天席卷的柔粉樱花瓣与光斑', 'swirling blizzard of pink cherry blossom petals caught in warm breeze']
  ]),

  ...pack('冷门艺术技法、材质与摄影术语补充', [
    ['银盐胶片颗粒|35mm胶片暗角|富士Velvia反转片', '色彩浓郁对比鲜明的富士Velvia反转片风光胶片质感', 'Fuji Velvia 50 slide film aesthetic, vivid saturated colors, rich shadow contrast, fine grain'],
    ['移轴微距|景深合成|超焦距全清晰', '从前景一草一木到远方雪山全部刀锋般锐利的超焦距摄影', 'hyperfocal landscape photography, tack-sharp clarity from immediate foreground wildflowers to distant peaks'],
    ['慢门追焦|摇拍背景动态模糊|运动速度感', '主体清晰锐利而背景呈高速水平流动线状模糊的摇拍追焦', 'panning shot photography, razor-sharp moving subject against horizontally streaked motion-blurred background'],
    ['逆光剪影|纯黑剪影配绚烂天空|边缘金线剪影', '绚烂晚霞背景下仅勾勒出优美金色身体轮廓线的戏剧剪影', 'dramatic rim-lit silhouette against vibrant twilight sky, glowing golden contour line'],
    ['高调摄影|纯白过曝空气感|日系清透高调', '纯净高明度柔和过曝的日系空气感高调人像', 'airy high-key portrait photography, luminous white tones, soft pastel contrast'],
    ['低调摄影|暗部沉浸|黑色背景单灯人像', '深邃纯黑背景中仅用一束柔光雕刻面部立体感的低调人像', 'moody low-key studio portrait, deep velvet black background, single softbox sculpting facial contours'],
    ['故障RGB分离|VHS录像带暂停横纹|CRT球面荧光屏', '90年代复古球面CRT电视机荧光扫描线与磁带色彩溢散质感', 'vintage 1990s curved CRT television screen texture, glowing phosphor scanlines, VHS color bleed'],
    ['全息箔|镭射卡纸|闪卡纹理|碎玻璃闪膜', '集换式卡牌SSR级璀璨碎钻镭射彩虹反光膜肌理', 'prismatic holographic foil card texture, shattered-glass rainbow metallic sheen'],
    ['大理石雕塑|米开朗基罗汉白玉石雕|断臂维纳斯质感', '温润半透光卡拉拉纯白汉白玉古典雕刻肌理', 'polished white Carrara marble classical sculpture, lifelike carved drapery and smooth stone translucency'],
    ['青铜器|三星堆青铜金面具|错金银绿锈古铜', '斑驳翠绿铜锈与璀璨金箔交织的远古神秘青铜艺术', 'ancient ritual bronze artifact with verdigris patina and gleaming gold foil inlay'],
    ['琉璃|吹制玻璃|古法琉璃内画|琥珀昆虫包体', '通透流转着绚丽彩云纹路的古法烧制水晶琉璃质感', 'hand-blown translucent crystal art glass with swirling internal colored ribbons and light refraction'],
    ['刺绣|苏绣双面绣|真丝劈丝绣线光泽', '根根丝线分明折射柔润丝绸光泽的非遗手工苏绣肌理', 'microscopic handmade silk embroidery texture, shimmering split silk threads forming lifelike gradients']
  ])
]

fs.writeFileSync(path.join(lexiconDir, 'part13-danbooru-expanded.json'), JSON.stringify(part13, null, 2), 'utf8')
console.log('Generated part 13:', part13.length)
