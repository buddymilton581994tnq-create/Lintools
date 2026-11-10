'use strict'
/**
 * 构建全领域 AI 绘画百科语料库（覆盖 20+ 大类，包含主流与极冷门专业词条）
 */
const fs = require('fs')
const path = require('path')

const lexiconDir = path.join(__dirname, 'lexicon')
fs.mkdirSync(lexiconDir, { recursive: true })

// 辅助快速构造词条：[主词/别名('|'分隔), 中文展示名, 英文精准提示词]
function pack(cat, rows) {
  return rows.map(([termsStr, label, en]) => ({
    cat,
    terms: termsStr.split('|').map((s) => s.trim()).filter(Boolean),
    label,
    en,
  }))
}

// ===========================================================================
// 卷二：中外古今服装、二次元穿搭、袜类鞋履、面料剪裁、配饰首饰
// ===========================================================================
const part2Fashion = [
  ...pack('二次元与流行服饰', [
    ['死库水|旧死库水|学校泳衣|连体学生泳衣|sukumizu', '旧式死库水', 'classic navy blue one-piece Japanese school swimsuit (old-style sukumizu), white piping trim, form-fitting'],
    ['新死库水|竞泳|竞技泳衣|鲨鱼皮泳衣', '竞技连体泳衣', 'sleek athletic racing one-piece swimsuit, glossy hydrophobic spandex, sporty splices, high-cut legs'],
    ['比基尼|三点式|系带泳装|细绳比基尼', '系带比基尼', 'string bikini swimsuit, delicate side-tie ribbons, summer beachwear'],
    ['荷叶边泳装|裙式泳衣', '荷叶边分体泳装', 'frilly ruffled two-piece bikini with cute sheer pareo wrap skirt'],
    ['逆兔女郎|反向兔女郎', '逆兔女郎装', 'reverse bunny suit, cropped collar and cuffs with detached sleek satin bodice, bunny ears headband'],
    ['兔女郎|赌场兔女郎', '经典缎面兔女郎', 'glossy black satin bunny girl leotard, stiff white collar with bow tie, French cuffs, rabbit ears headband, fluffy tail'],
    ['童贞杀手毛衣|露背高领毛衣', '露背高领针织毛衣', 'sleeveless ribbed turtleneck open-back sweater (virgin killer sweater), form-fitting knit'],
    ['开胸毛衣|爱心开胸毛衣|keyhole sweater', '胸口镂空高领毛衣', 'ribbed turtleneck sweater with heart-shaped keyhole chest cutout'],
    ['一字肩毛衣|露肩毛衣|慵懒毛衣', '宽松露肩粗针毛衣', 'oversized cable-knit off-shoulder sweater slipping down one shoulder'],
    ['男友衬衫|宽大白衬衫|oversize衬衫', '宽大男友白衬衫', 'oversized crisp white button-down shirt, top buttons undone, hem reaching mid-thigh'],
    ['水手服|关东襟|关西襟|名古屋襟|jk水手服', '日系JK水手服', 'classic Japanese JK sailor uniform (sera-fuku), navy collar with three white stripes, red silk scarf, box-pleated skirt'],
    ['西式制服|jk西装|学院制服|格纹百褶裙', '日系西式学院制服', 'Japanese high school blazer uniform, crested navy jacket, beige cardigan vest, tartan plaid pleated skirt, ribbon tie'],
    ['水色水手服|夏服水手服|短袖水手服', '夏季清透水手服', 'crisp white short-sleeve summer sailor uniform with pastel blue collar and sheer ribbon bow'],
    ['体操服|布鲁马|运动短裤|bloomers', '日式体操服布鲁马', 'Japanese school gym uniform, white raglan ringer tee with navy trim, classic tight navy athletic bloomers (buruma)'],
    ['排球服|田径服|运动背心短裤', '竞技田径服', 'sleek two-piece track and field athletic crop top and compression shorts'],
    ['哥特萝莉|gothic lolita|黑洛丽塔', '哥特洛丽塔洋装', 'elaborate Gothic Lolita bell-shaped JSK dress, black Chantilly lace tiers,corset lacing, bonnet headdress'],
    ['甜系洛丽塔|sweet lolita|甘ロリ', '甜系洛丽塔蓬蓬裙', 'Sweet Lolita puff-sleeve dress supported by petticoat, pastel strawberry and ribbon print, ruffled apron, tea-party shoes'],
    ['古典洛丽塔|classic lolita|クラロリ', '古典维多利亚洛丽塔', 'Classic Lolita Victorian tea-length dress, muted floral gobelin fabric, cameo brooch, Pintuck bodice'],
    ['中华风洛丽塔|华ロリ|qi lolita', '中华风盘扣洛丽塔', 'Qi Lolita fusion dress, mandarin collar with frog buttons, brocade jacquard puff skirt, tassel hair buns'],
    ['蒸汽朋克裙|齿轮束腰裙', '蒸汽朋克皮革束腰裙', 'steampunk Victorian corset outfit, distressed brown leather underbust corset, brass buckles, asymmetrical ruffled bustle skirt'],
    ['赛博机能风|techwear|机能冲锋衣', '暗黑机能战术穿搭', 'futuristic urban techwear outfit, waterproof hardshell cropped windbreaker, Fidlock magnetic straps, cargo joggers'],
    ['亚文化痛衣|印花卫衣|oversizeT恤', '宽松亚文化印花卫衣', 'oversized graphic print street hoodie, drop shoulders, layered striped long sleeves'],
    ['胶衣|乳胶衣|漆皮紧身衣|latex', '高反光乳胶紧身衣', 'skin-tight mirror-glossy black latex catsuit, sharp liquid-like specular highlights'],
    ['战斗紧身衣|驾驶服|plugsuit|eva驾驶服', '科幻机甲驾驶服', 'form-fitting sci-fi mecha pilot plugsuit, segmented armor panels at shoulders and ribs, glowing telemetry seams'],
    ['液体礼服|流光丝缎裙|吊带丝绸睡裙', '流光斜裁真丝吊带裙', 'bias-cut liquid silk charmeuse slip dress, shimmering specular drape clinging softly to silhouette'],
    ['OL制服|职业套裙|包臀裙|秘书装', '干练OL衬衫包臀裙', 'fitted white stretch dress shirt, high-waisted black pencil skirt, sleek stiletto heels'],
    ['瑜伽裤|鲨鱼裤|紧身运动裤|leggings', '高腰修身瑜伽裤', 'high-waisted seamless athletic compression leggings and cropped sports bra'],
    ['痛包|吧唧包|ita bag', '满章透明痛包', 'clear vinyl window ita-bag filled with colorful anime pin badges and ruffled ribbons'],
    ['女巫斗篷|连帽斗篷|暗黑披风', '丝绒连帽大斗篷', 'heavy velvet hooded cloak fastened with an ornate silver clasp at collarbone'],
    ['修道院礼服|圣职者长袍|神官服', '白金刺绣神官礼袍', 'white liturgical cleric vestments with intricate gold bullion embroidery and flowing stole'],
    ['湿身衬衫|半透明湿衣|淋透衣物', '雨水打湿半透白衣', 'rain-soaked translucent white fabric clinging subtly to skin, glistening water droplets']
  ]),

  ...pack('中国历代与东方传统服饰', [
    ['汉服|古装|仙侠裙', '飘逸传统汉服', 'traditional Chinese Hanfu attire, flowing layered silk robes, wide sweeping sleeves, embroidered belt sash'],
    ['齐胸襦裙|唐制汉服|盛唐襦裙|披帛', '盛唐齐胸襦裙披帛', 'Tang-dynasty high-waisted ruqun dress, sheer colorful silk organza shawl (pibo) floating around arms, peony embroidery'],
    ['坦领|唐制坦领半臂', '唐制U领坦领襦裙', 'Tang-dynasty U-neck tanling brocade half-sleeve top paired with high-waisted pleated silk skirt'],
    ['宋制汉服|褙子|宋制百迭裙|抹胸褙子', '宋制素雅长褙子', 'Song-dynasty straight-slit sheer silk beizi outer cardigan over embroidered moxiong and finely pleated baidie skirt'],
    ['明制汉服|马面裙|袄裙|立领对襟衫|织金马面', '明制立领袄配织金马面裙', 'Ming-dynasty stand-collar embroidered satin jacket with gold-woven brocade mamianqun (horse-face pleated skirt)'],
    ['飞鱼服|锦衣卫|曳撒|贴里', '明代锦衣卫织金飞鱼服', 'Ming-dynasty Jinyiwei crimson brocade Feiyu robe woven with gold flying-serpent dragon motifs, leather鸞带 belt,绣春刀'],
    ['圆领袍|唐制圆领袍|明制圆领官服', '暗纹提花圆领袍', 'traditional Chinese round-collar official robe (yuanlingpao) in damask silk,革带 leather belt'],
    ['魏晋风|交领广袖|大袖衫|曲裾|直裾', '魏晋交领广袖长衫', 'Wei-Jin style cross-collar wide-sleeve layered gauze robe, airy scholars elegance'],
    ['敦煌飞天|飞天仙女|西域舞乐服', '敦煌壁画飞天彩衣', 'Dunhuang Mogao mural apsara attire, swirling mineral-green and cinnabar silk ribbons, gold armlets, barefoot anklet bells'],
    ['苗疆服饰|苗族银饰|少数民族百鸟衣', '繁复苗族锻制银冠银衣', 'intricate Hmong Miao ethnic attire, towering hand-forged filigree silver horn headdress, layered silver neck rings, indigo embroidery'],
    ['旗袍|海派旗袍|高开叉旗袍|丝绒旗袍|cheongsam', '修身刺绣真丝旗袍', 'form-fitting traditional Shanghai silk cheongsam qipao, mandarin collar, floral knotted pankou buttons, high side slit'],
    ['新中式|改良旗袍|国潮穿搭', '现代新中式盘扣提花穿搭', 'modern Neo-Chinese couture, jacquard silk asymmetric top with frog buttons and sheer tulle trim'],
    ['秀禾服|凤冠霞帔|中式嫁衣|大红婚服', '金绣龙凤呈祥凤冠霞帔', 'resplendent crimson Chinese bridal robe embroidered with gold phoenixes, ornate pearl-and-kingfisher bridal crown'],
    ['和服|振袖|访问着|留袖|花魁和服', '华丽金彩振袖和服', 'luxurious Japanese long-sleeved furisode kimono, gold-leaf yuzen crane and sakura patterns, brocade maru obi sash'],
    ['夏日浴衣|花火浴衣|yukata', '夏日祭典棉麻浴衣', 'light cotton summer yukata kimono with morning glory pattern, tied with soft兵儿带 heko obi, holding uchiwa fan'],
    ['羽织|大正浪漫|女学生袴|矢絣袴', '大正浪漫矢絣纹行灯袴', 'Taisho Roman schoolgirl outfit, arrow-feather kasuri kimono top, maroon pleated hakama skirt, lace-up leather boots'],
    ['白无垢|色打挂|日式新娘和服', '纯白织锦白无垢嫁衣', 'pure white silk brocade Shiromuku bridal kimono with wataboshi hood, subtle crane weave'],
    ['韩服|赤古里裙', '清雅薄纱传统韩服', 'traditional Korean hanbok, sheer pastel organza jeogori jacket and voluminous chima skirt']
  ]),

  ...pack('西方历史礼服与甲胄军装', [
    ['维多利亚礼服|巴斯尔裙|克里诺林裙撑', '维多利亚蕾丝立领礼服', '19th-century Victorian bustle gown, high lace jabot collar, tailored pintuck bodice, draped taffeta overskirt'],
    ['洛可可礼服|玛丽皇后风|凡尔赛宫廷裙', '洛可可粉彩绸缎宫廷蓬裙', '18th-century French Rococo robe a la francaise, wide pannier skirt, pastel silk brocade, cascades of lace bows and rosebuds'],
    ['拜占庭礼服|镶嵌金丝长袍', '拜占庭紫金宝石皇室袍', 'opulent Byzantine imperial silk dalmatica robe encrusted with cabochon gems, pearls, and gold embroidery'],
    ['古希腊长裙|希顿|女神垂褶白袍', '古希腊湿褶亚麻女神袍', 'ancient Greek white pleated linen chiton and peplos, gold laurel leaf armlets, classical drapery'],
    ['古埃及服饰|黄金领饰|法老风', '古埃及青金石黄金纱裙', 'ancient Egyptian sheer white pleated linen gown, broad Wesekh collar of gold and lapis lazuli beads'],
    ['中世纪板甲|哥特式全身铠甲|米兰板甲', '哥特棱纹钢制全身板甲', '15th-century fluted Gothic steel full plate armor, articulated pauldrons and gauntlets, etched brass trim'],
    ['锁子甲|鳞甲|札甲|明光铠|山文甲', '唐代鎏金明光铠山文甲', 'Tang-dynasty gilded Ming-guang armor, interlocking mountain-pattern iron scales,护心镜 mirror chestplates, crimson tassel cloak'],
    ['日本大铠|具足|武士甲胄', '绯威大铠武士甲胄', 'traditional samurai O-yoroi lacquered lamellar armor laced with crimson silk威 cords, horned kabuto helmet'],
    ['军装礼服|轻骑兵军装|双排扣大衣|肩章绶带', '绶带肩章修身双排扣军礼服', 'aristocratic tailored double-breasted military dress uniform, gold bullion epaulets, aiguillette cords, peaked visor cap, riding boots'],
    ['风衣|战壕风衣|巴宝莉风衣', '经典卡其双排扣战壕风衣', 'classic belted double-breasted gabardine trench coat, storm flaps, popped collar'],
    ['婚纱|拖尾白纱|头纱新娘', '重工蕾丝长拖尾圣洁婚纱', 'cathedral-train ivory Chantilly lace and tulle ballgown wedding dress, sheer illusion cathedral veil']
  ]),

  ...pack('袜类、鞋履与首饰细节', [
    ['白丝|白色连裤袜|薄白丝', '轻薄透肤白色丝袜', 'sheer white nylon pantyhose clinging smoothly to legs, subtle pearlescent sheen'],
    ['黑丝|透肉黑丝|20D黑丝|超薄黑丝', '20D半透明透肤黑丝', 'ultra-sheer 20-denier black pantyhose, realistic nylon weave revealing subtle skin tone at knees and thighs'],
    ['厚黑丝|80D天鹅绒袜|不透肉黑袜', '哑光天鹅绒黑色连裤袜', 'opaque matte 80-denier black velvet tights'],
    ['肉丝|裸色丝袜|光腿神器', '微光泽裸色丝袜', 'ultra-sheer nude skin-tone pantyhose with delicate silky sheen'],
    ['油亮丝袜|马油袜|高光亮面丝袜', '高光泽油亮质感丝袜', 'high-gloss oil-shine sheer nylon stockings with bright specular leg highlights'],
    ['灰丝|咖啡丝|酒红丝袜', '高级烟灰半透丝袜', 'sheer charcoal-grey nylon tights'],
    ['吊带袜|蕾丝袜带|garter belt', '蕾丝花边吊带长筒袜', 'lace-welt thigh-high stockings held by satin garter belt straps and metal clips'],
    ['过膝袜|大腿袜|绝对领域', '过膝长袜与绝对领域', 'ribbed thigh-high stockings leaving an enticing gap of bare thigh beneath pleated skirt (zettai ryouiki)'],
    ['单边袜|不对称长短袜', '不对称单腿长袜配腿环', 'asymmetrical hosiery, one thigh-high stocking and one ankle sock with leather thigh garter ring'],
    ['渔网袜|网眼袜|破洞丝袜|战损黑丝', '微破损哥特网袜黑丝', 'distressed ripped sheer black tights layered with fine fishnet stockings'],
    ['泡泡袜|堆堆袜|ルーズソックス', '日系宽松白色泡泡袜', 'chunky white knitted Japanese loose slouch socks bunched around calves'],
    ['条纹袜|蓝白碗|蓝白条纹袜|粉白条纹袜', '粉白条纹过膝袜', 'pastel pink and white horizontal striped thigh-high socks'],
    ['足袋|分趾袜|木屐草履', '日式白足袋配漆木屐', 'crisp white split-toe tabi socks with lacquered wooden geta sandals'],
    ['玛丽珍鞋|圆头小皮鞋|厚底玛丽珍', '漆皮搭扣玛丽珍皮鞋', 'glossy black patent leather Mary Jane shoes with ankle strap and chunky platform heel'],
    ['乐福鞋|JK皮鞋|学院棕色皮鞋', '复古棕色学院乐福鞋', 'polished dark brown leather penny loafers'],
    ['红底高跟鞋|细跟尖头高跟鞋|stiletto', '尖头细高跟漆皮单鞋', 'sleek pointed-toe black patent stiletto high heels with crimson soles'],
    ['水晶高跟鞋|绑带凉鞋', '碎钻一字带细高跟凉鞋', 'strappy silver rhinestone ankle-strap high-heel sandals'],
    ['马丁靴|八孔军靴|厚底朋克靴', '金属扣厚底系带皮靴', 'chunky lace-up black leather combat boots with silver buckles'],
    ['过膝长靴|骑士靴|麂皮长筒靴', '修身麂皮过膝高筒靴', 'form-fitting black suede thigh-high heeled boots'],
    ['绣花鞋|云头履|翘头履', '珍珠苏绣云头锦履', 'traditional Chinese silk embroidered upturned-toe shoes with pearl trim'],
    ['项圈|choker|蕾丝颈链|铃铛项圈|皮质项圈', '黑色丝绒吊坠颈链', 'fitted black velvet choker necklace with delicate silver charm'],
    ['锁骨链|珍珠项链|多层金属链', '纤细碎钻锁骨链', 'dainty layered gold collarbone chain necklace'],
    ['眼镜|金丝眼镜|无框眼镜|半框眼镜|黑框眼镜|单片眼镜', '细金丝半框眼镜', 'delicate thin gold half-rim eyeglasses resting on nose bridge, subtle lens reflection'],
    ['猫耳耳机|头戴式耳机', '发光RGB猫耳头戴耳机', 'wireless over-ear headphones with glowing neon cat ears'],
    ['恶魔角发箍|女仆发带|荆棘王冠|花环|光环', '精致银丝水晶王冠', 'intricate silver filigree tiara set with moonstones']
  ]),

  ...pack('冷门面料与制版纺织工艺', [
    ['欧根纱|玻璃纱|幻彩硬纱|organza', '幻彩透明欧根纱', 'iridescent sheer silk organza fabric with crisp sculptural volume'],
    ['香云纱|莨纱|云锦|宋锦|蜀锦|缂丝', '非遗织金妆花云锦', 'imperial Nanjing Yunjin cloud brocade woven with peacock feather threads and real gold foil'],
    ['重磅真丝|桑蚕丝|素绉缎', '重磅桑蚕丝素绉缎', 'heavyweight mulberry silk crepeback satin with fluid lustrous drape'],
    ['尚蒂伊蕾丝|睫毛蕾丝|骨线蕾丝|水溶蕾丝', '法国尚蒂伊睫毛蕾丝', 'fine French Chantilly floral mesh lace with delicate eyelash scalloped edges'],
    ['粗花呢|小香风软呢|人字呢|tweed', '金葱编织粗花呢面料', 'boucle tweed woven with metallic lurex threads and frayed fringe trim'],
    ['丝绒|天鹅绒|烂花丝绒|丝光绒', '深邃暗纹压花丝绒', 'crushed burnout silk velvet with rich light-absorbing pile'],
    ['鎏金刺绣|盘金绣|法式珠绣|苏绣|湘绣', '高定法式亮片管珠刺绣', 'haute couture Luneville tambour beadwork with seed pearls, bugle beads, and gold bullion thread'],
    ['百褶|风琴褶|三宅一生褶皱|荷叶褶|抽褶', '细密渐变风琴百褶', 'knife-sharp accordion micro-pleated fabric'],
    ['鱼骨束腰|紧身胸衣|巴斯克腰线', '外穿刺绣鱼骨束胸衣', 'structured steel-boned brocade corset with satin ribbon back-lacing']
  ])
]

fs.writeFileSync(path.join(lexiconDir, 'part2-fashion.json'), JSON.stringify(part2Fashion, null, 2), 'utf8')
console.log('part2-fashion:', part2Fashion.length)
