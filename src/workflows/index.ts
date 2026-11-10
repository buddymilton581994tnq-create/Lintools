// ComfyUI 工作流模板库：覆盖生成 / 风格 / 修复 / 放大 / 特效 / 视频 / 训练七个阶段。
// 互斥规则：同阶段只能选一个（比如不能同时用两条底模生成线），不同阶段随意叠加，
// 执行时按阶段顺序串成流水线，上一阶段的图喂给下一阶段。
//
// 每条模板只用 ComfyUI 官方核心节点，不依赖任何第三方插件。
// 例外：训练阶段不拼节点图，交给主进程里的 sd-scripts 跑（见 electron/train.cjs）；
// 云端续绘不跑本地节点，直接把提示词交给第三方 API。

export type StageId = 'gen' | 'style' | 'fix' | 'upscale' | 'fx' | 'video' | 'train'

export interface StageMeta {
  id: StageId
  name: string
  /** 一句话说清这一阶段干什么 */
  why: string
}

export const STAGES: StageMeta[] = [
  { id: 'gen', name: '基础生成', why: '基于文本提示词或参考图像生成初始画面' },
  { id: 'style', name: '风格转换', why: '把画面整体换成另一种画风' },
  { id: 'fix', name: '细节修复', why: '针对面部、纹理进行局部重绘、降噪与细节增强' },
  { id: 'upscale', name: '高清放大', why: '放大分辨率并补细节' },
  { id: 'fx', name: '出片特效', why: '做旧、辉光等最终效果' },
  { id: 'video', name: '视频衍生', why: '把成品图变成短视频' },
  { id: 'train', name: '模型训练', why: '使用自定义图像数据集训练专属 LoRA 微调模型' },
]

export interface WfParams {
  prompt: string
  negative: string
  ckpt: string
  lora: string
  loraStrength: number
  controlnet: string
  controlImage: string
  upscaleModel: string
  unet: string
  clip1: string
  clip2: string
  vae: string
  width: number
  height: number
  steps: number
  cfg: number
  seed: number
  /** 上一阶段产物（或用户上传的参考图）在 ComfyUI input 目录里的文件名 */
  image: string
}

export interface WorkflowDef {
  id: string
  name: string
  stage: StageId
  desc: string
  /** 流畅运行的大致门槛 */
  needVram: number
  needRam: number
  /** 需要一张输入图：没有上游产物时得先传参考图 */
  needsImage?: boolean
  needsLora?: boolean
  needsControlnet?: boolean
  needsUpscaleModel?: boolean
  needsFlux?: boolean
  /** 走第三方绘图 API 出图，不在本地 ComfyUI 里跑 */
  viaApi?: boolean
  /** 走 LoRA 训练（主进程 + sd-scripts），不拼 ComfyUI 节点图 */
  trainer?: { resolution: number; note: string }
  build: (p: WfParams) => Record<string, unknown>
}

const NEG =
  'lowres, bad anatomy, bad hands, worst quality, low quality, watermark, text, jpeg artifacts, blurry'

const seedOf = (p: WfParams) => (p.seed >= 0 ? p.seed : Math.floor(Math.random() * 2 ** 32))
const neg = (p: WfParams) => p.negative.trim() || NEG

// ---------------------------------------------------------------------------
// 节点拼装小工具（节点号随意，能对上引用就行）
// ---------------------------------------------------------------------------

const ckptNode = (p: WfParams) => ({
  class_type: 'CheckpointLoaderSimple',
  inputs: { ckpt_name: p.ckpt },
})

const encode = (text: string, clipRef: [string, number]) => ({
  class_type: 'CLIPTextEncode',
  inputs: { text, clip: clipRef },
})

const sampler = (inputs: Record<string, unknown>) => ({
  class_type: 'KSampler',
  inputs: { sampler_name: 'euler', scheduler: 'normal', ...inputs },
})

const save = (imagesRef: [string, number], prefix = 'Lintools') => ({
  class_type: 'SaveImage',
  inputs: { filename_prefix: prefix, images: imagesRef },
})

