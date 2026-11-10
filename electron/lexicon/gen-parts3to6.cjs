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
// 卷三：发型设计、发色挑染、眼瞳微观、妆容美甲、表情与肢体动作库
// ===========================================================================
const part3HairFacePose = [
  ...pack('发型发饰', [
    ['黑长直|及腰黑长发', '柔顺及腰黑长直', 'long glossy jet-black straight hair reaching waist, silky hair strands'],
    ['公主切|姬发式|hime cut', '齐刘海姬发式公主切', 'traditional Japanese hime cut, blunt straight bangs, neat cheek-length sidelocks, long straight back hair'],
    ['双马尾|高双马尾|细双马尾|傲娇双马尾', '俏皮高扎双马尾', 'high twin tails tied symmetrically with ribbons, bouncy hair tips'],
    ['低双马尾|村姑辫|麻花双辫|双麻花辫', '温柔松散双麻花辫', 'loose low braided twin pigtails resting over shoulders'],
    ['螺旋双马尾|钻头卷|纵卷|大小姐卷发|drill hair', '华丽贵族螺旋钻头卷', 'voluminous ringlets twin drill curls (ojou-sama curls), bouncy corkscrew locks'],
    ['单马尾|高马尾|运动马尾', '利落高扎单马尾', 'energetic high ponytail swaying behind head, loose temple tendrils'],
    ['侧马尾|歪马尾', '俏皮不对称侧马尾', 'cute asymmetrical side ponytail resting over one shoulder'],
    ['波波头|妹妹头|齐耳短发|bob头|内扣短发', '内扣空气感波波头', 'chin-length inward-curled short bob haircut, airy Wispy bangs'],
    ['狼尾|鲻鱼头|层次感碎短发|wolf cut', '日系层次感狼尾碎发', 'trendy shaggy layered wolf-cut hair with textured feathered ends'],
    ['精灵短发|超短发|少年感短发|pixie cut', '清爽露耳精灵短发', 'cropped boyish pixie short haircut, neat nape, delicate exposed ears'],
    ['水母头|断层长短发|jellyfish hair', '亚文化双层水母头', 'avant-garde jellyfish haircut, rounded bob upper layer with two long flowing lower tentacles'],
    ['丸子头|团子头|花苞头|高盘丸子', '蓬松慵懒高丸子头', 'messy high hair bun with loose wispy strands framing neck'],
    ['双丸子头|哪吒头|包子头|中华娘发髻|odango', '中华风丝带双丸子头', 'double odango hair buns withsilk covers and dangling tassels'],
    ['羊角辫|环形辫|牛角包编发', '可爱环形羊角编发', 'braided looped twin buns on sides of head'],
    ['法式鱼骨辫|蝎子辫|瀑布辫|花环编发', '浪漫森系鱼骨花环编发', 'intricate French fishtail crown braid woven with tiny baby-breath flowers'],
    ['大波浪|法式慵懒卷|羊毛卷|蛋卷头|泡面头', '蓬松复古大波浪长卷发', 'voluminous cascading Hollywood wavy curls, glamorous soft shine'],
    ['湿发|微湿刘海|出浴湿发', '微湿成缕贴颊发丝', 'damp glossy hair strands clinging softly to forehead, cheeks, and collarbone'],
    ['呆毛|天线呆毛|爱心呆毛|ahoge', '灵动翘起单根呆毛', 'expressive curved ahoge cowlick strand bouncing atop head'],
    ['八字刘海|空气刘海|法式刘海|斜刘海|眉上刘海|二次元M字刘海', '轻盈微卷八字空气刘海', 'wispy see-through curtain bangs framing eyes'],
    ['遮眼发|单眼遮蔽|长刘海遮眼', '神秘单侧遮眼长刘海', 'long sweeping asymmetric bangs covering one eye'],
    ['飞仙髻|堕马髻|流云髻|惊鹄髻|高椎髻|双丫髻|垂挂髻', '古风步摇流云盘发髻', 'elaborate Tang-Song classical Chinese updo chignon adorned with gold-jade hairpins and pearl buyao'],
    ['日本岛田髻|文金高岛田|花魁发髻', '华丽玳瑁簪花魁高发髻', 'ornate Edo oiran datehyogo updo bristling with tortoiseshell kanzashi hairpins and tsumami-zaiku silk flowers'],
    ['脏辫|雷鬼辫|拳击辫|box braids', '酷飒金属环脏辫编发', 'tightly braided cornrows and dreadlock braids adorned with silver hair cuffs']
  ]),

  ...pack('发色与染发工艺', [
    ['银发|白发|月白发|铂金银发', '清冷月白银色发丝', 'luminous platinum silver-white hair catching cool rim light'],
    ['樱花粉发|浅粉发|草莓金发', '梦幻柔雾樱花粉发', 'pastel sakura pink hair with translucent backlit tips'],
    ['雾霾蓝发|冰蓝发|水色长发', '清透冰川水蓝发色', 'icy pastel cerulean blue hair'],
    ['薰衣草紫发|香芋紫发|银紫渐变发', '梦幻银紫渐变发色', 'ethereal lavender-violet gradient hair'],
    ['亚麻金发|香槟金发|蜂蜜金发', '耀眼蜂蜜香槟金发', 'sunlit champagne honey-blonde hair'],
    ['酒红发|暗红发|绯红长发', '浓郁绯红丝绒发色', 'deep crimson burgundy hair'],
    ['薄荷绿发|墨绿发|祖母绿发', '精灵感清透薄荷绿发', 'soft mint-emerald green hair'],
    ['挑染|挂耳染|内层挑染|裙摆染|渐变染|阴阳染|彩虹挑染', '个性双色内层挂耳染', 'two-tone peekaboo inner-layer hair dye (dark outer hair with vibrant contrasting inner streaks)'],
    ['星空发|流光发|半透明发光发梢', '半透明星屑发光发梢', 'luminescent translucent hair tips embedded with tiny glowing stardust particles']
  ]),

  ...pack('眼瞳、五官与妆容纹饰', [
    ['异色瞳|鸳鸯眼|金蓝异瞳|红蓝异瞳', '神秘金蓝双色异瞳', 'striking heterochromia eyes, one icy sapphire blue iris and one glowing amber gold iris'],
    ['竖瞳|猫眼竖瞳|龙瞳|蛇瞳', '凛冽宝石感细长竖瞳', 'slit vertical reptile/feline pupils inside jewel-like glowing irises'],
    ['爱心眼|心形高光瞳', '粉嫩心形高光瞳孔', 'glowing pink heart-shaped pupils and catchlights'],
    ['星星眼|星芒瞳|推子星瞳', '璀璨六芒星高光眼瞳', 'sparkling star-shaped catchlights inside vibrant detailed irises (idol starry eyes)'],
    ['圈圈眼|蚊香眼|晕头转向眼', '呆萌漩涡圈圈眼', 'dizzy spiral pupils, flustered cute expression'],
    ['高光消失|空洞眼神|死鱼眼|暗淡无光瞳', '失去高光的幽暗空洞眼神', 'empty lifeless dark eyes completely devoid of catchlights, eerie unsettling stare'],
    ['发光瞳|荧光眼|魔眼|轮回眼|机械电子瞳', '全息瞄准环机械发光瞳', 'cybernetic glowing iris with concentric HUD reticle rings'],
    ['下垂眼|狗狗眼|无辜垂眼|tareme', '温柔无辜狗狗下垂眼', 'soft droopy tareme puppy eyes, gentle approachable gaze'],
    ['吊梢眼|丹凤眼|狐狸眼|猫系挑眼|tsurime', '凌厉魅惑上挑狐狸眼', 'sharp upturned tsurime fox eyes with winged outer corners'],
    ['长睫毛|白睫毛|雪霜睫毛|太阳花睫毛', '覆雪般纤长银白眼睫', 'long frosty silver-white eyelashes catching soft light'],
    ['烟熏妆|哥特暗黑妆|小恶魔妆', '暗黑哥特浓重烟熏唇妆', 'dramatic dark charcoal smoky eye makeup paired with deep plum-black lipstick'],
    ['微醺妆|宿醉妆|晒伤妆|蜜桃腮红|眼下腮红', '日系微醺眼下绯红腮红', 'igari drunk-blush makeup, soft pink flush blended across cheeks and nose bridge'],
    ['清透伪素颜|水光肌|奶油肌|白开水妆', '清透水光伪素颜裸妆', 'dewy glass-skin no-makeup look, translucent skin glow, sheer nude-pink lip gloss'],
    ['唐代花钿|额间朱砂|梅花妆|面靥|斜红|金箔妆', '盛唐额间赤金牡丹花钿', 'classical Tang-dynasty crimson-and-gold floral huadian forehead mark, delicate dimple dots'],
    ['战损妆|擦伤|创可贴|鼻梁创可贴|血迹', '脸颊轻擦伤配可爱创可贴', 'subtle battle smudges on cheek with a cute adhesive bandage across nose bridge'],
    ['魔纹|淫纹|发光契约纹|诅咒纹身|图腾刺青|日式满背雕物', '发光魔力符文契约刺青', 'intricate glowing arcane filigree tattoo markings pulsing softly on skin'],
    ['美甲|痛甲|穿戴甲|法式美甲|猫眼美甲|黑色指甲', '精致碎钻延长水光美甲', 'long manicured almond nails with iridescent magnetic cat-eye gel and tiny rhinestones']
  ]),

  ...pack('表情神态与微表情', [
    ['微笑|浅笑|温柔笑|治愈笑容', '温柔弯眼治愈浅笑', 'warm gentle eye-smile, serene upturned lips'],
    ['开怀大笑|元气露齿笑|灿烂笑容', '明媚阳光元气灿笑', 'radiant carefree open-mouthed laugh, bright crinkled eyes'],
    ['坏笑|邪魅一笑|挑衅笑|歪嘴笑', '戏谑挑眉单侧坏笑', 'confident teasing smirk, one eyebrow slightly raised'],
    ['害羞|脸红|耳根通红|娇羞欲滴', '羞赧低眸脸颊绯红', 'flustered bashful blush spreading to ears, shyly averted gaze'],
    ['咬唇|轻咬下唇|忍耐表情', '欲言又止轻咬粉唇', 'gently biting lower lip, glistening wet lip highlight, emotional tension'],
    ['吐舌|略略略|俏皮鬼脸|wink眨眼', '单眼俏皮Wink吐舌', 'playful one-eye wink with tip of pink tongue sticking out'],
    ['鼓腮帮|生气嘟嘴|河豚脸|pout', '委屈鼓起包子脸嘟嘴', 'cute puffed-cheeks pouting expression, furrowed brows'],
    ['哭泣|落泪|泪眼婆娑|梨花带雨|眼角含泪', '晶莹泪珠滑落脸颊', 'glistening crystal teardrops welling up on lower lashes and rolling down cheek'],
    ['迷离|微醺眼神|动情神态|半阖眼|喘息雾气', '眼神迷离微张红唇', 'hazy half-lidded sultry eyes, flushed cheeks, slightly parted glossy lips, soft breath'],
    ['冷漠|厌世脸|高冷俯视|鄙夷眼神|看垃圾的眼神', '冰冷孤傲蔑视眼神', 'icy disdainful gaze looking down through half-closed lashes, chin slightly raised'],
    ['惊讶|瞳孔地震|捂嘴惊呼', '微微睁大双眸惊讶捂嘴', 'wide surprised eyes, hand delicately covering parted mouth']
  ]),

  ...pack('人体姿势、互动动态与手部特写', [
    ['站姿|S型曲线站姿|插腰站立|抱臂站立|背手站立', '优雅重心微偏S曲线站姿', 'graceful contrapposto standing pose, hands clasped gently behind back'],
    ['W坐姿|鸭子坐|萝莉坐|wariza', '地板乖巧W型鸭子坐', 'cute wariza W-sitting flat on floor, knees together and calves folded outward'],
    ['正坐|日式跪坐|seiza', '端庄塌塌米日式正坐', 'polite Japanese seiza kneeling posture on tatami, hands resting neatly on thighs'],
    ['抱膝坐|蜷缩坐姿|窗台坐姿', '静坐窗台双手抱膝', 'perched on a wide window ledge hugging knees to chest, chin resting on arms'],
    ['翘二郎腿|交叠双腿坐姿|女王坐姿', '高脚椅修长双腿交叠坐姿', 'seated gracefully with long legs crossed at thigh, dangling high-heel shoe'],
    ['侧卧|贵妃卧|趴在床上|托腮晃小腿', '俯卧床榻托腮晃动小腿', 'lying prone on stomach on soft bedsheets, propping chin in hands with lower legs playfully kicked up behind'],
    ['仰卧|躺在花海|躺在水中|发丝散开', '仰躺俯拍长发如扇铺散', 'lying flat on back viewed from above, long hair fanned out radially around head'],
    ['伸懒腰|高举双手|晨起慵懒', '双手高举舒展腰肢伸懒腰', 'stretching both arms high overhead upon waking, arched slender waist'],
    ['回眸|回头看镜头|背影回望', '侧身驻足越肩回眸', 'turning head over shoulder to look back at camera, hair and hem mid-swirl'],
    ['撩头发|扎马尾动作|咬发圈', '嘴角轻咬发圈双手束发', 'holding a hair tie between lips while both hands gather hair up into a ponytail, exposed nape and underarms'],
    ['提裙礼|优雅屈膝礼|curtsy', '双手轻提裙摆屈膝行礼', 'delicately pinching side hems of wide skirt in a graceful curtsy bow'],
    ['脱鞋|穿丝袜动作|提袜口', '坐姿弯腰指尖轻提丝袜蕾丝边', 'seated and leaning forward, fingertips delicately pulling up the lace top of a thigh-high stocking'],
    ['推眼镜|扶镜框', '指尖轻推鼻梁镜框反光', 'middle finger lightly adjusting bridge of glasses, cool lens glint'],
    ['比心|脸颊比心|双手比耶|猫爪手势|嘘手势', '食指抵唇轻做噤声手势', 'index finger pressed softly against lips in a secretive shushing gesture'],
    ['拔刀斩|居合斩姿势|拉弓射箭|施法手势|空中跃起', '凌空跃起拔刀一闪动态', 'dynamic mid-air leaping action pose, drawing katana blade with motion blur arc'],
    ['公主抱|壁咚|牵手回望|膝枕|背后拥抱', '温柔膝枕俯视互动', 'intimate lap-pillow perspective, subject looking down tenderly while stroking hair']
  ])
]

