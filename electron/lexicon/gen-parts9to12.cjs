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
// 卷九：视线、嘴型、手势、微动作、双人互动与人体微观细节原子词库
// ===========================================================================
const part9AnatomyMicro = [
  ...pack('视线与眼部微动态', [
    ['看向观众|直视镜头|眼神接触|与我对视', '直视镜头眼神交流', 'looking directly at viewer, engaging eye contact'],
    ['移开视线|看向别处|侧目不看镜头', '羞涩移开视线看向一旁', 'looking away to the side, averted gaze'],
    ['斜眼看|余光瞥视|暗中观察眼神', '眼角余光斜瞥镜头', 'sideways glance, looking from corner of eyes'],
    ['向上看|仰望眼神|抬头看天空', '微微仰首向上凝望', 'looking up wistfully, catchlights reflecting sky'],
    ['向下看|垂眸|低眉顺眼|俯视眼神', '长睫低垂静静向下看', 'downcast eyes, long eyelashes casting tiny shadows on cheeks'],
    ['闭眼|双目紧闭|安静合眼', '安静闭上双眼感受微风', 'eyes gently closed, serene peaceful expression'],
    ['半闭眼|迷蒙睡眼|慵懒半睁眼', '慵懒半阖睡意眼眸', 'half-closed sleepy eyes, languid relaxed eyelids'],
    ['单眼闭合|俏皮眨单眼|wink', '俏皮单眼Wink眨眼', 'cute one-eye wink, lively expression'],
    ['翻白眼|嫌弃白眼', '傲娇微翻白眼表情', 'rolling eyes playfully, annoyed cute look'],
    ['眼眶湿润|含泪欲泣|强忍泪水', '眼眶泛红蓄满晶莹泪水', ' glistening teary eyes, holding back tears, slightly reddened rims'],
    ['瞳孔收缩|震惊细瞳', '震惊瞬间瞳孔剧烈收缩', 'constricted tiny pupils in wide-open shocked eyes'],
    ['瞳孔放大|心动瞳孔|专注凝视瞳孔', '专注心动微扩大的清澈瞳孔', 'dilated expressive pupils filled with bright reflections'],
    ['眼神拉丝|深情凝望|含情脉脉', '温柔深情拉丝般凝视', 'affectionate lingering gaze, soft warm eye expression'],
    ['挑眉|单侧挑眉|疑惑皱眉', '灵动挑起单侧眉梢', 'one eyebrow inquisitively raised'],
    ['八字眉|委屈蹙眉', '委屈微微蹙起八字秀眉', 'worried slightly knitted eyebrows']
  ]),

  ...pack('嘴型与唇部微动作', [
    ['猫嘴|ω嘴|可爱三瓣嘴', '俏皮二次元ω型小猫嘴', 'cute cat-like :3 omega mouth shape'],
    ['波浪嘴|纠结嘴型', '呆萌纠结波浪线小嘴', 'cute squiggly wavy mouth expression'],
    ['微张嘴|唇齿微启|呼吸感红唇', '双唇微启隐约露出贝齿', 'slightly parted glossy lips showing a hint of white teeth'],
    ['抿嘴|紧抿双唇|浅抿微笑', '矜持温柔轻抿嘴角', 'gently closed lips pressed in a subtle serene smile'],
    ['咬手指|指尖抵唇|咬大拇指', '微羞轻咬纤细食指尖', 'delicately biting tip of index finger, coy gaze'],
    ['叼吐司|嘴叼面包奔跑', '嘴里叼着烤吐司匆忙赶路', 'holding a slice of toasted bread in mouth while rushing'],
    ['叼玫瑰|嘴衔红玫瑰', '唇间轻衔一枝带刺红玫瑰', 'holding a long-stemmed red rose stem between lips'],
    ['咬发圈|嘴叼皮筋扎头发', '双唇轻抿黑色发圈抬手束发', 'holding an elastic hairband between lips while tying hair up'],
    ['咬领带|拉扯领带', '轻咬或指尖勾拉松开的领带', 'tugging loosening necktie at collar'],
    ['舔嘴唇|舌尖轻舔唇角', '小巧舌尖轻掠水润唇角', 'tip of tongue subtly licking corner of glossy lips'],
    ['喝饮料|咬吸管|双手捧杯喝水', '双手捧杯轻咬吸管抬眼看', 'holding a drink with both hands, sipping through straw while looking up'],
    ['吹泡泡糖|粉红泡泡糖', '吹出半透明粉红泡泡糖圆泡', 'blowing a translucent pink bubblegum bubble'],
    ['哈白气|冬日呵出白雾', '寒冬微张小口呵出温暖白雾', 'exhaling a soft puff of warm white breath into freezing winter air']
  ]),

  ...pack('手部精细动作与互动', [
    ['十指相扣|双手交握祈祷', '胸前双手十指紧扣祈祷状', 'hands clasped together in front of chest, fingers intertwined'],
    ['双手托腮|捧脸杀|花朵捧脸', '双手轻捧脸颊手肘撑桌', 'resting both cheeks in cupped hands, elbows on table'],
    ['单手撑头|侧靠桌沿', '单手支颐慵懒斜倚桌面', 'propping head lazily on one palm'],
    ['遮阳手势|手搭凉棚望远', '抬起单手在额前遮挡阳光远眺', 'shielding eyes from bright sun with one raised hand while gazing afar'],
    ['撩裙摆|轻提裙角|风吹按裙子', '微风吹起裙角时双手轻按裙摆', 'hands lightly pressing down fluttering skirt hem in sudden breeze'],
    ['滑落肩带|轻勾肩带', '指尖轻勾从肩头滑落的细肩带', 'one thin dress strap slipping off bare shoulder, fingers lightly touching strap'],
    ['解扣子|轻解领口第一颗纽扣', '修长手指轻解衬衫领口第一颗扣子', 'slender fingers unbuttoning top collar button of shirt'],
    ['双手背在脑后|枕手仰躺', '双手交叉枕在脑后放松仰靠', 'both arms raised with hands laced behind head in relaxed pose'],
    ['背手身后|双手背在身后前倾', '双手背在身后身体微向前倾靠近镜头', 'hands clasped behind back while leaning torso playfully forward toward viewer'],
    ['双手插兜|单手插裤兜', '酷飒单手插进外套或长裤口袋', 'one hand tucked casually into pocket, relaxed cool stance'],
    ['抱胸|双臂环抱胸前', '双臂交叠环抱胸前气场十足', 'arms folded confidently across chest'],
    ['摸头杀|轻抚头发', '温柔大手轻抚角色柔软发顶', 'gentle hand patting head affectionately, soft happy reaction'],
    ['捏脸颊|轻戳脸蛋', '指尖轻轻戳向软嫩脸颊', 'index finger gently poking soft cheek'],
    ['牵手|向镜头伸手邀请', '向镜头前伸出纤细手掌发出邀请', 'extending an open slender hand toward viewer in warm invitation'],
    ['兰花指|古典舞手势|拈花指', '纤纤玉指轻捻花枝古典舞手势', 'graceful classical Chinese dance hand Mudra holding a blossoming twig'],
    ['拉小提琴手势|抚琴指法|握剑柄手势', '修长指节稳稳握住缠绳刀柄护手', 'defined slender fingers gripping wrapped sword hilt']
  ]),

  ...pack('身体微观魅力特征', [
    ['锁骨窝|精致锁骨阴影', '光影雕刻分明的精致一字锁骨', 'delicate collarbones with soft natural shadow hollow'],
    ['蝴蝶骨|优美露背肩胛骨|脊柱沟', '流畅优美的背部蝴蝶骨与脊柱曲线', 'graceful bare back showing delicate shoulder blades and subtle spinal groove'],
    ['腰窝|侧腰曲线|比基尼桥', '柔美收束的纤细侧腰弧线', 'slender cinched waist contour curving smoothly into hips'],
    ['后颈碎发|天鹅后颈|束发露颈', '高高束发露出白皙修长后颈与绒毛碎发', 'slender pale nape of neck with wispy baby hairs lit by backlight'],
    ['大腿勒痕|袜口微陷肉感|skindentation', '过膝袜松紧口在大腿留下的自然微陷肉感', 'subtle realistic skindentation where thigh-high stocking top hugs soft thigh'],
    ['膝盖微红|圆润膝盖骨与纤细脚踝', '细腻粉润的膝盖与纤巧脚踝骨感', 'delicate rosy knees and slender sculpted ankles'],
    ['水滴滑落|汗水顺脖颈滑落|晶莹香汗', '晶莹细汗珠顺着白皙脖颈与锁骨滑落', 'glistening beads of sweat trickling down slender neck and collarbone, glowing skin'],
    ['耳廓微红|透光小巧耳垂|精灵耳饰', '逆光下微微透红的小巧耳垂与银耳坠', 'delicate earlobes glowing warm pink in backlight with dainty silver drop earrings']
  ])
]