/** 文生图骨架：ckpt → 正负词 → 采样 → 解码 → 存图。lora 可选串在中间。 */
function txt2imgGraph(p: WfParams, opts: { lora?: boolean } = {}) {
  const useLora = opts.lora && p.lora
  const modelRef: [string, number] = useLora ? ['10', 0] : ['4', 0]
  const clipRef: [string, number] = useLora ? ['10', 1] : ['4', 1]
  const g: Record<string, unknown> = {
    '3': sampler({
      seed: seedOf(p), steps: p.steps, cfg: p.cfg, denoise: 1,
      model: modelRef, positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
    }),
    '4': ckptNode(p),
    '5': { class_type: 'EmptyLatentImage', inputs: { width: p.width, height: p.height, batch_size: 1 } },
    '6': encode(p.prompt, clipRef),
    '7': encode(neg(p), clipRef),
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': save(['8', 0]),
  }
  if (useLora) {
    g['10'] = {
      class_type: 'LoraLoader',
      inputs: {
        lora_name: p.lora,
        strength_model: p.loraStrength,
        strength_clip: p.loraStrength,
        model: ['4', 0],
        clip: ['4', 1],
      },
    }
  }
  return g
}

/** 图生图骨架：输入图 → 编码 → 按 denoise 重绘。extraPrompt 会追加在提示词后面。 */
function img2imgGraph(p: WfParams, denoise: number, extraPrompt = '') {
  const prompt = extraPrompt ? `${p.prompt}, ${extraPrompt}` : p.prompt
  return {
    '3': sampler({
      seed: seedOf(p), steps: p.steps, cfg: p.cfg, denoise,
      model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['11', 0],
    }),
    '4': ckptNode(p),
    '6': encode(prompt, ['4', 1]),
    '7': encode(neg(p), ['4', 1]),
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': save(['8', 0]),
    '11': { class_type: 'VAEEncode', inputs: { pixels: ['12', 0], vae: ['4', 2] } },
    '12': { class_type: 'LoadImage', inputs: { image: p.image, upload: 'image' } },
  }
}

/** 居中遮罩重绘（修复类用）：SolidMask 全空 + MaskComposite 在中央加一块实心遮罩 */
function centerMaskInpaintGraph(p: WfParams, maskRatio: number, denoise: number, why = '') {
  void why
  const mw = Math.max(64, Math.round(p.width * maskRatio))
  const mh = Math.max(64, Math.round(p.height * maskRatio))
  return {
    '3': sampler({
      seed: seedOf(p), steps: p.steps, cfg: p.cfg, denoise,
      model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['11', 0],
    }),
    '4': ckptNode(p),
    '6': encode(p.prompt, ['4', 1]),
    '7': encode(neg(p), ['4', 1]),
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': save(['8', 0]),
    '11': {
      class_type: 'VAEEncodeForInpaint',
      inputs: { pixels: ['12', 0], vae: ['4', 2], mask: ['15', 0], grow_mask_by: 8 },
    },
    '12': { class_type: 'LoadImage', inputs: { image: p.image, upload: 'image' } },
    '13': { class_type: 'SolidMask', inputs: { value: 0, width: p.width, height: p.height } },
    '14': { class_type: 'SolidMask', inputs: { value: 1, width: mw, height: mh } },
    '15': {
      class_type: 'MaskComposite',
      inputs: {
        destination: ['13', 0], source: ['14', 0],
        x: Math.round((p.width - mw) / 2), y: Math.round((p.height - mh) / 2),
        operation: 'add',
      },
    },
  }
}

/** ControlNet 文生图：控制图需用户上传已处理好的线稿/深度/姿势图 */
function controlnetGraph(p: WfParams) {
  return {
    '3': sampler({
      seed: seedOf(p), steps: p.steps, cfg: p.cfg, denoise: 1,
      model: ['4', 0], positive: ['13', 0], negative: ['7', 0], latent_image: ['5', 0],
    }),
    '4': ckptNode(p),
    '5': { class_type: 'EmptyLatentImage', inputs: { width: p.width, height: p.height, batch_size: 1 } },
    '6': encode(p.prompt, ['4', 1]),
    '7': encode(neg(p), ['4', 1]),
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': save(['8', 0]),
    '11': { class_type: 'ControlNetLoader', inputs: { control_net_name: p.controlnet } },
    '12': { class_type: 'LoadImage', inputs: { image: p.controlImage || p.image, upload: 'image' } },
    '13': {
      class_type: 'ControlNetApply',
      inputs: { conditioning: ['6', 0], control_net: ['11', 0], image: ['12', 0], strength: 0.9 },
    },
  }
}