// ===========================================================================
// 卷四：美术史全流派、插画名家技法、非遗传统工艺、渲染引擎与数字视觉风格
// ===========================================================================
const part4ArtStyles = [
  ...pack('二次元与数字插画细分风格', [
    ['赛璐璐|平涂动漫|动画截图|TV番剧风', '清脆线稿赛璐璐平涂', 'clean anime cel shading, crisp uniform lineart, distinct shadow shapes, key animation frame'],
    ['伪厚涂|日韩半厚涂|轻小说插画风', '通透日系轻小说半厚涂', 'Japanese light novel cover illustration, delicate colored lineart with soft painterly volume rendering'],
    ['厚涂|无线稿厚涂|欧美概念原画|笔触厚涂', '重笔触戏剧光影概念厚涂', 'painterly lineless digital impasto concept art, bold expressive brushwork, rich edge control'],
    ['水彩插画|透明水彩|水痕晕染|儿童绘本风', '透明水彩湿画法纸纹晕染', 'transparent wet-on-wet watercolor on cold-press cotton paper, granulation texture, soft blooming edges'],
    ['马克笔手绘|彩铅手绘|素描速写|钢笔淡彩', '针管笔线稿配酒精马克笔手绘', 'Copic marker and fineliner ink sketchbook illustration, cross-hatching and vibrant marker blends'],
    ['黑白日漫|漫画分镜|网点纸|伊藤润二风|井上雄彦水墨漫画', '精细排线与黑白漫画网点纸', 'monochrome Japanese manga page aesthetic, G-pen dip ink dynamic lineweight, screentone halftone dots'],
    ['韩漫风|条漫全彩精致风', '精致唯美全彩韩漫立绘', 'polished Korean webtoon manhwa style, glamorous lighting, sharp jawlines, glossy fashion rendering'],
    ['美漫风|波普网点美漫|蜘蛛侠平行宇宙风', '美式波普网点动态漫画风', 'Into the Spider-Verse comic book aesthetic, Ben-Day halftone dots, bold ink outlines, chromatic offset'],
    ['碧蓝档案风|清透高明度二次元', '高明度清透空气感插画', 'bright high-key translucent anime style, soft pastel bloom, crisp clean UI-ready character art'],
    ['复古80年代动漫|90年代老番|昭和赛璐璐|高桥留美子|北条司', '90年代复古手绘赛璐璐胶片番', '1990s vintage hand-painted anime cel photographed on 35mm film, subtle VHS halation, nostalgic shadow tones'],
    ['Q版|二头身|粘土人|chibi|大头娃娃', '萌系二头身Q版立绘', 'super-deformed cute chibi character, 2-head body proportion, big glossy head, tiny stubby limbs'],
    ['立绘设定集|三视图|角色设计图|拆分设定图', '游戏角色正侧背三视图设定稿', 'character concept reference sheet, front/side/back turnaround views, expression callouts, clean neutral backdrop'],
    ['像素风|16bit像素|32bit精细像素|点阵图|等轴测像素', '精致复古点阵像素艺术', 'intricate 32-bit pixel art illustration, hand-placed pixel clusters, atmospheric dithering'],
    ['矢量扁平|孟菲斯插画|risograph孔版印刷', '复古错版Risograph孔版肌理插画', 'Risograph soy-ink print illustration, grainy stencil noise texture, vibrant fluorescent spot-color overprint']
  ]),

  ...pack('西方美术史与经典画派（含冷门流派）', [
    ['古典油画|文艺复兴|达芬奇晕涂法|拉斐尔', '文艺复兴古典罩染油画', 'High Renaissance oil painting on wood panel, Leonardo sfumato soft transitions, aged varnish craquelure'],
    ['巴洛克|卡拉瓦乔|暗色调主义|伦勃朗油画', '卡拉瓦乔戏剧明暗对照油画', 'Baroque tenebrism oil masterpiece, stark chiaroscuro spotlight emerging from pitch-dark background'],
    ['洛可可油画|弗拉戈纳尔|布歇', '洛可可轻盈粉彩宫廷油画', '18th-century French Rococo oil painting, feathery pastel brushwork, romantic garden elegance'],
    ['拉斐尔前派|沃特豪斯|米莱斯|奥菲莉娅风', '拉斐尔前派唯美自然主义油画', 'Pre-Raphaelite Brotherhood oil painting, jewel-bright pigments, hyper-detailed botanical flora and flowing auburn hair'],
    ['新艺术运动|穆夏|装饰花框|art nouveau', '穆夏新艺术运动曲线花卉画框', 'Alphonse Mucha Art Nouveau lithograph poster, sinuous whiplash curves, gilded botanical halo frame'],
    ['装饰艺术|art deco|流线型黑金几何|了不起的盖茨比风', '1920年代黑金几何装饰艺术风', '1920s Art Deco geometric luxury illustration, brushed gold leaf symmetry, obsidian and emerald chevrons'],
    ['印象派|莫奈|雷诺阿|外光派斑驳笔触', '莫奈印象派斑驳光色笔触油画', 'French Impressionist plein-air oil painting, broken dabs of pure vibrant color capturing shimmering light'],
    ['点彩派|修拉|色点并置', '新印象派光学密集点彩画法', 'Neo-Impressionist Pointillism painting composed entirely of tiny distinct dots of pure complementary pigment'],
    ['后印象派|梵高|旋涡厚涂星空笔触', '梵高表现主义旋转厚涂笔触', 'Post-Impressionist Vincent van Gogh style, swirling rhythmic impasto oil ridges in cobalt blue and chrome yellow'],
    ['象征主义|克里姆特|金箔镶嵌画风', '克里姆特拜占庭金箔几何装饰油画', 'Gustav Klimt Golden Phase painting, shimmering real gold leaf mosaic patterns, spiral and mosaic motifs'],
    ['新古典主义|学院派|布格罗细腻肤质', '布格罗学院派丝滑写实油画', 'William-Adolphe Bouguereau French Academic oil painting, porcelain-smooth lifelike flesh tones, invisible brushwork'],
    ['超现实主义|达利|马格利特|梦境悖论', '古典技法超现实梦境油画', 'Surrealist oil painting in the spirit of Rene Magritte and Salvador Dali, uncanny dreamlike juxtaposition'],
    ['表现主义|席勒神经质线条|蒙克呐喊风', '埃贡席勒表现主义张力速写设色', 'Egon Schiele Expressionist gouache and charcoal, raw angular contour lines, expressive anatomical distortion'],
    ['立体主义|毕加索多维几何解构', '立体主义多视角几何切面构图', 'Analytical Cubism painting, fragmented interlocking geometric planes viewed from multiple simultaneous angles'],
    ['至上主义|包豪斯|蒙德里安红黄蓝构成', '包豪斯现代主义几何构成', 'Bauhaus modernist geometric composition, primary colors, crisp constructivist typography and balance'],
    ['暗黑超现实|贝克辛斯基|吉格尔生物机械|biomechanical', '吉格尔异形生物机械暗黑画风', 'H.R. Giger airbrushed biomechanical dark surrealism, fused bone-and-steel ribbed conduits, monochromatic eerie mist'],
    ['厚刀油画|刮刀画|肌理画', '重体丙烯调色刀立体堆塑油画', 'heavy palette-knife impasto oil painting, sculpted 3D paint peaks casting tiny physical shadows']
  ]),

  ...pack('中国画、东方美学与世界非遗工艺（极冷门全覆盖）', [
    ['水墨画|写意水墨|泼墨山水|南宋马远夏圭留白', '传统宣纸泼墨写意山水', 'traditional Chinese xieyi splash-ink painting on absorbent xuan rice paper, poetic negative space, red cinnabar seal stamp'],
    ['工笔画|工笔重彩|绢本设色|宋院体花鸟', '宋代院体绢本工笔重彩设色', 'Song-dynasty court style gongbi meticulous painting on aged silk, hairline铁线描 ink outlines, layered mineral pigments'],
    ['青绿山水|千里江山图|石青石绿金碧山水', '北宋石青石绿描金青绿山水', ' monumental blue-and-green landscape (Qinglv Shanshui) painted with azurite blue, malachite green, and gold mud outlines'],
    ['白描|十八描|游丝描|敦煌线描', '吴道子式古典纯墨线白描', 'classical Chinese baimiao pure ink line drawing, fluid calligraphic brush pressure variations without color'],
    ['没骨画|恽寿平没骨花鸟', '清雅撞水撞粉没骨花卉画', 'traditional Chinese mogu boneless painting technique, direct washes of translucent color without ink outlines'],
    ['敦煌壁画|龟兹壁画|岩彩画|重彩岩彩|金箔岩彩', '斑驳剥落矿物颗粒敦煌岩彩壁画', 'ancient Dunhuang grotto mineral fresco (Nihonga / Yancai), coarse crushed lapis lazuli and cinnabar crystal grit, oxidized gold leaf, weathered plaster cracks'],
    ['漆画|大漆螺钿|黑金莳绘|剔红雕漆', '非遗黑推光大漆镶嵌幻彩螺钿', 'traditional Chinese glossy black urushi lacquerware inlaid with iridescent mother-of-pearl raden shell and gold maki-e powder'],
    ['掐丝珐琅|景泰蓝|鎏金错金银', '皇家铜胎掐丝珐琅景泰蓝纹样', 'imperial cloisonne enamelware, fine bent gold wire compartments filled with glossy turquoise and cobalt vitreous enamel'],
    ['剪纸|皮影戏|镂空刻纸光影', '传统民间透光彩色驴皮皮影艺术', 'traditional Chinese translucent dyed leather shadow puppetry, intricate openwork filigree backlit against warm screen'],
    ['版画|木刻版画|徽派版画|绝版木刻|铜版蚀刻画|丢勒铜版画', '古典精细交叉排线铜版蚀刻版画', 'Albrecht Durer style intaglio copperplate engraving, microscopic cross-hatched ink lines on ivory laid paper'],
    ['浮世绘|葛饰北斋|歌川广重|锦绘木版画', '江户浮世绘套色木版画肌理', 'Edo-period Japanese ukiyo-e polychrome woodblock print, bokashi hand-rubbed pigment gradation, visible woodgrain on washi paper'],
    ['波斯细密画|中世纪泥金装饰手抄本|凯尔特纹样', '中世纪羊皮纸泥金彩绘手抄本', 'medieval illuminated manuscript miniature on vellum, burnished gold leaf borders, ultramarine and vermilion tempera'],
    ['教堂彩绘玻璃|蒂凡尼彩色镶嵌玻璃|花窗艺术', '哥特教堂铅条镶嵌透光彩绘玻璃', 'backlit Gothic stained-glass rose window art, black lead came outlines, glowing ruby, cobalt, and amber glass segments'],
    ['拜占庭马赛克|碎瓷镶嵌画', '拜占庭金底琉璃马赛克拼贴', 'ancient Byzantine tesserae mosaic artwork, thousands of tiny hand-cut colored glass and gold-leaf tiles'],
    ['青花瓷|粉彩瓷|汝窑天青开片|冰裂纹釉', '元明钴料苏麻离青白地青花瓷绘', 'Ming-dynasty cobalt-blue underglaze Jingdezhen porcelain artistry, glossy translucent celadon crackle glaze'],
    ['蓝晒法|湿版火棉胶摄影|银版摄影|蛋白印相', '19世纪古典普鲁士蓝铁盐蓝晒印相', '19th-century cyanotype sun-print photography, deep Prussian blue monochrome tones with hand-coated brush edges'],
    ['羊毛毡|戳戳乐|衍纸艺术|立体纸雕灯|刺绣插画', '多层透光暖色立体纸雕灯箱', 'multi-layered laser-cut kirigami paper-cut lightbox diorama, warm internal LED depth shadows'],
    ['粘土定格|泥塑微缩|陶瓷公仔|软陶手作', '指纹肌理手工粘土定格动画风', 'stop-motion polymer claymation miniature, subtle artisan thumbprint textures, miniature studio lighting']
  ]),

  ...pack('3D渲染、故障艺术与互联网先锋美学', [
    ['虚幻引擎5|UE5|路径追踪|Octane渲染|Redshift渲染|Blender渲染', 'UE5影视级光线追踪PBR渲染', 'Unreal Engine 5 path-traced CGI render, physically based materials, Lumen global illumination, 8k micro-detail'],
    ['盲盒风|泡泡玛特风|潮玩PVC材质|搪胶公仔', '潮玩磨砂PVC半透光盲盒渲染', 'designer vinyl blind-box art toy 3D render, smooth matte PVC finish with soft subsurface scattering, studio softbox'],
    ['低多边形|low poly|PS1复古多边形|N64复古3D', 'PS1怀旧低多边形抖动贴图3D', 'retro 1998 PlayStation 1 low-poly 3D graphics, affine texture warping, crisp pixelated vertex lighting'],
    ['蒸汽波|vaporwave|石膏像棕榈树粉蓝网格', '千禧怀旧粉青霓虹蒸汽波拼贴', 'vaporwave aesthetic, magenta-cyan sunset grid, classical marble bust, palm trees, Windows 95 UI nostalgia'],
    ['梦核|dreamcore|怪核|weirdcore|阈限空间|liminal space|后室', '超现实怀旧千禧阈限梦核空间', 'dreamcore liminal space aesthetic, uncanny empty sunlit childhood hallway, low-res nostalgic haze, surreal quietude'],
    ['池核|poolcore|无尽白瓷泳池', '静谧日光折射无尽白砖泳池核', 'poolcore liminal architecture, vast silent indoor room of white ceramic tiles and crystal-clear turquoise water caustics'],
    ['赛博Y2K|千禧液态金属|酸性平面设计|acid graphics', '千禧Y2K液态铬金属酸性视觉', 'Y2K cyber-futurism, liquid chrome 3D typography, iridescent holographic foil,fisheye lens'],
    ['故障艺术|glitch art|像素排序|RGB色散错位|数据破损', '数字信号撕裂RGB错位故障艺术', 'datamosh digital glitch art, pixel sorting streaks, CRT scanlines, heavy RGB chromatic split'],
    ['热成像|红外摄影|X光透视艺术|紫外荧光摄影', '伪彩红外热成像光谱视觉', 'false-color infrared thermography aesthetic, glowing magenta-orange-violet heat gradient'],
    ['航拍微缩|移轴微缩景观|tilt-shift', '移轴镜头微缩模型玩具城市感', 'tilt-shift miniature faking photography, selective plane of focus making real world look like tiny scale model']
  ])
]