// ===========================================================================
// 卷十：传统节俗非遗、各国地标风物、复古怀旧室内外全场景词库
// ===========================================================================
const part10ScenesFolklore = [
  ...pack('中国传统节庆、二十四节气与民俗非遗场景', [
    ['上元灯会|元宵花灯街|长安不夜城夜市', '万盏锦鲤宫灯璀璨如昼的盛唐上元夜灯市长街', 'resplendent Tang-dynasty Lantern Festival night street, thousands of glowing silk fish and palace lanterns, bustling warm light'],
    ['打铁花|非遗火树银花|漫天铁水金花', '夜空中万点赤金铁水迸溅如星雨落下的非遗打铁花', 'traditional Chinese Datiehua molten iron fireworks, shower of dazzling golden sparks exploding like fiery willow trees at night'],
    ['泉州簪花围|蟳埔女花头饰', '头戴缤纷鲜花环绕大簪花围的闽南海风民俗造型', 'traditional Quanzhou Xunpu floral headdress (Zanhuawei), colorful Halo wreath of fresh roses, chrysanthemums, and magnolia buds in hair'],
    ['徽州鱼灯|瞻淇汪满田巨型鱼灯夜游', '古村落青石窄巷中蜿蜒游动的发光宣纸彩绘大鱼灯', 'glowing hand-painted giant Xuan-paper carp fish lanterns parading through misty Huizhou cobblestone alley at night'],
    ['傩戏|非遗彩绘木雕傩面具|英歌舞', '神秘古朴红黑描金传统非遗木雕傩戏面具', 'ancient ritual Chinese Nuo opera carved wooden mask painted in bold cinnabar red, ink black, and gold leaf'],
    ['清明烟雨|江南乌篷船|拱桥流水人家', '细雨如丝的江南水乡石拱桥与摇橹乌篷船', 'misty Jiangnan water town in spring drizzle, stone arch bridge reflecting in green canal, wooden black-canopy boat'],
    ['中秋满月|广寒宫桂花树|河灯祈福|放河灯', '一轮巨大琥珀圆月下流淌着万盏莲花河灯的静谧水面', 'hundreds of glowing lotus paper river lanterns floating down a dark tranquil stream beneath a giant golden full moon'],
    ['敦煌月牙泉|鸣沙山驼队|大漠孤烟落日圆', '金色沙丘连绵的敦煌鸣沙山与碧蓝新月绿洲落日', 'crescent turquoise oasis lake nestled among towering golden desert sand dunes at crimson sunset'],
    ['茶室|宋代点茶|围炉煮茶|紫砂茶席|焚香抚琴', '青烟袅袅升起的禅意木质茶席与插花挂画竹影', 'zen Chinese teahouse table, curling ribbon of sandalwood incense smoke, celadon teacup, bamboo shadow on shoji paper']
  ]),

  ...pack('日式风物、青春校园与怀旧生活空间', [
    ['夏日花火大会|夜空绚烂烟花|苹菓糖金鱼袋', '夏夜漫天绽放的绚丽大轮烟火映亮少女侧脸', 'dazzling giant summer hanabi fireworks blossoming across night sky, colorful sparks illuminating subject profile'],
    ['铁道道口|镰仓海边电车路口|黄黑栏杆铁轨', '阳光闪烁的镰仓蔚蓝大海背景与黄黑横杆电车平交道', 'Kamakura seaside railroad crossing, yellow-black barrier arm, green Enoden train passing in front of sparkling Pacific ocean'],
    ['自动贩卖机|深夜雨巷自动售货机冷光', '寂静雨夜街角散发清冷蓝白荧光的成排饮料自动贩卖机', 'row of glowing Japanese vending machines on a quiet wet asphalt street corner late at night, cool cyan light'],
    ['天台|学校屋顶铁丝网|放学黄昏天台', '夕阳染红云霞的放学后校园天台与高耸防坠铁丝网', 'high school rooftop at golden sunset, chain-link fence catching warm orange glow, sweeping city view below'],
    ['体育馆仓库|游泳池畔|音乐教室三角钢琴|美术室石膏像', '洒满午后斜阳与粉笔微尘的安静美术教室石膏像旁', 'quiet sunlit school art room, white plaster busts, wooden easels, dust motes dancing in afternoon window beams'],
    ['日式缘侧|风铃摇曳木走廊|盛夏西瓜蚊香', '挂着玻璃江户风铃俯瞰绿意庭院的日式木质缘侧长廊', 'traditional Japanese wooden engawa veranda in summer, hanging glass wind chime, lush sunlit garden greenery'],
    ['深夜便利店|24小时便利店暖白荧光灯', '深夜冷清街头透出明亮荧光灯暖意的24小时便利店玻璃窗前', 'bright fluorescent-lit 24-hour convenience store storefront glowing against dark rainy night street'],
    ['洗衣房|复古滚筒自助洗衣店|旋转滚筒暖光', '复古马卡龙色调深夜自助投币洗衣房成排圆形滚筒窗', 'retro pastel coin laundromat interior at night, rows of circular chrome washing machines, moody cinematic lighting'],
    ['水族馆|巨大深蓝水母缸剪影|海底观景窗', '巨大幽蓝水族馆落地观景窗前游过的蝠鲼鱼群与背光剪影', 'panoramic deep-blue aquarium viewing glass wall, schools of fish and manta rays gliding past in glowing turquoise water']
  ]),

  ...pack('世界各地标奇景与古典欧式场景', [
    ['圣托里尼|爱琴海蓝顶白墙悬崖小镇', '爱琴海澄澈阳光下纯白石灰阶梯与宝石蓝圆顶悬崖露台', 'sun-drenched Santorini cliffside terrace, crisp whitewashed walls, cobalt-blue domes overlooking sparkling Aegean Sea'],
    ['威尼斯水城|贡多拉叹息桥|面具狂欢节水巷', '晨雾笼罩的威尼斯古老拱桥水巷与黑色贡多拉木船', 'misty Venice canal at dawn, ornate Renaissance palazzos reflecting in emerald water, gondola moored at striped poles'],
    ['巴黎铁塔露台|奥斯曼建筑法式雕花阳台|塞纳河畔旧书摊', '铺着碎花桌布可远眺埃菲尔铁塔的法式铸铁雕花公寓阳台', 'Parisian Haussmann wrought-iron balcony with croissant breakfast table overlooking Eiffel Tower in soft morning haze'],
    ['哥特古堡卧室|四柱纱幔大床|壁炉熊熊火光', '挂着暗红丝绒帷幔的雕花四柱床与石砌壁炉火光古堡房间', 'ornate Gothic castle bedchamber, carved four-poster canopy bed with crimson velvet drapes, crackling stone fireplace'],
    ['歌剧院包厢|水晶大吊灯红丝绒金碧辉煌音乐厅', '悬挂巨型璀璨水晶枝形吊灯的巴洛克金箔红丝绒大歌剧院', 'opulent Baroque opera house auditorium, gilded balconies, plush crimson velvet seats, giant glowing crystal chandelier'],
    ['无人旋转木马|迷雾废弃游乐园|夜间发光摩天轮', '薄雾笼罩夜色中独自亮着暖黄彩灯的华丽复古旋转木马', 'illuminated vintage ornate carousel glowing warmly inside a misty deserted amusement park at night'],
    ['伦敦雾夜|贝克街煤气路灯鹅卵石街|大本钟雨夜', '维多利亚时代弥漫浓雾的湿滑鹅卵石街道与暖黄煤气街灯', 'foggy Victorian London cobblestone street at night, warm gaslight halos, hansom cab silhouette']
  ]),

  ...pack('科幻太空、奇幻地下城与超现实奇观空间', [
    ['太空电梯|环形太空城|星舰舰桥全息星图', '透过巨型弧面舷窗俯瞰蓝色地球弧线与日出的空间站观测舱', 'orbital space station cupola lounge looking down at glowing blue curvature of Earth and orbital sunrise'],
    ['义体诊所|赛博朋克地下改装手术室|机械臂工作台', '布满精密光学机械臂与全息扫描仪的霓虹地下赛博义体工坊', 'gritty cyberpunk ripperdoc clinic, articulated surgical robot arms, neon diagnostic monitors, hanging cables'],
    ['地下水晶洞穴|巨型紫水晶矿脉秘境', '生长着参天发光巨型紫水晶簇与地下暗河的奇幻地心溶洞', 'colossal subterranean cavern filled with towering glowing amethyst crystal formations reflecting in underground mirror lake'],
    ['深渊王座|骸骨荆棘王座|破碎神殿残垣', '伫立在无尽残破石柱神殿尽头的宏伟黑曜石高背孤寂王座', 'monumental obsidian gothic throne atop wide stone steps inside a ruined sunlit cathedral hall'],
    ['镜面花海|云端天梯|通往星空的白色阶梯', '从平静水面一直延伸进璀璨星云深处的纯白悬浮石阶天梯', 'surreal floating white marble staircase ascending from mirror water straight into vibrant starry Milky Way sky']
  ])
]