// ---------------------------------------------------------------------------
// 34 条工作流
// ---------------------------------------------------------------------------

export const WORKFLOWS: WorkflowDef[] = [
  // ---- 基础生成（互斥）----
  {
    id: 'api-cloud', name: '官方 API（可选）：', stage: 'gen',
    desc: '把参考图和提示词交给云端接口出图，同一条流水线里能接 VAE / LoRA 参数，不吃本地显存',
    needVram: 0, needRam: 4, viaApi: true,
    build: () => ({}),
  },
  {
    id: 'sd15-txt2img', name: 'SD1.5 快速出图', stage: 'gen',
    desc: '轻量级文生图工作流，生成速度快，适合快速验证构图草稿', needVram: 4, needRam: 8,
    build: (p) => txt2imgGraph(p),
  },
  {
    id: 'sdxl-txt2img', name: 'SDXL 高清出图', stage: 'gen',
    desc: '高分辨率文生图工作流，构图与细节表现优异，建议分辨率自 1024 起步', needVram: 8, needRam: 16,
    build: (p) => txt2imgGraph(p),
  },
  {
    id: 'flux-txt2img', name: 'Flux 高质量出图', stage: 'gen',
    desc: '旗舰级高画质文生图工作流，需配备 UNET 主模型与双 CLIP 文本编码器组件', needVram: 12, needRam: 16, needsFlux: true,
    build: (p) => ({
      '6': encode(p.prompt, ['11', 0]),
      '8': { class_type: 'VAEDecode', inputs: { samples: ['16', 0], vae: ['18', 0] } },
      '9': save(['8', 0]),
      '10': { class_type: 'UNETLoader', inputs: { unet_name: p.unet, weight_dtype: 'default' } },
      '11': { class_type: 'DualCLIPLoader', inputs: { clip_name1: p.clip1, clip_name2: p.clip2, type: 'flux' } },
      '12': { class_type: 'EmptySD3LatentImage', inputs: { width: p.width, height: p.height, batch_size: 1 } },
      '13': { class_type: 'BasicGuider', inputs: { model: ['10', 0], conditioning: ['6', 0] } },
      '14': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
      '15': { class_type: 'BasicScheduler', inputs: { model: ['10', 0], scheduler: 'simple', steps: p.steps, denoise: 1 } },
      '16': {
        class_type: 'SamplerCustomAdvanced',
        inputs: { noise: ['17', 0], guider: ['13', 0], sampler: ['14', 0], sigmas: ['15', 0], latent_image: ['12', 0] },
      },
      '17': { class_type: 'RandomNoise', inputs: { noise_seed: seedOf(p) } },
      '18': { class_type: 'VAELoader', inputs: { vae_name: p.vae || 'ae.safetensors' } },
    }),
  },
  {
    id: 'sd15-img2img', name: 'SD1.5 图生图变体', stage: 'gen',
    desc: '基于参考图像进行中等幅度的重绘与变体生成', needVram: 4, needRam: 8, needsImage: true,
    build: (p) => img2imgGraph(p, 0.55),
  },
  {
    id: 'sdxl-img2img', name: 'SDXL 图生图重绘', stage: 'gen',
    desc: '参考图打底，细节重绘更干净', needVram: 8, needRam: 16, needsImage: true,
    build: (p) => img2imgGraph(p, 0.55),
  },
  {
    id: 'sd15-inpaint', name: '中央区域重绘 (SD1.5)', stage: 'gen',
    desc: '仅对画面中央主体区域进行重绘，四周环境保持不变', needVram: 4, needRam: 8, needsImage: true,
    build: (p) => centerMaskInpaintGraph(p, 0.5, 0.9),
  },
  {
    id: 'sdxl-inpaint', name: '中央区域重绘 (SDXL)', stage: 'gen',
    desc: '同上，底模换 SDXL，重绘质量更高', needVram: 8, needRam: 16, needsImage: true,
    build: (p) => centerMaskInpaintGraph(p, 0.5, 0.9),
  },
  {
    id: 'sd15-lora', name: 'LoRA 风格生成 (SD1.5)', stage: 'gen',
    desc: '文生图叠加一个 LoRA，强度可调', needVram: 4, needRam: 8, needsLora: true,
    build: (p) => txt2imgGraph(p, { lora: true }),
  },
  {
    id: 'sdxl-lora', name: 'LoRA 风格生成 (SDXL)', stage: 'gen',
    desc: 'SDXL 底模叠加 LoRA', needVram: 8, needRam: 16, needsLora: true,
    build: (p) => txt2imgGraph(p, { lora: true }),
  },
  {
    id: 'cn-line', name: 'ControlNet 线稿控制', stage: 'gen',
    desc: '按你给的线稿图出图，需上传处理好的线稿', needVram: 6, needRam: 8, needsControlnet: true, needsImage: true,
    build: (p) => controlnetGraph(p),
  },
  {
    id: 'cn-depth', name: 'ControlNet 深度控制', stage: 'gen',
    desc: '按深度图的空间关系出图', needVram: 6, needRam: 8, needsControlnet: true, needsImage: true,
    build: (p) => controlnetGraph(p),
  },
  {
    id: 'cn-pose', name: 'ControlNet 姿势控制', stage: 'gen',
    desc: '按骨架姿势图摆动作', needVram: 6, needRam: 8, needsControlnet: true, needsImage: true,
    build: (p) => controlnetGraph(p),
  },
  {
    id: 'cn-scribble', name: '涂鸦草稿控制', stage: 'gen',
    desc: '随手画个草稿当控制图，AI 照着构图画出成品', needVram: 6, needRam: 8, needsControlnet: true, needsImage: true,
    build: (p) => controlnetGraph(p),
  },

  // ---- 风格转换（互斥，图生图中高强度重绘）----
  {
    id: 'to-anime', name: '转日系动漫风', stage: 'style',
    desc: '将实拍照片或草图转换为干净利落的日系动漫插画风格', needVram: 6, needRam: 8, needsImage: true,
    build: (p) => img2imgGraph(p, 0.6, 'anime style illustration, clean cel shading, vibrant colors, crisp lineart'),
  },
  {
    id: 'to-real', name: '转写实照片风', stage: 'style',
    desc: '插画转实拍质感', needVram: 6, needRam: 8, needsImage: true,
    build: (p) => img2imgGraph(p, 0.6, 'photorealistic, ultra detailed RAW photo, natural lighting, 85mm lens'),
  },
  {
    id: 'to-oil', name: '转古典油画风', stage: 'style',
    desc: '转换为富有厚涂肌理与笔触层次的古典油画风格', needVram: 6, needRam: 8, needsImage: true,
    build: (p) => img2imgGraph(p, 0.6, 'classical oil painting, visible impasto brushstrokes, canvas texture, museum quality'),
  },
  {
    id: 'to-watercolor', name: '转水彩手绘风', stage: 'style',
    desc: '清透水彩晕染', needVram: 6, needRam: 8, needsImage: true,
    build: (p) => img2imgGraph(p, 0.6, 'delicate watercolor painting, soft pigment bleed, cold-press paper texture'),
  },
  {
    id: 'to-pixel', name: '转像素游戏风', stage: 'style',
    desc: '复古像素画', needVram: 6, needRam: 8, needsImage: true,
    build: (p) => img2imgGraph(p, 0.65, 'pixel art, 16-bit retro game style, limited color palette, crisp pixels'),
  },
  {
    id: 'to-cyber', name: '转赛博霓虹风', stage: 'style',
    desc: '青品霓虹与雨夜反光', needVram: 6, needRam: 8, needsImage: true,
    build: (p) => img2imgGraph(p, 0.6, 'cyberpunk aesthetic, neon cyan and magenta lighting, rain-slicked reflections, high tech'),
  },
  {
    id: 'to-mono', name: '转黑白胶片风', stage: 'style',
    desc: '高反差黑白胶片', needVram: 6, needRam: 8, needsImage: true,
    build: (p) => img2imgGraph(p, 0.55, 'black and white film photography, high contrast, film grain, darkroom print'),
  },
  {
    id: 'to-lineart', name: '转线稿草图风', stage: 'style',
    desc: '只留铅笔线稿', needVram: 6, needRam: 8, needsImage: true,
    build: (p) => img2imgGraph(p, 0.65, 'monochrome pencil lineart sketch, clean outlines, white background, no shading'),
  },
  {
    id: 'to-ink', name: '转国风水墨', stage: 'style',
    desc: '宣纸晕染的水墨画，留白写意', needVram: 6, needRam: 8, needsImage: true,
    build: (p) => img2imgGraph(p, 0.6, 'traditional Chinese ink wash painting, sumi-e, rice paper texture, expressive brush strokes, elegant negative space'),
  },
  {
    id: 'to-3drender', name: '转 3D 渲染风', stage: 'style',
    desc: '变成精致的三维渲染图，皮克斯质感', needVram: 6, needRam: 8, needsImage: true,
    build: (p) => img2imgGraph(p, 0.6, 'high quality 3d render, octane render, soft studio lighting, subsurface scattering, pixar style'),
  },

  // ---- 细节修复（互斥，低强度重绘）----
  {
    id: 'face-center', name: '面部中心重绘修复', stage: 'fix',
    desc: '针对画面中央的面部区域进行五官精修，其余背景保持不变', needVram: 6, needRam: 8, needsImage: true,
    build: (p) => centerMaskInpaintGraph(p, 0.4, 0.5),
  },
  {
    id: 'detail-pass', name: '细节增强轻修复', stage: 'fix',
    desc: '通过低幅度潜空间重绘补充发丝、织物等微观细节', needVram: 6, needRam: 8, needsImage: true,
    build: (p) => img2imgGraph(p, 0.3, 'highly detailed, sharp focus, intricate textures'),
  },
  {
    id: 'smooth-denoise', name: '去噪柔和平滑', stage: 'fix',
    desc: '抹掉噪点和伪影，画面变干净', needVram: 6, needRam: 8, needsImage: true,
    build: (p) => img2imgGraph(p, 0.22, 'clean smooth rendering, noise-free, polished'),
  },

  // ---- 高清放大（互斥）----
  {
    id: 'esrgan-2x', name: '模型放大 2 倍', stage: 'upscale',
    desc: '通过超分辨率模型直接放大 2 倍，快速提升清晰度且不改变画面内容', needVram: 4, needRam: 8, needsImage: true, needsUpscaleModel: true,
    build: (p) => ({
      '9': save(['21', 0]),
      '12': { class_type: 'LoadImage', inputs: { image: p.image, upload: 'image' } },
      '20': { class_type: 'UpscaleModelLoader', inputs: { model_name: p.upscaleModel } },
      '21': { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['20', 0], image: ['12', 0] } },
    }),
  },
  {
    id: 'esrgan-4x', name: '模型放大 4 倍', stage: 'upscale',
    desc: '放大模型直出 4x，显存占用更高', needVram: 6, needRam: 8, needsImage: true, needsUpscaleModel: true,
    build: (p) => ({
      '9': save(['21', 0]),
      '12': { class_type: 'LoadImage', inputs: { image: p.image, upload: 'image' } },
      '20': { class_type: 'UpscaleModelLoader', inputs: { model_name: p.upscaleModel } },
      '21': { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['20', 0], image: ['12', 0] } },
    }),
  },
  {
    id: 'latent-15x', name: '潜空间放大重绘 1.5x', stage: 'upscale',
    desc: '放大同时轻度重绘，顺手补细节', needVram: 6, needRam: 16, needsImage: true,
    build: (p) => latentUpscaleGraph(p, 1.5, 0.4),
  },
  {
    id: 'latent-2x', name: '潜空间放大重绘 2x', stage: 'upscale',
    desc: '将画面放大 2 倍并执行深度潜空间重绘，呈现最丰富的画面细节', needVram: 8, needRam: 16, needsImage: true,
    build: (p) => latentUpscaleGraph(p, 2.0, 0.45),
  },

  // ---- 出片特效（互斥，低强度重绘出氛围）----
  {
    id: 'retro-photo', name: '老照片做旧感', stage: 'fx',
    desc: '叠加复古褪色影调与自然胶片颗粒质感', needVram: 6, needRam: 8, needsImage: true,
    build: (p) => img2imgGraph(p, 0.35, 'vintage aged photograph, faded warm colors, film grain, slight vignette, 1970s photo paper'),
  },
  {
    id: 'poster-sharp', name: '海报级锐化对比', stage: 'fx',
    desc: '强化边缘锐度与明暗对比，适合制作视觉海报与封面', needVram: 6, needRam: 8, needsImage: true,
    build: (p) => img2imgGraph(p, 0.3, 'poster quality, ultra sharp, vivid contrast, professional print look'),
  },
  {
    id: 'dreamy-haze', name: '柔焦梦幻辉光', stage: 'fx',
    desc: '柔焦加一层发光薄雾', needVram: 6, needRam: 8, needsImage: true,
    build: (p) => img2imgGraph(p, 0.35, 'soft focus, dreamy glowing haze, ethereal bloom light, romantic atmosphere'),
  },
  {
    id: 'vhs-glitch', name: 'VHS 故障磁带风', stage: 'fx',
    desc: '叠加扫描线与通道色差错位，呈现复古 VHS 磁带质感', needVram: 6, needRam: 8, needsImage: true,
    build: (p) => img2imgGraph(p, 0.35, 'VHS glitch effect, scanlines, chromatic aberration, tracking noise, retro tape artifacts'),
  },

  // ---- 视频衍生（互斥）----
  {
    id: 'svd-video', name: '图生短视频 (SVD)', stage: 'video',
    desc: '将静态图像生成为 14 帧动态视频，需安装 SVD 视频模型', needVram: 12, needRam: 16, needsImage: true,
    build: (p) => ({
      '1': { class_type: 'ImageOnlyCheckpointLoader', inputs: { ckpt_name: p.ckpt } },
      '3': sampler({
        seed: seedOf(p), steps: 20, cfg: 2.5, scheduler: 'karras', denoise: 1,
        model: ['19', 0], positive: ['13', 0], negative: ['13', 1], latent_image: ['13', 2],
      }),
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['1', 2] } },
      '9': {
        class_type: 'SaveAnimatedWEBP',
        inputs: { images: ['8', 0], filename_prefix: 'Lintools', fps: 8, lossless: false, quality: 85, method: 'default' },
      },
      '12': { class_type: 'LoadImage', inputs: { image: p.image, upload: 'image' } },
      '13': {
        class_type: 'SVD_img2vid_Conditioning',
        inputs: {
          clip_vision: ['1', 1], init_image: ['12', 0], vae: ['1', 2],
          width: Math.min(p.width, 1024), height: Math.min(p.height, 1024),
          video_frames: 14, motion_bucket_id: 127, fps: 6, augmentation: 0,
        },
      },
      '19': { class_type: 'VideoLinearCFGGuidance', inputs: { model: ['1', 0], min_cfg: 2.5 } },
    }),
  },

  // ---- 模型训练（互斥）：不拼节点图，交给主进程里的 sd-scripts ----
  {
    id: 'train-sd15', name: 'Lora 训练 (SD1.5)', stage: 'train',
    desc: '使用自定义图像训练 SD1.5 架构 LoRA 模型（512 分辨率，支持 4GB 以上显存）',
    needVram: 6, needRam: 12,
    trainer: { resolution: 512, note: 'SD1.5 基础底模，训练完成后可直接在此处 LoRA 列表中选用' },
    build: () => ({}),
  },
  {
    id: 'train-sdxl', name: 'Lora 训练 (SDXL)', stage: 'train',
    desc: 'SDXL 训练 SDXL 架构高分辨率 LoRA 模型（1024 分辨率，细节表现更佳）',
    needVram: 10, needRam: 16,
    trainer: { resolution: 1024, note: 'SDXL 适用于 SDXL 基础底模，10GB 以下显存设备建议选用 SD1.5 那条' },
    build: () => ({}),
  },
]

/** 潜空间放大重绘：编码 → 潜空间放大 → 低 denoise 重绘 → 解码 */
function latentUpscaleGraph(p: WfParams, scale: number, denoise: number) {
  return {
    '3': sampler({
      seed: seedOf(p), steps: p.steps, cfg: p.cfg, denoise,
      model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['22', 0],
    }),
    '4': ckptNode(p),
    '6': encode(p.prompt, ['4', 1]),
    '7': encode(neg(p), ['4', 1]),
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': save(['8', 0]),
    '11': { class_type: 'VAEEncode', inputs: { pixels: ['12', 0], vae: ['4', 2] } },
    '12': { class_type: 'LoadImage', inputs: { image: p.image, upload: 'image' } },
    '22': {
      class_type: 'LatentUpscaleBy',
      inputs: { samples: ['11', 0], upscale_method: 'bislerp', scale_by: scale },
    },
  }
}

export function workflowById(id: string): WorkflowDef | undefined {
  return WORKFLOWS.find((w) => w.id === id)
}