// ===========================================================================
// 卷五：摄影光学、镜头焦段、胶片型号、专业影视布光、色彩科学与构图法则
// ===========================================================================
const part5PhotoLight = [
  ...pack('专业相机、胶片型号与光学特效', [
    ['哈苏中画幅|大片幅相机|徕卡M|85mm人像镜皇', '哈苏中画幅85mm大光圈浅景深', 'shot on Hasselblad medium format digital, 85mm f/1.2 prime lens, razor-thin focal plane, creamy circular bokeh'],
    ['35mm人文镜头|50mm标头|街头抓拍纪实', '徕卡35mm街头纪实自然抓拍', 'candid street photography shot on Leica M 35mm f/1.4, authentic natural moment, subtle film halation'],
    ['14mm超广角|16mm广角透视|张力仰拍广角', '14mm超广角夸张空间透视冲击', 'ultra-wide 14mm lens perspective, dramatic spatial convergence, foreground close to lens'],
    ['鱼眼镜头|猫眼畸变|180度球面透视|fisheye', '复古圆周畸变鱼眼微距视角', '180-degree circular fisheye lens distortion, playful curved horizon, extreme close-to-camera nose/hand perspective'],
    ['200mm长焦|空间压缩感|70-200镜头', '200mm长焦镜头强烈空间背景压缩', '200mm f/2.8 telephoto lens compression, flattened background layers, dreamy isolated subject'],
    ['微距摄影|百微镜头|放大倍率微观细节', '100mm微距镜头毫发毕现微观细节', 'extreme macro lens photography, 1:1 magnification revealing microscopic water droplets and fiber textures'],
    ['变形宽银幕镜头|拉丝炫光|椭圆散景|anamorphic', '2.39:1电影变形宽银幕蓝条拉丝炫光', '2.39:1 widescreen cinema frame shot on Cooke anamorphic lens, oval bokeh, horizontal blue lens flare streak'],
    ['柯达Portra 400|富士胶片|富士Pro400H|清透日系胶片', '富士Pro400H清透青绿空气感胶片', 'Fuji Pro 400H 35mm color negative film stock, airy cyan-pastel greens, delicate organic grain, soft highlight roll-off'],
    ['电影感胶片|柯达Vision3 500T|王家卫抽帧色调|杜可风', '王家卫式钨丝灯迷离抽帧胶片感', 'Wong Kar-wai inspired Kodak Vision3 500T tungsten film aesthetic, step-printed motion trail, lush emerald and neon amber'],
    ['拍立得|宝丽来相纸|白边相纸|漏光暗角', '复古宝丽来SX-70化学显影拍立得', 'vintage Polaroid instant film aesthetic, creamy chemical color shift, soft vignette, light leak at frame edge'],
    ['湿版摄影|黑白银盐|伊尔福HP5高反差黑白胶片', '伊尔福高颗粒银盐黑白纪实胶片', 'Ilford HP5 Plus 400 black-and-white silver gelatin film, gritty authentic grain, deep blacks and glowing silver highlights'],
    ['CCD卡片机|千禧DV录像带|VHS磁带噪点', '千禧年代复古CCD机顶闪光直出', 'early-2000s compact CCD digital camera snapshot, harsh direct pop-up flash, warm nostalgic digital noise'],
    ['双重曝光|慢门长曝光|丝绢流水|星轨光绘', '剪影融合自然风景双重曝光', 'artistic in-camera double exposure blending a clean human profile silhouette with misty pine forest'],
    ['柔焦镜|黑柔滤镜|梦幻柔光雾感|bloom', '电影黑柔滤镜高光氤氲柔焦感', 'Tiffen Black Pro-Mist 1/4 filter diffusion, dreamy halation glow around highlights while keeping eyes sharp']
  ]),

  ...pack('影视级布光与自然大气光学', [
    ['伦勃朗光|三角光|油画侧面戏剧光', '经典45度侧面伦勃朗三角鼻影光', 'classic 45-degree Rembrandt key light forming an illuminated triangle on the shadow-side cheek'],
    ['蝴蝶光|派拉蒙光|美人光|环形眼神光', '好莱坞经典高机位美人蝴蝶光', 'glamour Paramount butterfly lighting from high front, sculpting cheekbones, crisp catchlights in eyes'],
    ['侧逆光|轮廓光|发丝发光|金边逆光|rim light', '强烈金色逆光勾勒透亮发丝边缘', 'strong warm rim backlighting igniting individual stray hair strands into a glowing halo'],
    ['分割光|阴阳脸布光|硬光高反差黑色电影光|film noir', '黑色电影百叶窗条纹硬光切割阴影', 'film noir hard chiaroscuro lighting, sharp Venetian blind slat shadows slicing across face and wall'],
    ['底光|恐怖幽暗顶底光|篝火映脸光', '低处暖色火光自下而上映亮面庞', 'upward warm firelight illumination from below, dramatic inverted shadows, floating embers'],
    ['丁达尔效应|体积光|耶稣光|神圣光柱|穿透树叶光斑', '空气微尘中清晰可见的丁达尔体积光束', 'dramatic volumetric Tyndall light shafts piercing dusty air, dappled komorebi leaf shadows'],
    ['焦散光影|水底波纹光斑|玻璃棱镜彩虹折射|caustics', '清澈水波投射在脸上的灵动焦散水光纹', 'shimmering underwater caustic light ripples dancing across skin and white walls, rainbow prism dispersion'],
    ['黄金时刻|夕阳暖金斜射光', '日落前黄金时刻琥珀色低角度暖阳', 'magic golden hour low-angle sunlight, long soft shadows, rich honey-amber warmth'],
    ['蓝调时刻|日落后静谧深蓝天光', '日落后蓝调时刻静谧深邃冷蓝漫射光', 'serene blue hour twilight ambient illumination balanced with warm distant interior window glow'],
    ['双色霓虹布光|赛博青红对撞打光|bisexual lighting', '冷青与品红双侧对撞霓虹光效', 'dual-tone cyberpunk gel lighting, cool electric cyan key light from left and hot magenta rim light from right'],
    ['生物发光|荧光森林蓝眼泪微光|bioluminescence', '幽暗环境中奇幻荧光植物蓝紫自发光', 'ethereal bioluminescent flora and glowing blue plankton casting magical cold points of light in darkness'],
    ['烛光|煤油灯|红灯笼暖光|屏幕蓝光', '摇曳红灯笼与烛火温暖点光源', 'warm intimate point-source glow from swaying red silk lanterns and tallow candles']
  ]),

  ...pack('构图法则與特殊机位', [
    ['黄金螺旋|斐波那契螺旋构图|三分法构图|对角线动态构图', '严谨黄金分割螺旋视觉引导构图', 'golden ratio Fibonacci spiral composition guiding viewer eye effortlessly to focal point'],
    ['中心对称|韦斯安德森强迫症对称美学', '韦斯安德森式糖果色绝对中心对称构图', 'Wes Anderson style deadpan symmetrical centered framing, pastel architectural geometry'],
    ['框中框构图|门窗窥视构图|前景遮挡偷拍感', '雕花门窗与虚化枝叶形成框中框景深', 'natural frame-within-a-frame composition seen through an ornate doorway and out-of-focus foreground foliage'],
    ['大留白|宋画极简负空间构图', '孤寂高级感大面积意境留白构图', 'poetic minimalist composition with 70% atmospheric negative space, tiny solitary subject'],
    ['荷兰角|倾斜机位|不安动感斜构图|dutch angle', '充满戏剧张力与速度感的倾斜荷兰角镜头', 'dynamic tilted Dutch angle camera roll, heightened kinetic tension and action energy'],
    ['极低机位|蚂蚁视角|贴地仰拍|虫视视角', '贴地极低机位仰拍高耸修长透视', 'dramatic worm-eye ground-level angle looking sharply upward against towering sky'],
    ['上帝视角|90度垂直俯拍|航拍平面构成|flat lay', '90度正上方垂直悬停上帝俯拍视角', '90-degree zenith overhead flat-lay bird-eye perspective'],
    ['越肩镜头|镜中反射构图|水面镜像构图|破碎镜面反射', '破碎镜面碎片多重反射人物眼神特写', 'shattered mirror reflection composition, multiple angled glass shards reflecting different facets of subject eyes'],
    ['第一人称POV|伸手向镜头|打破第四面墙互动', '角色向镜头伸出手的沉浸式第一人称POV', 'immersive first-person POV shot, character reaching one hand out toward camera lens with warm eye contact']
  ])
]