// ===========================================================================
// 卷十一：纸张画布基底、笔触刀法、暗房印相、色卡体系与画质修饰百科
// ===========================================================================
const part11MediaColorQuality = [
  ...pack('画布纸张基底与手工笔触肌理', [
    ['亚麻油画布|粗纹画布经纬肌理', '清晰可见粗纹亚麻油画布底纹与油彩厚度', 'visible coarse woven linen canvas texture underneath layered oil pigment'],
    ['阿诗水彩纸|300g冷压粗纹棉浆纸|水彩毛边纸', '凹凸手工棉浆水彩纸肌理与自然沉淀水痕', 'textured 300gsm cold-press cotton watercolor paper grain with natural pigment granulation'],
    ['撒金宣纸|仿古熟宣|宣纸纤维毛边', '泛着温润微黄包浆与细碎金箔点的古典手工宣纸肌理', 'aged ivory handmade Xuan rice paper speckled with tiny real gold leaf flakes'],
    ['羊皮纸|古旧泛黄卷轴|火烧焦边旧纸张', '边缘微卷带岁月污渍的古旧中世纪羊皮纸基底', 'weathered antique parchment vellum texture with deckled edges and subtle ink aging'],
    ['刮刀厚涂|调色刀堆塑立体笔触|impasto', '豪放立体的调色刀厚涂油彩刮痕与高光突起', 'sculptural palette-knife impasto paint ridges catching side light'],
    ['干笔飞白|枯笔焦墨擦痕', '苍劲有力的毛笔干擦飞白墨迹肌理', 'expressive dry-brush calligraphic feibai ink strokes showing raw bristle texture'],
    ['排线素描|钢笔交叉排线|炭笔涂抹木炭条肌理', '富有节奏感的古典钢笔交叉排线阴影与高光留白', 'rhythmic fine cross-hatching pen-and-ink shading on cream paper'],
    ['粉彩棒|油画棒肌理|莫奈色粉颗粒感', '浓郁柔和的软质色粉笔颗粒叠色肌理', 'velvety soft pastel chalk dust texture with rich layered color blending'],
    ['金箔贴金|银箔氧化肌理|沥粉堆金', '闪烁金属漫反射光泽的手工裂纹纯金箔贴面', 'hand-applied irregular gold leaf gilding with delicate metallic crackle sheen']
  ]),

  ...pack('精选大师配色方案与中国传统色卡', [
    ['故宫红墙金瓦色|朱砂配琉璃黄|中国红配鎏金', '庄重华贵的朱砂正红、明黄琉璃与墨黑描金宫廷配色', 'imperial Chinese color palette of cinnabar vermilion, glazed golden amber, and deep ink black'],
    ['宋代极简汝窑色|天青月白配竹青|东方清雅低饱和色', '温润清雅的宋瓷天青、月白、苍筤竹绿极简东方色卡', 'Song-dynasty minimalist palette of Ru-kiln celadon sky blue, moon white, and muted bamboo sage'],
    ['敦煌重彩配色|石青石绿配土红赭石泥金', '浓郁古朴的敦煌石青、孔雀绿、朱膘土红与泥金撞色', 'Dunhuang mural mineral palette combining lapis blue, malachite green, terracotta ochre, and aged gold'],
    ['莫兰迪色系|高级灰豆沙粉雾霾蓝燕麦色', '柔和静谧的低饱和度莫兰迪高级灰粉、雾霾蓝与暖燕麦色', 'muted Giorgio Morandi chalky pastel palette of dusty rose, slate blue, and warm oatmeal grey'],
    ['多巴胺配色|高饱和明快糖果撞色', '充满活力的高饱和柠檬黄、电光蓝与蜜桃粉多巴胺撞色', 'vibrant high-saturation dopamine color blocking in sunny yellow, cobalt blue, and hot coral pink'],
    ['美拉德色系|焦糖棕琥珀褐肉桂暖秋色', '醇厚温暖的焦糖棕、浓缩咖啡褐与暖金琥珀秋冬美拉德配色', 'rich Maillard autumn palette of roasted caramel brown, espresso, cinnamon, and warm amber'],
    ['薄荷曼波|清爽薄荷绿配奶油白嫩黄', '清新透气的春日薄荷绿、嫩芽绿与柔和奶油白配色', 'fresh Mint Mambo spring palette of airy pastel mint green, buttercream white, and pale lemon'],
    ['黑金奢华配色|黑曜石配流光香槟金', '深邃哑光黑曜石底色衬托璀璨流光香槟金高反差配色', 'opulent obsidian matte black contrasted with gleaming champagne gold highlights'],
    ['粉黑甜酷配色|地雷系黑粉撞色', '甜美樱花粉与酷感纯黑蕾丝高对比甜酷配色', 'sweet-edgy contrast color scheme of baby pastel pink and deep jet black'],
    ['水色亚文化色卡|冰川浅蓝配纯白银灰', '纯净透明感的冰川浅水蓝、纯白与冷银色亚文化配色', 'translucent mizuiro subculture palette of icy baby blue, crisp white, and cool silver'],
    ['黑红哥特配色|深渊黑配暗夜血红与冷银', '充满戏剧张力的深渊纯黑、丝绒暗血红与苍白冷月银配色', 'dramatic Gothic palette of abyssal black, deep crimson blood red, and pale moonlight silver']
  ]),

  ...pack('光学画质增强与渲染精度控制词（用户主动提及时使用）', [
    ['超清细节|8k分辨率|极致画质|大师之作|毫发毕现', '8K超精细微观纹理大师级画质', 'masterpiece, ultra-detailed 8k resolution, razor-sharp micro-textures, refined craftsmanship'],
    ['电影级调色|ACES色彩管理|宽容度胶片层次', '好莱坞电影级HDR光影层次与细腻暗部细节', 'cinematic HDR color grading, rich shadow latitude, smooth highlight roll-off'],
    ['景深虚化|奶油散景|大光圈光斑虚化', '焦点锐利背景化作柔和圆形奶油光斑浅景深', 'tack-sharp focus on subject with creamy circular aperture bokeh background'],
    ['动态模糊|速度感残影|快门拖影', '极具冲击力的运动轨迹动态模糊残影', 'kinetic motion blur streaks conveying high-speed movement while keeping focal face sharp'],
    ['色差边缘|轻微紫边色散镜头感|chromatic aberration', '真实光学镜头边缘细微迷幻RGB色散质感', 'subtle optical chromatic aberration along high-contrast edges for authentic anime/cinema lens feel'],
    ['暗角|胶片自然四周压暗聚焦中心', '柔和自然的光学镜头四周暗角突出画面视觉中心', 'gentle natural optical lens vignette drawing focus toward center']
  ])
]

fs.writeFileSync(path.join(lexiconDir, 'part9-anatomy-micro.json'), JSON.stringify(part9AnatomyMicro, null, 2), 'utf8')
fs.writeFileSync(path.join(lexiconDir, 'part10-scenes-folklore.json'), JSON.stringify(part10ScenesFolklore, null, 2), 'utf8')
fs.writeFileSync(path.join(lexiconDir, 'part11-media-color-quality.json'), JSON.stringify(part11MediaColorQuality, null, 2), 'utf8')

console.log('Generated parts 9-11:', part9AnatomyMicro.length + part10ScenesFolklore.length + part11MediaColorQuality.length)
