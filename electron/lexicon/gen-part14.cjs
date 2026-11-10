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

const part14 = [
  ...pack('高频画师与名家美学风格', [
    ['wlop|鬼刀风|碎光厚涂唯美风', 'WLOP式松散笔触与璀璨宝石碎光厚涂美学', 'in the style of WLOP, loose expressive painterly brushstrokes, sparkling jewel-like light highlights, ethereal beauty'],
    ['ask|ask画风|优雅冷艳色彩浓郁二次元', 'ASK式浓郁丝绒色彩与优雅华贵人物立绘风', 'in the style of Ask (Pixiv), rich velvety color saturation, refined porcelain skin, aristocratic elegance'],
    ['mika pikazo|高饱和绚丽撞色波普二次元', 'Mika Pikazo式极繁高饱和荧光撞色时尚插画风', 'in the style of Mika Pikazo, explosive kaleidoscope of vibrant neon colors, dynamic pop-fashion illustration'],
    ['米山舞|yoneyama mai|动态流体光效时尚眼妆', '米山舞式丝滑流体线条、梦幻反光与前卫眼妆美学', 'in the style of Yoneyama Mai, fluid kinetic motion lines, chromatic edge reflections, striking stylish eye makeup'],
    ['藤原|fuzichoco|藤ちょこ|极繁华丽透视奇幻背景', '藤原式繁复华丽大透视奇幻场景与清透色彩插画', 'in the style of Fuzichoco, intricate panoramic fantasy backgrounds, kaleidoscopic translucent colors, extreme depth'],
    ['redjuice|科幻机能金属暗调插画', 'redjuice式冷峻科幻机械质感与锐利数字光影风', 'in the style of redjuice, sleek sci-fi metallic textures, moody atmospheric lighting, sharp graphic details'],
    ['kantoku|监督|清透格子裙水润光斑二次元', '监督式清透大眼、格纹百褶裙与阳光光斑青春插画', 'in the style of Kantoku, sparkling expressive anime eyes, crisp plaid skirts, warm sunlit bokeh orbs'],
    ['深崎暮人|misaki kurehito|极致丝袜褶皱发丝光泽', '深崎暮人式超高精细度发丝高光与真实织物丝袜质感', 'in the style of Kurehito Misaki, hyper-detailed hair strand highlights, realistic sheer fabric and stocking gradients'],
    ['tiv|透明感水彩风少女漫画插画', 'Tiv式柔和透明感淡彩光影与细腻少女神态', 'in the style of Tiv, soft translucent pastel lighting, delicate emotional anime character rendering'],
    ['ciloranko|清透肉感柔光二次元插画', 'Ciloranko式柔焦奶油肤质与通透自然光感插画', 'in the style of Ciloranko, creamy soft skin shading, airy natural sunlight, charming lively posture'],
    ['nixeu|光泽感古典暗调女神厚涂', 'NIXEU式柔滑瓷感高光肌肤与神秘暗金华服美学', 'in the style of Nixeu, glossy porcelain skin highlights, seductive dark fantasy couture, moody studio light'],
    ['guweiz|古戈力|冷调灰暗电影感都市武侠厚涂', 'Guweiz式冷冽灰蓝电影感叙事光影与雨夜潇洒笔触', 'in the style of Guweiz, moody desaturated cool palette, cinematic narrative rim lighting, atmospheric rain and wind'],
    ['rossdraws|高饱和发光魔法色彩数字厚涂', 'RossDraws式绚烂色彩绽放与高对比发光魔法光效', 'in the style of RossDraws, vibrant color dodge glow, energetic painterly strokes, radiant magical lighting'],
    ['ilya kuvshinov|伊利亚|复古时尚胶片感大眼肖像', 'Ilya Kuvshinov式时尚短发、胶片颗粒与深邃五官特写', 'in the style of Ilya Kuvshinov, expressive large eyes, soft film grain, trendy modern street portrait'],
    ['望月けい|mochizuki kei|锐利平涂撞色亚文化张力风', '望月圭式凌厉粗细线稿、高反差纯色背景与亚文化酷感', 'in the style of Kei Mochizuki, bold graphic lineart, flat vibrant color contrast, edgy subculture attitude'],
    ['lam|高对比荧光霓虹锐利阴影波普风', 'LAM式高对比黑色硬阴影与电光霓虹波普涂鸦色彩', 'in the style of LAM, stark black graphic shadows, electric neon eye highlights, bold kinetic pop style'],
    ['百鬼夜行绘卷|天野喜孝|最终幻想飘逸线条金箔水彩', '天野喜孝式纤细飘逸曲线、迷幻水彩与金箔奇幻美学', 'in the style of Yoshitaka Amano, sinuous flowing ink lines, ethereal watercolor washes, gilded fantasy elegance'],
    ['竹久梦二|大正浪漫美人画风', '竹久梦二式忧郁修长身姿与复古大正浪漫木版画风', 'in the style of Takehisa Yumeji, Taisho Roman bijinga aesthetic, lyrical melancholic poise, vintage print texture'],
    ['早川式|丸尾末广|昭和猎奇复古歌谣耽美漫风', '昭和复古耽美怪谈漫画精致排线与戏剧光影美学', 'retro Showa avant-garde manga aesthetic, intricate vintage ink crosshatching, theatrical dramatic mood'],
    ['丰子恺|齐白石|张大千泼彩|徐悲鸿奔马|黄宾虹积墨', '张大千式气势磅礴的石青石绿泼墨泼彩山水意境', 'in the style of Zhang Daqian splashed-color ink painting, bold pools of mineral azurite blue and emerald green over ink'],
    ['萨金特|john singer sargent|潇洒写实油画笔触肖像', '萨金特式一气呵成的潇洒高光笔触与贵族丝绸油画质感', 'in the style of John Singer Sargent, bravura oil brushwork, effortless satin fabric sheen, aristocratic portrait'],
    ['莱顿|劳伦斯阿尔玛塔德玛|古罗马大理石阳光油画', '阿尔玛塔德玛式沐浴在地中海阳光下的半透明白色大理石油画', 'in the style of Lawrence Alma-Tadema, sunlit translucent white Carrara marble, Mediterranean azure sea, classical antiquity'],
    ['霍普|edward hopper|孤独都市午夜餐厅冷暖光油画', '爱德华霍普式静谧孤独的都市几何窗景与冷暖戏剧光线', 'in the style of Edward Hopper, poignant urban solitude, stark geometric window light contrasting warm interior and cool night'],
    ['怀斯|andrew wyeth|美国新写实主义荒原微风蛋彩画', '安德鲁怀斯式细腻凄美的荒草枯木与微风白纱窗蛋彩画', 'in the style of Andrew Wyeth, meticulous egg tempera texture, windswept dry grass, quiet melancholic realism'],
    ['莫比斯|moebius|让吉罗|法国科幻清晰墨线与粉彩荒原', '莫比斯式精密手绘钢笔点线与梦幻粉彩异星奇幻漫画风', 'in the style of Moebius (Jean Giraud), intricate ligne-claire ink linework, surreal pastel alien desert landscapes']
  ]),

  ...pack('主流二游与知名IP视觉审美体系', [
    ['原神风|提瓦特幻想渲染|卡通PBR金边服饰立绘', '原神式精致金边丝绸金属配饰与明亮幻想PBR三渲二画风', 'Genshin Impact official splash art style, ornate gold-filigree fantasy attire, vibrant anime cel-shaded PBR rendering'],
    ['崩坏星穹铁道|崩铁太空歌剧立绘|银河光影质感', '星穹铁道式华丽太空幻想机能礼服与电影级流光立绘', 'Honkai Star Rail official character splash art, sleek space-opera couture, dynamic cosmic lighting and particles'],
    ['绝区零|ZZZ|复古街头潮酷机能故障涂鸦风', '绝区零式千禧街头潮酷机能穿搭、夸张动态透视与荧光色块', 'Zenless Zone Zero urban street-pop anime aesthetic, chunky techwear sneakers, CRT retro vibe, bold kinetic pose'],
    ['明日方舟|冷峻废土机能风立绘|灰黑战术交错光影', '明日方舟式冷淡高级灰黑机能战术装束与守护灵背景立绘', 'Arknights elite E2 promotion splash art, muted tactical techwear coat, stark atmospheric chiaroscuro, symbolic aura'],
    ['重返未来1999|复古英伦神秘学油画感厚涂立绘', '重返未来1999式复古摩登年代质感、细腻半厚涂与神秘学构图', 'Reverse 1999 vintage occult art style, refined semi-impasto painterly texture, 20th-century retro fashion elegance'],
    ['碧蓝航线|精细舰装机械与华丽礼服肌肤质感', '碧蓝航线式极致柔腻肌肤光影与精密钢铁舰装反差立绘', 'Azur Lane L2D illustration quality, luminous soft skin rendering, intricate naval rigging or luxurious evening dress'],
    ['胜利女神妮姬|NIKKE|未来战术枪械与动态射击背影', 'NIKKE式精致科幻紧身战术装备与高张力实感材质渲染', 'Goddess of Victory NIKKE illustration style, glossy tactical combat suit, detailed sci-fi firearm, high-impact lighting'],
    ['赛马娘|青春元气偶像舞台与赛场奔跑风', '赛马娘式马耳马尾青春元气决胜服与阳光草地疾驰动态', 'Uma Musume Pretty Derby anime style, perked horse ears and flowing tail, ornate stage racing uniform, bright turf sunlight'],
    ['蔚蓝档案|碧蓝档案|青春学园清透浅蓝空气感', '蔚蓝档案式清澈高明度蓝白学园制服、头顶光环与清爽日常感', 'Blue Archive official art style, airy pastel cyan-and-white palette, floating halo, clean crisp cel shading'],
    ['孤独摇滚|电锯人藤本树电影感分镜|咒术回战MAPPA风', 'MAPPA剧场版式冷冽电影宽银幕色调、空气微尘与张力构图', 'MAPPA theatrical anime cinematography, cold cinematic color grading, realistic lens flare and shallow depth of field'],
    ['吉卜力宫崎骏|蓝天白云绿草地水粉手绘背景', '吉卜力工作室手工水粉画般的蓬松积雨云与翠绿夏日草坡', 'Studio Ghibli Hayao Miyazaki hand-painted poster color background, towering white cumulus clouds, lush windswept meadow'],
    ['新海诚|你的名字天气之子|超写实绚烂云海与紫金夕阳', '新海诚式极度璀璨的积雨云折射光晕、湿润沥青倒影与星空', 'Makoto Shinkai CoMix Wave Films aesthetic, hyper-detailed glowing twilight clouds, shimmering lens flare, emotional light']
  ]),

  ...pack('冷门摄影流派、特殊构图与视觉心理学', [
    ['时尚芭莎大片|高定棚拍|无线闪光灯硬光时尚摄影', 'Vogue高定时尚画报级利落硬光轮廓与冷峻高级感棚拍', 'Vogue haute couture studio editorial photography, crisp Profoto hard strobe light, avant-garde fashion styling'],
    ['水下婚纱摄影|深水悬浮失重纱裙飘舞', '清澈深水中失重舒展飘浮的层叠白纱与梦幻穿透光柱', 'ethereal underwater fashion photography, weightless billowing sheer white fabric, shafts of sunlight piercing blue water'],
    ['红外黑白摄影|白色树叶深黑天空超现实风光', 'Wood效应下树叶呈纯净雪白而天空呈深邃墨黑的红外超现实摄影', 'infrared black-and-white landscape photography (Wood effect), glowing snow-white foliage against dramatic pitch-black sky'],
    ['针孔相机|暗箱摄影|柔和边缘渐晕复古诗意感', '古典针孔相机长曝光特有的柔和梦幻焦点与深邃四周暗角', 'vintage pinhole camera photography, dreamy soft-focus edges, heavy natural vignette, timeless poetic mood'],
    ['宝丽来移膜|撕拉片显影边框|复古显影药水痕迹', '带有手工显影药水涂抹纹理边框的宝丽来撕拉片艺术', 'Polaroid peel-apart packfilm transfer art, organic chemical emulsion border streaks, rich nostalgic tones'],
    ['多重曝光重影|慢门摇头动态虚影|意识流心理摄影', '清晰眼神与半透明动态残影交叠的意识流慢门人像摄影', 'slow-shutter ghosting motion trail photography, sharp central gaze overlaid with translucent ethereal movement echoes'],
    ['微距水滴折射|花瓣上的水珠倒映完整世界', '一片花瓣尖端悬挂的晶莹露珠内部完整倒映出微缩花园美景', 'extreme macro photography of a single hanging dewdrop on a petal refracting a crisp inverted miniature landscape inside'],
    ['黄金分割构图|引导线构图|消失点透视构图', '利用长廊柱列与光影线条直指画面核心主体的强透视引导线构图', 'strong one-point linear perspective leading lines drawing viewer eye straight down an architectural corridor to subject'],
    ['剪影构图|框式剪影|明暗交界线构图', '处于高光与浓重阴影戏剧分界线边缘的极致张力构图', 'dramatic chiaroscuro split-lighting composition placing subject right along the razor edge of light and deep shadow'],
    ['极简色块构图|哈斯式彩色街头摄影|索尔雷特朦胧雨窗', '索尔雷特式透过挂满雨珠与雾气的玻璃窗窥见的浓郁红黄街头色块', 'Saul Leiter inspired street photography, shot through rain-misted window glass, layered reflections and vibrant red umbrella']
  ]),

  ...pack('中国古典器物、纹样与建筑构件细分词库', [
    ['博古架|多宝阁|红木雕花隔断|屏风|折扇屏风', '陈列着青瓷玉器与盆景的中式紫檀木雕花圆形多宝阁博古架', 'traditional Chinese carved rosewood circular Duobaoge curio shelf displaying celadon vases and bonsai'],
    ['藻井|敦煌飞天藻井|故宫蟠龙鎏金藻井穹顶', '仰视繁复华丽层层内收的古典木构彩绘鎏金蟠龙藻井穹顶', 'looking straight up at an intricate gilded Chinese caisson ceiling dome (Zaojing) with carved coiling dragon'],
    ['花窗|漏窗|冰裂纹木窗|海棠纹窗棂|满洲窗', '透过古雅江南园林冰裂纹雕花木窗漏入的斑驳竹影与天光', 'traditional Chinese lattice window with ice-crackle geometric woodwork casting intricate shadow patterns'],
    ['飞檐|走兽|嘲风|脊兽|铜铃风铎|滴水瓦当', '挂着青铜风铎铜铃的翘曲黛瓦飞檐与排列整齐的琉璃仙人走兽', 'upturned Chinese palace eaves adorned with glazed ceramic roof beasts and a hanging bronze wind bell'],
    ['青绿山水屏风|螺钿屏风|双面苏绣屏风|云母屏风', '半透明绘着青绿山水与金箔云纹的古典折扇式座屏', 'translucent silk folding screen painted with blue-and-green mountains and gold leaf clouds'],
    ['香炉|博山炉|鎏金铜香炉|瑞兽香薰|篆香青烟', '缕空雕花鎏金铜博山炉中袅袅升起如丝带般的檀香青烟', 'gilded bronze Boshan censer with wisps of fragrant sandalwood smoke curling upward through carved mountain peaks'],
    ['玉佩|双鱼玉佩|镂空龙凤白玉佩|禁步流苏', '系在腰间温润通透的羊脂白玉镂空雕花玉佩与丝绦流苏', 'translucent carved white jade waist pendant (yupei) hanging from silk braided cords and tassels'],
    ['团扇|缂丝团扇|湘妃竹骨漆柄宫扇', '手执绘有工笔花鸟纹样的半透明真丝缂丝圆月宫扇', 'round translucent kesi silk palace fan with spotted bamboo handle painted with delicate birds and blossoms'],
    ['灯笼|走马灯|琉璃宫灯|羊皮灯笼|鱼龙灯', '内置旋转剪纸烛火光影的八角雕花红木琉璃宫灯', 'octagonal carved wood-and-stained-glass Chinese palace lantern glowing with warm candlelight'],
    ['书案|文房四宝|端砚|徽墨|湖笔|宣纸卷轴|印章闲章', '铺开半卷水墨画轴与青玉笔架端砚的古典黄花梨木画案', 'classical huanghuali wood scholar desk laid with unrolled ink scroll, jade brush rest, and inkstone']
  ]),

  ...pack('西方古典纹章、奇幻炼金术与蒸汽机械细分词库', [
    ['星盘|天球仪|黄铜六分仪|占星罗盘', '镌刻黄道十二宫符文的精密多层旋转黄铜占星罗盘', 'intricate multi-ring rotating brass astrological astrolabe engraved with zodiac glyphs'],
    ['炼金术台|蒸馏烧瓶|衔尾蛇符号|贤者之石发光结晶', '摆满螺旋玻璃蒸馏器、发光药剂与羊皮手稿的炼金术士实验台', 'alchemist workbench crowded with coiled glass alembic flasks, glowing elixirs, and Ouroboros diagrams'],
    ['哥特铁艺|鸢尾花纹铁栅栏|石像鬼滴水兽|荆棘王座', '栖息在哥特尖塔边缘俯瞰雨夜城市的古老石雕滴水兽石像鬼', 'weathered stone gargoyle perched high on a Gothic cathedral ledge overlooking a rainy night city'],
    ['纹章|家族盾徽|狮鹫纹章旗帜|火漆封印', '绣有金线双头鹰与百合花盾徽的暗红丝绒骑士团挂旗', 'crimson velvet heraldic banner embroidered in gold bullion with a griffin coat of arms'],
    ['发条机械心|露背机械脊椎|黄铜义肢|辉光管显示', '散发温暖橘红灯丝光芒的复古苏联辉光管数字计时器与黄铜齿轮', 'vintage glass Nixie tubes glowing with warm orange neon filaments beside exposed brass clockwork gears'],
    ['水晶吊坠|灵摆|符文宝石|棱镜分光彩虹', '切割精密的透明水晶灵摆折射出一道绚丽光谱彩虹斑', 'faceted crystal pendulum prism splitting a beam of light into a vivid rainbow spectrum']
  ]),

  ...pack('全品类材质、表面光感与物理状态微距词库', [
    ['磨砂玻璃|水雾毛玻璃|压花海棠玻璃|长虹玻璃', '带着朦胧水汽与手指擦痕的半透明竖纹长虹压花玻璃后的人影', 'seen through fluted reeded privacy glass beaded with condensation, dreamy diffused silhouette'],
    ['丝绸光泽|珍珠缎面|流光醋酸面料|湿感丝缎', '如月光倾泻般顺滑流淌的珍珠白重磅真丝缎面光泽褶皱', 'fluid liquid-like drape of pearl-white heavy mulberry silk satin with soft specular highlights'],
    ['天鹅绒|丝绒吸光质感|暗红法兰绒', '浓郁深邃吞噬杂光仅在折角处泛出柔和银光的暗红天鹅绒', 'plush deep-burgundy silk velvet absorbing light with soft silvery sheen along folds'],
    ['透明PVC|果冻透明材质|彩色亚克力|幻彩镭射膜', '折射霓虹高光的半透明彩色果冻感PVC机能风衣材质', 'translucent holographic tinted vinyl PVC fabric with crisp colorful plastic reflections'],
    ['拉丝不锈钢|镜面铬合金|液态水银金属|鎏金铜', '完美反射周围一切环境的流淌态镜面液态纯银铬金属', 'mirror-polished liquid chrome metal with seamless high-contrast environmental reflections'],
    ['玉石包浆|冰种翡翠|羊脂白玉|玛瑙半透光|黑曜石', '内部带着天然絮状纹理温润透光的冰种翠绿翡翠与羊脂玉质感', 'translucent icy imperial green jadeite and creamy white nephrite jade with warm internal glow'],
    ['花瓣绒毛|蜜桃绒感肌肤|清晨露珠表面张力', '逆光下清晰可见细小金色绒毛的蜜桃般柔嫩肌肤质感', 'soft peach-fuzz vellus hair glowing delicately along cheek contour in warm backlight'],
    ['水波焦散|阳光泳池底蓝白网状水光纹', '清澈湛蓝水面折射投射在白瓷与肌肤上的灵动网状焦散水光', 'dazzling turquoise swimming pool water caustics dancing across white tiles and skin']
  ]),

  ...pack('日常动作、生活瞬间与情绪故事感补充', [
    ['晨起穿衣|刚睡醒揉眼睛|坐在床沿发呆|拉开窗帘迎着阳光', '清晨拉开白纱窗帘瞬间回眸沐浴在耀眼晨光中的一幕', 'pulling back sheer white curtains in the morning, looking back as warm golden sunlight floods the room'],
    ['雨天共撑一伞|伸手接雨滴|屋檐下避雨看雨丝', '站在古旧屋檐下伸出纤细手掌接住屋瓦滴落晶莹雨珠的瞬间', 'standing under eaves to shelter from rain, extending one hand to catch falling crystal raindrops'],
    ['戴耳机听歌|靠在公交车窗或列车窗边看风景发呆', '戴着耳机额头轻靠在挂着雨珠的列车车窗玻璃上静静望向窗外', 'wearing headphones and resting forehead gently against a rain-streaked train window, lost in thought'],
    ['看书翻页|趴在图书馆桌上午睡|阳光照在书页和发梢上', '伏在洒满午后阳光的木桌书本上安静小憩，微风轻拂书页与发丝', 'napping peacefully with head resting on open books on a sunlit wooden library desk, breeze turning pages'],
    ['喂猫|蹲在街角摸小猫下巴|怀抱熟睡猫咪', '温柔蹲在夕阳街角伸出指尖轻挠橘猫下巴的治愈瞬间', 'crouching in golden sunset alley, gently scratching the chin of a purring cat with a warm smile'],
    ['吹蜡烛|捧着生日蛋糕许愿|烛光映亮双眼', '昏暗房间里双手捧着插满燃烧蜡烛的蛋糕闭眼许愿，暖光映亮脸庞', 'holding a birthday cake with glowing candles in a dark room, eyes closed making a wish, warm face glow'],
    ['提灯夜行|手提纸灯笼走过石阶|回眸照亮来路', '夜色中手提一盏温暖发光的竹骨纸灯笼走上青苔石阶并驻足回望', 'walking up mossy stone steps at night holding a glowing paper lantern, pausing to look back'],
    ['弹钢琴|指尖跳跃在黑白琴键上|拉小提琴闭眼沉醉', '修长十指在三角钢琴黑白琴键上轻盈流淌，神情专注沉醉', 'slender fingers playing gracefully across grand piano keys, eyes closed in musical immersion']
  ])
]

fs.writeFileSync(path.join(lexiconDir, 'part14-artists-ips-details.json'), JSON.stringify(part14, null, 2), 'utf8')
console.log('Generated part 14:', part14.length)