// ===========================================================================
// 卷六：建筑空间、奇幻秘境、自然地貌气象、科幻机甲军武、冷兵器道具、美食与微观材质
// ===========================================================================
const part6WorldPropsMaterials = [
  ...pack('东方古建、西式建筑与超现实秘境空间', [
    ['中式园林|苏州园林|太湖石月亮门|曲桥荷塘|徽派马头墙', '江南烟雨白墙黛瓦月亮门园林', 'classical Suzhou scholar garden in misty drizzle, circular moon gate framing bamboo, whitewashed Hui walls and black tiles'],
    ['故宫红墙|飞檐斗拱|琉璃瓦宫殿|仙界天宫|悬空寺', '云海之巅鎏金琉璃瓦飞檐仙宫', 'majestic celestial Chinese palace with upturned glazed golden roofs and intricate dougong brackets floating above sea of clouds'],
    ['日式神社|千本鸟居|枯山水庭院|缘侧木廊|汤屋温泉', '朱红千本鸟居与青苔石灯笼秘境参道', 'tunnel of vermilion Torii gates winding up a misty cedar mountain, moss-covered stone lanterns'],
    ['哥特大教堂|飞扶壁尖拱|玫瑰花窗|修道院回廊', '高耸哥特肋架拱顶与彩色玫瑰花窗圣堂', 'soaring Gothic cathedral nave, pointed rib vaults, dusty sunbeams through stained-glass rose window'],
    ['欧式古典图书馆|通天旋转书架|霍格沃茨魔法学院风', '黄铜旋转梯通天橡木古典藏书阁', 'grand Baroque multi-story library, spiral wrought-iron staircase, thousands of leather-bound tomes, floating candles'],
    ['维多利亚温室花房|水晶宫玻璃花房', '铸铁穹顶阳光植物园玻璃温室花房', 'Victorian wrought-iron and glass conservatory overflowing with exotic orchids, ferns, and humid sunbeams'],
    ['赛博九龙城寨|密集霓虹贫民窟|空中全息立交桥', '赛博朋克密集层叠霓虹管道九龙城寨', 'hyper-dense cyberpunk Kowloon Walled City megastructure, tangled cables, dripping AC units, vertical neon kanji signs'],
    ['蒸汽朋克飞艇港|巨大发条钟楼内部', '巨型咬合黄铜齿轮与蒸汽管道钟楼内部', 'colossal steampunk clocktower interior, interlocking giant brass cogwheels, hissing copper steam pipes, sunbeams through clockface'],
    ['废土末日都市|植被吞噬摩天楼|生锈核电冷却塔|尼尔机械纪元风', '绿植藤蔓吞噬的寂静末日摩天楼废墟', 'post-apocalyptic overgrown metropolis ruins, sunken highway flooded with clear water, deer wandering among ivy-wrapped skyscrapers'],
    ['海底亚特兰蒂斯|深海玻璃海底隧道|水母宫殿', '发光水母环绕的深海大理石遗迹亚特兰蒂斯', 'sunken marble ruins of Atlantis on ocean floor, giant glowing jellyfish drifting past fluted columns, shafts of surface light'],
    ['无限镜屋|埃舍尔悖论楼梯|倒置重力天空之城', '埃舍尔超现实错视无尽旋转阶梯空间', 'M.C. Escher inspired impossible architecture, gravity-defying Relativity staircases looping in every direction'],
    ['昭和复古喫茶店|深夜食堂居酒屋|霓虹街机厅|复古唱片行', '暖黄皮沙发与奶油苏打昭和复古喫茶店', 'nostalgic Showa-era Japanese kissaten coffee shop, dark wood booths, stained-glass pendant lamps, melon cream soda on table'],
    ['少女卧室|电竞房|阁楼天窗画室|洒满阳光的教室', '摆满画架油彩与绿植的斜顶天窗阁楼画室', 'sun-drenched attic artist studio, slanted skylight, wooden easels, paint-splattered floorboards, jars of brushes']
  ]),

  ...pack('自然地貌、极端气象与宇宙奇观', [
    ['天空之镜|乌尤尼盐沼|完美水面镜像天空', '无边际如镜面般倒映云霞的盐湖天空之镜', 'Salar de Uyuni mirror salt flat, seamless horizon reflecting towering pastel sunset clouds and starry Milky Way'],
    ['极光|冰岛黑沙滩|蓝冰洞|冰川裂隙', '晶莹幽蓝千年冰川洞穴与漫天绿紫极光', 'translucent sapphire glacier ice cave opening onto an Icelandic black sand beach under swirling emerald aurora borealis'],
    ['火山喷发|熔岩流|黑曜石荒原|地狱火海', '暗夜崩裂赤红岩浆流淌的黑曜石火山口', 'erupting volcanic caldera at night, glowing rivers of molten orange magma cracking through black basalt crust, volcanic lightning'],
    ['荧光海滩|蓝眼泪海浪|星空银河海边', '璀璨银河拱桥下泛着幽蓝荧光浪花的海滩', 'nighttime shoreline with glowing electric-blue bioluminescent waves crashing under the galactic core of the Milky Way'],
    ['彼岸花海|曼珠沙华|薰衣草田|向日葵花海|蓝花楹大道', '幽暗薄雾中一望无际的血红彼岸花曼珠沙华海', 'endless field of crimson red spider lilies (higanbana) blooming in eerie twilight mist'],
    ['深秋银杏林|京都红枫古道|落樱吹雪河畔', '满地金黄落叶与阳光穿透的千年银杏大道', 'carpet of golden ginkgo leaves along an autumn avenue, sunlit yellow foliage drifting in crisp air'],
    ['超级单体风暴|龙卷风|球状闪电|积雨云砧状云海', '夕阳染金的巨型层叠超级单体风暴积雨云', 'colossal cumulonimbus supercell thunderhead cloud lit warm peach and violet at dusk over vast plains'],
    ['黑洞吸积盘|卡冈图雅|星云诞生柱|环绕行星环', '星际穿越式弯曲光环超巨型黑洞吸积盘', 'gargantuan relativistic black hole with blazing golden accretion disk gravitational lensing against deep space nebula']
  ]),

  ...pack('科幻机甲、枪械军武、冷兵器与奇幻法器', [
    ['巨型机甲|真实系机甲|高达风|液压机械关节|装甲外骨骼', '重工业做旧掉漆液压装甲巨型双足机甲', 'colossal weathered bipedal combat mecha in hangar bay, hydraulic pistons, reactive armor blocks, maintenance sparks'],
    ['外骨骼装甲|动力甲|科幻步兵装甲', '碳纤维流线型精密战术动力外骨骼装甲', 'sleek carbon-fiber powered exosuit with glowing servo actuators and helmet HUD'],
    ['太刀|日本刀|武士刀|妖刀村正|大太刀|居合刃纹', '寒光凛冽烧刃沸纹修长日本太刀', 'razor-sharp Japanese tachi katana blade displaying intricate wavy hamon temper line, silk-wrapped tsuka hilt'],
    ['唐横刀|绣春刀|汉剑|青铜越王剑|子母剑', '黑金错银装具百炼花纹钢直刃唐横刀', 'Damascus pattern-welded Tang Hengdao straight saber with gilded silver lotus scabbard fittings'],
    ['双手巨剑|大剑|圣剑|符文重剑|骑士长枪', '镌刻发光蓝色符文的哥特十字护手双手巨剑', 'engraved steel zweihander greatsword inlaid with glowing rune channels along the fuller'],
    ['死神镰刀|蔷薇缠绕大镰刀|锁链镰刀', '暗黑荆棘黑玫瑰缠绕的新月巨型死神镰刀', 'massive crescent-bladed gothic war scythe entwined with black thorny roses and iron chains'],
    ['魔法杖|星盘法杖|魔导书|炼金药水瓶|塔罗牌|水晶球', '悬浮旋转黄铜星盘与发光水晶核心魔法杖', 'ornate arcane staff crowned with floating concentric brass astrolabe rings and a levitating prism crystal'],
    ['折扇|团扇|油纸伞|红灯笼|古琴|琵琶|洞箫', '手绘水墨白鹤竹骨洒金宣纸折扇与青玉萧', 'hand-painted gold-flecked xuan paper folding fan with bamboo ribs paired with a translucent celadon jade flute'],
    ['战术突击步枪|反器材狙击枪|左轮手枪|双枪|赛博电磁步枪', '导轨满配全息瞄具消音战术卡宾枪', 'customized modular tactical rifle with holographic sight, suppressor, and laser PEQ box'],
    ['古董怀表|黄铜望远镜|提灯|煤油马灯|黑胶留声机', '镂空陀飞轮机芯古典金色链条怀表', 'open-face antique gold skeleton pocket watch revealing tiny spinning brass gears and chain']
  ]),

  ...pack('微观材质物理与诱人美食特写', [
    ['次表面散射|玉石透光感|花瓣透光|耳廓透光|SSS材质', '真实温润如凝脂白玉的次表面散射透光质感', 'realistic subsurface scattering (SSS), warm light diffusing translucently through ear tips, fingertips, and jade'],
    ['丝绒微距绒毛|羊绒织物纹理|亚麻粗布经纬线', '放大可见纤维光泽的高密织物微距纹理', 'tactile textile micro-texture showing individual woven threads, soft fuzz halo, and natural fabric drape'],
    ['水珠凝结|冰镇汽水瓶壁水雾|汗珠滑落锁骨', '晶莹剔透折射环境光的细密凝结水珠', 'glistening beads of condensation and tiny water droplets refracting surroundings on smooth surface'],
    ['拉丝大马士革钢|氧化铜绿|包浆木纹|锻造碳纤维|拉丝钛合金', '暗哑锻造碳纤维与阳极氧化烧蓝钛合金肌理', 'forged chopped carbon-fiber weave paired with heat-blued anodized titanium hardware'],
    ['碎裂瓷器|金缮修复|kintsugi|金粉裂纹', '金缮工艺纯金漆修补裂痕的古朴黑釉瓷器', 'Japanese Kintsugi ceramic art, broken stoneware seams mended with gleaming powdered gold lacquer'],
    ['全息镭射|五彩斑斓的黑|珍珠母贝幻彩|肥皂泡薄膜干涉', '随角度变幻虹彩光泽的薄膜干涉镭射材质', 'thin-film interference iridescence, holographic oil-slick rainbow sheen over dark obsidian surface'],
    ['日式拉面|流心溏心蛋|吉卜力美食|舒芙蕾松饼|草莓奶油蛋糕|威士忌冰球', '吉卜力式热气腾腾色泽诱人的治愈系美食特写', 'mouth-watering gourmet food close-up, rising translucent steam, glossy rich broth, glistening specular highlights']
  ])
]

fs.writeFileSync(path.join(lexiconDir, 'part3-hair-face-pose.json'), JSON.stringify(part3HairFacePose, null, 2), 'utf8')
fs.writeFileSync(path.join(lexiconDir, 'part4-art-styles.json'), JSON.stringify(part4ArtStyles, null, 2), 'utf8')
fs.writeFileSync(path.join(lexiconDir, 'part5-photo-light.json'), JSON.stringify(part5PhotoLight, null, 2), 'utf8')
fs.writeFileSync(path.join(lexiconDir, 'part6-world-props-materials.json'), JSON.stringify(part6WorldPropsMaterials, null, 2), 'utf8')

console.log('Generated parts 3-6:', part3HairFacePose.length + part4ArtStyles.length + part5PhotoLight.length + part6WorldPropsMaterials.length)
