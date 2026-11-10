// 工作流模式：左侧工作流按阶段分组，点一条单独跑，点两条以上自动融合成一条流水线。
// 中间是参数与流水线预览；右边是标准模式的进度与结果，高级模式从右侧拉开帷幕放 ComfyUI 画布。
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { createElement } from 'react'
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Brain,
  Cpu,
  CircleAlert,
  CircleCheck,
  Download,
  FileText,
  FolderOpen,
  Home,
  ImageIcon,
  ImagePlus,
  Layers,
  Loader2,
  Monitor,
  Package,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  Search,
  Square,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import {
  comfyDownloadState,
  comfyEngineInstall,
  comfyEnginePause,
  comfyEnginePurge,
  comfyEngineStart,
  comfyEngineStatus,
  comfyEngineStop,
  comfyEngineUninstall,
  comfyHistory,
  comfyInterrupt,
  comfyLocalModels,
  comfyModels,
  comfyQueue,
  comfyStatus,
  comfyUpload,
  comfyView,
  evalHardware,
  fmtPct,
  onComfyEngineProgress,
  onComfyEngineStatus,
  onComfyResumeAvailable,
  openComfyLog,
  probeHardware,
  vcCheck,
  vcInstall,
  type ComfyEngineProgress,
  type ComfyEngineStatus,
  type ComfyModelLists,
  type ComfyStatus,
  type HardwareInfo,
  type HwEval,
  type VcCheckResult,
} from '../lib/comfyui'
import { chatAi, getAiStatus, onAiStatus } from '../lib/localLlm'
import { POLISH_SYSTEM_PROMPT } from '../lib/aiBrain'
import { editImage, generateImage, listModels, type ApiConfig } from '../lib/api'
import { fetchImageToDir } from '../lib/settings'
import {
  onTrainLog,
  onTrainProgress,
  trainPickDataset,
  trainReveal,
  trainSetup,
  trainStart,
  trainStatus,
  trainStop,
  type TrainEnvStatus,
  type TrainProgress,
} from '../lib/train'
import ModelHubModal from './ModelHubModal'
import { STAGES, WORKFLOWS, workflowById, type WfParams, type WorkflowDef } from '../workflows'

const BASE_KEY = 'lin-toolbox-comfy-base'
const API_CFG_KEY = 'lin-toolbox-config'
const MAX_PICKS = 4

/** 读文生图页配好的绘图 API（同一份 localStorage） */
function loadApiConfig(): ApiConfig {
  try {
    const raw = localStorage.getItem(API_CFG_KEY)
    const p = raw ? (JSON.parse(raw) as Partial<ApiConfig>) : {}
    return { baseUrl: p.baseUrl || '', apiKey: p.apiKey || '', model: p.model || '', extras: p.extras || '' }
  } catch {
    return { baseUrl: '', apiKey: '', model: '', extras: '' }
  }
}

/** 就地改 API 配置：与文生图页共用同一份 localStorage，保留其它字段 */
function saveApiConfig(patch: Partial<ApiConfig>): ApiConfig {
  let next: Record<string, unknown> = {}
  try {
    const raw = localStorage.getItem(API_CFG_KEY)
    next = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    /* ignore */
  }
  Object.assign(next, patch)
  try {
    localStorage.setItem(API_CFG_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  return {
    baseUrl: String(next.baseUrl || ''),
    apiKey: String(next.apiKey || ''),
    model: String(next.model || ''),
    extras: String(next.extras || ''),
  }
}

interface StageRun {
  id: string
  name: string
  status: 'wait' | 'run' | 'done' | 'fail'
  ms?: number
  thumb?: string
  note?: string
}

/** Electron 的内置浏览器元素（webview）在 TS 里没有类型，这里补一个够用的 */
type WebviewEl = HTMLElement & {
  src: string
  loadURL: (url: string) => void
  reload: () => void
  goBack: () => void
  goForward: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  getURL: () => string
  executeJavaScript: (code: string) => Promise<unknown>
}

const SIZE_OPTIONS: Array<[number, number]> = [  [512, 512],
  [768, 512],
  [512, 768],
  [1024, 1024],
  [1216, 832],
  [832, 1216],
]

/**
 * 融合两条预设：后一条如果是纯文生图（用空 latent 起手），
 * 就把它的起点换成「上一张成品」，采样强度压到 0.6。
 * 效果上就是拿前一条的结果当底，再按后一条的画风重画一遍。
 * 本身就需要输入图的工作流（图生图 / 修复 / 放大）不用动，那类本来就会吃上一张。
 */
function fuseGraphWithPrev(
  graph: Record<string, unknown>,
  prevImage: string,
): Record<string, unknown> {
  type N = { class_type?: string; inputs?: Record<string, unknown> }
  const entries = Object.entries(graph) as Array<[string, N]>
  const empty = entries.find(([, n]) => n && n.class_type === 'EmptyLatentImage')
  if (!empty) return graph
  const ckpt = entries.find(([, n]) => n && n.class_type === 'CheckpointLoaderSimple')
  if (!ckpt) return graph
  const sampler = entries.find(([, n]) => n && n.class_type === 'KSampler')
  const next: Record<string, unknown> = { ...graph }
  delete next[empty[0]]
  const loadId = 'fuse_load'
  const encId = 'fuse_enc'
  next[loadId] = { class_type: 'LoadImage', inputs: { image: prevImage, upload: 'image' } }
  next[encId] = { class_type: 'VAEEncode', inputs: { pixels: [loadId, 0], vae: [ckpt[0], 2] } }
  if (sampler) {
    const s = { ...(sampler[1] as N) }
    s.inputs = { ...(s.inputs || {}), latent_image: [encId, 0], denoise: 0.6 }
    next[sampler[0]] = s
  }
  return next
}

export default function WorkflowPanel({
  importedPrompt,
  advanced,
  onAdvancedChange,
}: {
  importedPrompt: string
  advanced?: boolean
  onAdvancedChange?: (v: boolean) => void
}) {
  const [base, setBase] = useState(() => localStorage.getItem(BASE_KEY) || 'http://127.0.0.1:8188')
  const [comfy, setComfy] = useState<ComfyStatus | null>(null)
  const [models, setModels] = useState<ComfyModelLists | null>(null)
  const [hw, setHw] = useState<HardwareInfo | null>(null)

  // 内置 ComfyUI 引擎
  const [engine, setEngine] = useState<ComfyEngineStatus | null>(null)
  const [engineProg, setEngineProg] = useState<ComfyEngineProgress | null>(null)
  const [engineBusy, setEngineBusy] = useState(false)

  // 选中的预设（按点选顺序，两条以上就是融合）
  const [picked, setPicked] = useState<string[]>([])
  const [warnFor, setWarnFor] = useState<WorkflowDef | null>(null)

  const [prompt, setPrompt] = useState('')

  // DS 帮写提示词
  const [dsReady, setDsReady] = useState(false)
  const [dsBusy, setDsBusy] = useState(false)
  const [dsIdea, setDsIdea] = useState('')
  const [dsNote, setDsNote] = useState('')
  const [showModels, setShowModels] = useState(false)
  const [negative, setNegative] = useState('')
  const [ckpt, setCkpt] = useState('')
  const [lora, setLora] = useState('')
  const [loraStrength, setLoraStrength] = useState(0.8)
  const [controlnet, setControlnet] = useState('')
  const [upscaleModel, setUpscaleModel] = useState('')
  const [unet, setUnet] = useState('')
  const [clip1, setClip1] = useState('')
  const [clip2, setClip2] = useState('')
  const [vae, setVae] = useState('')
  const [sizeIdx, setSizeIdx] = useState(0)
  const [steps, setSteps] = useState(20)
  const [cfg, setCfg] = useState(7)
  const [seed, setSeed] = useState(-1)
  const [refImage, setRefImage] = useState<{ file: File; preview: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [running, setRunning] = useState(false)
  const [stageRuns, setStageRuns] = useState<StageRun[]>([])
  const [finalImage, setFinalImage] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const cancelRef = useRef(false)

  // 画布联动
  const [previewWf, setPreviewWf] = useState('')
  const [canvasNote, setCanvasNote] = useState('')
  const frameRef = useRef<WebviewEl | null>(null)
  const lastPushRef = useRef<{ type: string; id: string; title: string; graph: Record<string, unknown>; at: number } | null>(null)
  // 内置浏览器的地址栏与前进/后退状态
  const [addr, setAddr] = useState('')
  const [canBack, setCanBack] = useState(false)
  const [canForward, setCanForward] = useState(false)

  // 高级模式的「帷幕」：贴右边拉开，左边缘能拖，宽度记在本地
  const clampCurtain = (w: number) => {
    const vw = typeof window === 'undefined' ? 1280 : window.innerWidth
    return Math.min(Math.max(w, 460), Math.max(520, vw - 320))
  }
  const [curtainW, setCurtainW] = useState(() => {
    if (typeof window === 'undefined') return 880
    const saved = Number(localStorage.getItem('lin-toolbox-curtain-w') || 0)
    return clampCurtain(saved > 0 ? saved : Math.round(window.innerWidth * 0.56))
  })
  const draggingRef = useRef(false)

  const startDrag = (e: RPointerEvent<HTMLDivElement>) => {
    draggingRef.current = true
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 有些环境不支持指针捕获，靠容器上的 move 兜底 */
    }
    e.preventDefault()
  }
  const onCurtainMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    setCurtainW(clampCurtain(window.innerWidth - e.clientX))
  }
  const endDrag = () => {
    if (!draggingRef.current) return
    draggingRef.current = false
    try {
      localStorage.setItem('lin-toolbox-curtain-w', String(curtainW))
    } catch {
      /* 存不了也没关系 */
    }
  }

  useEffect(() => {
    const onResize = () => setCurtainW((w) => clampCurtain(w))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 上次没下完的续传询问
  const [resumeAsk, setResumeAsk] = useState(false)
  const [comfyLog, setComfyLog] = useState('')

  // 常驻内联 API 配置：与文生图页同一份
  const [apiCfg, setApiCfg] = useState<ApiConfig>(() => loadApiConfig())
  const patchApiCfg = (patch: Partial<ApiConfig>) => setApiCfg(saveApiConfig(patch))
  const [apiModels, setApiModels] = useState<string[]>([])
  const [apiModelsBusy, setApiModelsBusy] = useState(false)
  const [apiModelsNote, setApiModelsNote] = useState('')
  // 云端附加模型：VAE / LoRA 会拼进请求包的附加参数里
  const [apiVae, setApiVae] = useState('')
  const [apiLoraName, setApiLoraName] = useState('')
  const [apiLoraStrength, setApiLoraStrength] = useState(0.8)

  // LoRA 训练（走主进程里的 sd-scripts，不拼节点图）
  const [trainEnv, setTrainEnv] = useState<TrainEnvStatus | null>(null)
  const [trainBusy, setTrainBusy] = useState('')
  const [trainLog, setTrainLog] = useState('')
  const [trainProg, setTrainProg] = useState<TrainProgress | null>(null)
  const [dsDir, setDsDir] = useState('')
  const [trName, setTrName] = useState('mylora')
  const [trActivation, setTrActivation] = useState('mymodel')
  const [trCaption, setTrCaption] = useState('')
  const [trEpochs, setTrEpochs] = useState(10)
  const [trDim, setTrDim] = useState(32)
  const [trLr, setTrLr] = useState(0.0001)
  const [trRes, setTrRes] = useState(512)
  const [trLowVram, setTrLowVram] = useState(true)

  /** 把「附加参数 JSON」和面板上的 VAE / LoRA 合成一份，发给服务商 */
  const apiExtrasObject = (): Record<string, unknown> => {
    let baseObj: Record<string, unknown> = {}
    try {
      const j = apiCfg.extras ? JSON.parse(apiCfg.extras) : {}
      if (j && typeof j === 'object' && !Array.isArray(j)) baseObj = j as Record<string, unknown>
    } catch {
      baseObj = {}
    }
    if (apiVae.trim()) baseObj.vae = apiVae.trim()
    if (apiLoraName.trim()) {
      baseObj.loras = [{ name: apiLoraName.trim(), strength: apiLoraStrength }]
      baseObj.lora_name = apiLoraName.trim()
      baseObj.lora_strength = apiLoraStrength
    }
    return baseObj
  }

  /** 从服务商拉模型列表，直接变成下拉可选项 */
  const pullApiModels = async () => {
    if (!apiCfg.baseUrl || !apiCfg.apiKey) {
      setApiModelsNote('请先填写接口地址与密钥后再获取列表')
      return
    }
    setApiModelsBusy(true)
    setApiModelsNote('')
    try {
      const list = await listModels(apiCfg)
      const ids = list.map((m) => m.id).sort((a, b) => a.localeCompare(b))
      setApiModels(ids)
      setApiModelsNote(ids.length ? `拉到 ${ids.length} 个模型，点下拉选` : '返回的模型列表为空，请手动输入模型名称')
    } catch (e) {
      setApiModelsNote(`拉取失败：${e instanceof Error ? e.message : '未知原因'}，可手动输入`)
    } finally {
      setApiModelsBusy(false)
    }
  }

  useEffect(() => {
    localStorage.setItem(BASE_KEY, base)
  }, [base])

  // 每次进入工作流模式：检测电脑状态 + ComfyUI 连接
  const detect = useCallback(async (baseOverride?: string) => {
    const b = baseOverride || base
    const [h, s, local] = await Promise.all([probeHardware(), comfyStatus(b), comfyLocalModels()])
    setHw(h)
    setComfy(s)
    // 模型清单：在线以 ComfyUI 上报为准，没连上（或某类为空）就扫本地 models 目录兜底，
    // 总之只要磁盘上有模型，下拉框就列得出来
    let m = s.online ? await comfyModels(b) : null
    if (local) {
      if (!m) m = local
      else {
        for (const k of Object.keys(local) as Array<keyof typeof local>) {
          if (!m[k]?.length && local[k]?.length) m[k] = local[k]
        }
      }
    }
    if (m) {
      setModels(m)
      setCkpt((v) => v || m.checkpoints[0] || '')
      setLora((v) => v || m.loras[0] || '')
      setControlnet((v) => v || m.controlnets[0] || '')
      setUpscaleModel((v) => v || m.upscaleModels[0] || '')
      setUnet((v) => v || m.unets[0] || '')
      setClip1((v) => v || m.clips[0] || '')
      setClip2((v) => v || m.clips[1] || m.clips[0] || '')
      setVae((v) => v || m.vaes[0] || '')
    }
  }, [base])

  useEffect(() => {
    detect()
  }, [detect])

  // 内置引擎状态：订阅事件，就绪后自动刷新连接与模型清单
  useEffect(() => {
    comfyEngineStatus().then((s) => {
      if (s) {
        setEngine(s)
        // 上次下载被打断（关软件、断电、网断）：进来先问要不要接着下
        if (s.partialDownload && !s.installed && s.state !== 'preparing') setResumeAsk(true)
      }
    })
    comfyDownloadState().then((d) => {
      if (d) setComfyLog(d.logPath || '')
    })
    const offR = onComfyResumeAvailable((p) => {
      if (p.partial && !p.installed) setResumeAsk(true)
    })
    const offS = onComfyEngineStatus((s) => {
      setEngine(s)
      if (s.ready) {
        // 引擎可能避让到了别的端口，以它报的地址为准
        if (s.base) setBase(s.base)
        detect(s.base)
      }
      if (s.state !== 'preparing' && s.state !== 'starting') setEngineProg(null)
    })
    const offP = onComfyEngineProgress((p) => setEngineProg(p))
    return () => {
      offR()
      offS()
      offP()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const engineInstall = async () => {
    // 先查 VC 运行库：缺了先弹窗问装不装，别闷头装
    const vc = await vcCheck()
    if (vc && !vc.vcOk) {
      setVcAsk(vc)
      return
    }
    doEngineInstall()
  }

  const doEngineInstall = async () => {
    setEngineBusy(true)
    try {
      const r = await comfyEngineInstall()
      if (r.status) setEngine(r.status)
    } finally {
      setEngineBusy(false)
    }
  }

  // VC 弹窗的选择：装运行库（装完自动继续部署）/ 跳过直接部署
  const [vcAsk, setVcAsk] = useState<VcCheckResult | null>(null)
  const [vcBusy, setVcBusy] = useState(false)
  const vcInstallThenDeploy = async () => {
    setVcBusy(true)
    try {
      const r = await vcInstall()
      if (r && !r.ok) setErrorMsg(`运行库安装失败：${r.error || '未知原因'}，仍可尝试直接部署`)
    } finally {
      setVcBusy(false)
      setVcAsk(null)
      doEngineInstall()
    }
  }

  const engineStart = async () => {
    setEngineBusy(true)
    try {
      const r = await comfyEngineStart()
      if (r.status) setEngine(r.status)
      if (r.error) setErrorMsg(r.error)
    } finally {
      setEngineBusy(false)
    }
  }

  const engineStop = async () => {
    const s = await comfyEngineStop()
    if (s) setEngine(s)
  }

  const engineUninstall = async () => {
    if (!window.confirm('卸载内置 ComfyUI 会删掉约 4GB 的本体与模型文件，确定吗？')) return
    const s = await comfyEngineUninstall()
    if (s) setEngine(s)
  }

  const enginePause = async () => {
    const s = await comfyEnginePause()
    if (s) setEngine(s)
  }

  const enginePurge = async () => {
    if (!window.confirm('确认清理已下载的安装包与未完成的缓存文件？已解压的运行环境不受影响。')) return
    const s = await comfyEnginePurge()
    if (s) setEngine(s)
  }

  const engineRefresh = async () => {
    const s = await comfyEngineStatus()
    if (s) setEngine(s)
    detect()
  }

  // DS 就绪状态跟着引擎事件走
  useEffect(() => {
    getAiStatus().then((s) => s && setDsReady(s.ready))
    return onAiStatus((s) => setDsReady(s.ready))
  }, [])

  /** 大白话 → 英文提示词，流式写进提示词框 */
  const dsWrite = async () => {
    const idea = dsIdea.trim()
    if (!idea) {
      setDsNote('先打几个字，说说要画什么')
      return
    }
    if (!dsReady) {
      setDsNote('本地 DS 还没就绪，等它启动完再来')
      return
    }
    setDsBusy(true)
    setDsNote('')
    setPrompt('')
    let text = ''
    try {
      await chatAi(
        [
          { role: 'system', content: POLISH_SYSTEM_PROMPT },
          { role: 'user', content: `Subject: ${idea}` },
        ],
        (d) => {
          if (d.text) {
            text += d.text
            setPrompt(text)
          }
        },
        { temperature: 0.65, maxTokens: 1000 },
      )
      if (!text.trim()) setDsNote('没写出来，再点一次试试')
    } catch (e) {
      setDsNote(e instanceof Error ? e.message : 'DS 调用失败')
    } finally {
      setDsBusy(false)
    }
  }

  // LoRA 训练：环境状态 + 训练输出流
  useEffect(() => {
    trainStatus().then((s) => s && setTrainEnv(s))
    const offL = onTrainLog((t) => setTrainLog((prev) => (prev + t).slice(-60000)))
    const offP = onTrainProgress((p) => setTrainProg(p))
    return () => {
      offL()
      offP()
    }
  }, [])

  // 训练跑完（成功或中断）就把按钮放开，并刷新一次模型列表
  useEffect(() => {
    if (/训练完成|训练中断/.test(trainLog)) {
      setTrainBusy('')
      trainStatus().then((s) => s && setTrainEnv(s))
      detect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainLog])

  const refreshTrainEnv = async () => setTrainEnv(await trainStatus())

  const pickDataset = async () => {
    const d = await trainPickDataset()
    if (d) setDsDir(d)
  }

  const setupTrain = async () => {
    if (trainBusy) return
    setTrainBusy('准备训练环境')
    setErrorMsg('')
    try {
      const r = await trainSetup()
      if (!r.ok) setErrorMsg(r.error || '训练环境没装好')
      await refreshTrainEnv()
    } finally {
      setTrainBusy('')
    }
  }

  const startTrain = async () => {
    if (!dsDir) {
      setErrorMsg('请先选择包含训练图像的文件夹')
      return
    }
    if (!ckpt) {
      setErrorMsg('请先选择已下载的基础底模（Checkpoint）作为训练基底')
      return
    }
    setErrorMsg('')
    setTrainLog('')
    setTrainBusy('训练中')
    try {
      const r = await trainStart({
        datasetDir: dsDir,
        outputName: trName,
        activation: trActivation,
        caption: trCaption,
        baseModel: ckpt,
        resolution: trRes,
        epochs: trEpochs,
        lr: trLr,
        dim: trDim,
        alpha: Math.max(1, Math.round(trDim / 2)),
        lowvram: trLowVram,
      })
      if (!r.ok) {
        setErrorMsg(r.error || '训练没启动')
        setTrainBusy('')
      } else {
        setStageRuns([{ id: 'train', name: `LoRA 训练 · ${trName}`, status: 'run' }])
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '训练没启动')
      setTrainBusy('')
    }
  }

  const stopTrain = async () => {
    await trainStop()
    setTrainBusy('')
    setStageRuns((prev) => prev.map((s) => (s.status === 'run' ? { ...s, status: 'fail', note: '已手动停止' } : s)))
  }

  const hwEval: HwEval | null = useMemo(() => {
    if (!hw && !comfy) return null
    return evalHardware(hw, comfy)
  }, [hw, comfy])

  // 选中的预设按点选顺序排，两条以上就是融合
  const chain = useMemo(
    () => picked.map((id) => workflowById(id)).filter((w): w is WorkflowDef => !!w),
    [picked],
  )

  const toggleWorkflow = (wf: WorkflowDef) => {
    if (running) return
    if (picked.includes(wf.id)) {
      setPicked((prev) => prev.filter((id) => id !== wf.id))
      setPreviewWf((cur) => (cur === wf.id ? '' : cur))
      return
    }
    // 硬件门槛：超出就弹窗告知，由用户决定去留
    if (hwEval && (wf.needVram > hwEval.maxVramGb || wf.needRam > hwEval.totalRamGb)) {
      setWarnFor(wf)
      return
    }
    if (picked.length >= MAX_PICKS) {
      setErrorMsg(`最多同时融合 ${MAX_PICKS} 条工作流，请先取消一条后再选`)
      return
    }
    setPicked((prev) => [...prev, wf.id])
    setPreviewWf(wf.id)
  }

  const pickRef = (file: File) => {
    if (!file.type.startsWith('image/')) return
    if (file.size > 15 * 1024 * 1024) {
      setErrorMsg('图片大小不能超过 15MB')
      return
    }
    setRefImage((old) => {
      if (old) URL.revokeObjectURL(old.preview)
      return { file, preview: URL.createObjectURL(file) }
    })
  }

  const setStageState = (id: string, patch: Partial<StageRun>) =>
    setStageRuns((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  /** 轮询等一个工作流跑完，返回第一张产物图的 data URL */
  const waitResult = async (promptId: string): Promise<string> => {
    const deadline = Date.now() + 10 * 60 * 1000
    for (;;) {
      if (cancelRef.current) throw new Error('已手动停止')
      if (Date.now() > deadline) throw new Error('等待超时（10 分钟）')
      await new Promise((r) => setTimeout(r, 1500))
      const h = await comfyHistory(base, promptId)
      if (!h) continue
      if (h.statusStr === 'error') {
        const detail = h.messages.filter((m) => /error|exception/i.test(m)).join(' ').slice(0, 200)
        throw new Error(detail || 'ComfyUI 执行异常，请检查所选模型是否匹配或模型文件是否完整')
      }
      if (h.completed && h.images.length > 0) {
        return await comfyView(base, h.images[0])
      }
      if (h.completed) throw new Error('跑完了但没有拿到图片')
    }
  }

  const runChain = async () => {
    if (running) return
    setErrorMsg('')
    if (chain.length === 0) {
      setErrorMsg('请先在左侧选择至少一条工作流（或配置并勾选上方可选 API 模型接入）')
      return
    }
    if (chain.some((w) => w.trainer)) {
      setErrorMsg('LoRA 训练不支持与生成流水线混合执行，请使用下方「LoRA 训练」卡片单独跑')
      return
    }
    const hasLocal = chain.some((w) => !w.viaApi)
    if (hasLocal && !comfy?.online) {
      setErrorMsg('ComfyUI 还没起来，等它后台启动完（或者点左上角启动）再跑；只跑云端那条则不用')
      return
    }
    if (chain.some((w) => w.viaApi) && (!apiCfg.baseUrl || !apiCfg.apiKey || !apiCfg.model)) {
      setErrorMsg('「云端续绘」要先在上面把绘图 API 的地址、密钥、模型填好')
      return
    }
    const needsText = chain.some((w) => (w.stage === 'gen' || w.viaApi) && !w.needsImage)
    if (needsText && !prompt.trim()) {
      setErrorMsg('请先输入提示词（生成画面必填）')
      return
    }
    // 第一个需要输入图的工作流出现时，前面必须有生成类，或者用户传了参考图
    let hasImage = !!refImage
    for (const w of chain) {
      if (w.needsImage && !hasImage) {
        setErrorMsg(`「${w.name}」需要一张输入底图：可在它前面点选一条生成工作流、上传参考图，或开启上方可选 API 模型接入`)
        return
      }
      if (!w.needsImage || w.stage === 'gen') hasImage = true
      if (w.needsLora && !lora) {
        setErrorMsg(`「${w.name}」需要选择 LoRA 模型`)
        return
      }
      if (w.needsControlnet && !controlnet) {
        setErrorMsg(`「${w.name}」需要选择 ControlNet 模型`)
        return
      }
      if (w.needsUpscaleModel && !upscaleModel) {
        setErrorMsg(`「${w.name}」需要选择放大模型`)
        return
      }
      if (w.needsFlux && (!unet || !clip1 || !clip2)) {
        setErrorMsg('Flux 工作流需要 UNET 与两个 CLIP 组件，请检查模型目录')
        return
      }
    }
    if (!ckpt && chain.some((w) => !w.needsFlux)) {
      setErrorMsg('请先选择已下载的基础底模（Checkpoint）作为训练基底')
      return
    }

    cancelRef.current = false
    setRunning(true)
    setFinalImage(null)
    setStageRuns(chain.map((w) => ({ id: w.id, name: w.name, status: 'wait' })))

    const [width, height] = SIZE_OPTIONS[sizeIdx]
    const params: WfParams = {
      prompt: prompt.trim(),
      negative,
      ckpt,
      lora,
      loraStrength,
      controlnet,
      controlImage: '',
      upscaleModel,
      unet,
      clip1,
      clip2,
      vae,
      width,
      height,
      steps,
      cfg,
      seed,
      image: '',
    }

    /** 云端那一项：把提示词（和可选的参考图）交给第三方接口，返回 data URL */
    const runApiStage = async (inputDataUrl?: string): Promise<string> => {
      const cfgObj: ApiConfig = { ...apiCfg, extras: JSON.stringify(apiExtrasObject()) }
      const apiSize = '1024x1024'
      let imageData: string
      if (inputDataUrl) {
        const blob = await (await fetch(inputDataUrl)).blob()
        const r = await editImage(cfgObj, { prompt: prompt.trim(), size: apiSize, quality: 'high' }, blob, 'chain-ref.png')
        imageData = r.imageData
      } else if (refImage) {
        const r = await editImage(cfgObj, { prompt: prompt.trim(), size: apiSize, quality: 'high' }, refImage.file, refImage.file.name)
        imageData = r.imageData
      } else {
        const r = await generateImage(cfgObj, { prompt: prompt.trim(), size: apiSize, quality: 'high' })
        imageData = r.imageData
      }
      if (/^https?:\/\//i.test(imageData)) {
        const saved = await fetchImageToDir(imageData, `霖易工具箱-${Date.now()}.png`)
        if (saved.ok && saved.dataUrl) return saved.dataUrl
      }
      return imageData
    }

    try {
      // 有参考图先传进 ComfyUI
      if (refImage) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader()
          fr.onload = () => resolve(String(fr.result))
          fr.onerror = () => reject(new Error('读取参考图失败'))
          fr.readAsDataURL(refImage.file)
        })
        const up = await comfyUpload(base, dataUrl, `lintools-ref-${Date.now()}.png`)
        params.image = up.name
        params.controlImage = up.name
      }

      let lastDataUrl = ''
      for (const [idx, wf] of chain.entries()) {
        setStageState(wf.id, { status: 'run' })
        const t0 = Date.now()
        if (wf.viaApi) {
          const dataUrl = await runApiStage(lastDataUrl || undefined)
          lastDataUrl = dataUrl
          setStageState(wf.id, { status: 'done', ms: Date.now() - t0, thumb: dataUrl })
          setFinalImage(dataUrl)
          continue
        }
        let graph = wf.build(params)
        // 融合：从第二条开始，纯文生图那类改成「拿上一张当底」再画
        if (idx > 0 && lastDataUrl && params.image) {
          graph = fuseGraphWithPrev(graph as Record<string, unknown>, params.image)
        }
        const { promptId } = await comfyQueue(base, graph)
        const dataUrl = await waitResult(promptId)
        lastDataUrl = dataUrl
        setStageState(wf.id, { status: 'done', ms: Date.now() - t0, thumb: dataUrl })
        setFinalImage(dataUrl)
        // 产物喂给下一条
        if (wf.stage !== 'video') {
          const up = await comfyUpload(base, dataUrl, `lintools-chain-${Date.now()}.png`)
          params.image = up.name
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '执行失败'
      setErrorMsg(msg)
      setStageRuns((prev) => prev.map((s) => (s.status === 'run' ? { ...s, status: 'fail', note: msg } : s)))
    } finally {
      setRunning(false)
    }
  }

  const stopRun = () => {
    cancelRef.current = true
    comfyInterrupt(base)
  }

  /** 往内置浏览器里的 ComfyUI 页面递一条消息（webview 是独立进程，只能走 executeJavaScript） */
  const sendToCanvas = useCallback((data: Record<string, unknown>) => {
    const view = frameRef.current
    if (!view) return
    try {
      view.executeJavaScript(`window.postMessage(${JSON.stringify(data)}, '*')`).catch(() => {})
    } catch {
      /* 页面还没 ready 就先算了，后面有重试 */
    }
  }, [])

  /** 把选中的预设铺到内嵌浏览器里的 ComfyUI 画布上（跨进程，只能靠 executeJavaScript 递消息） */
  const pushCanvas = useCallback(
    (wfId: string) => {
      const view = frameRef.current
      if (!view) return
      const [w, h] = SIZE_OPTIONS[sizeIdx]
      const params: WfParams = {
        prompt: prompt.trim() || 'a photo',
        negative,
        ckpt,
        lora,
        loraStrength,
        controlnet,
        controlImage: '',
        upscaleModel,
        unet,
        clip1,
        clip2,
        vae,
        width: w,
        height: h,
        steps,
        cfg,
        seed,
        image: refImage ? 'lintools-ref.png' : '',
      }

      const list = (chain.length > 0 ? chain : wfId ? [workflowById(wfId)] : []).filter(
        (x): x is WorkflowDef => !!x,
      )
      const built = list
        .map((wf) => {
          let g: Record<string, unknown> = {}
          try {
            g = wf.build(params) as Record<string, unknown>
          } catch {
            g = {}
          }
          return { wf, graph: g }
        })
        .filter((x) => Object.keys(x.graph).length > 0)
      if (built.length === 0) {
        setCanvasNote('这一条不是节点图（训练或云端那类），画布上没有可摆的节点')
        return
      }

      // 合起来摆在一张画布上；第二条起把空 latent 换成「以上一张为底」
      const merged: Record<string, unknown> = {}
      built.forEach((item, i) => {
        const g = i > 0 ? fuseGraphWithPrev(item.graph, '') : item.graph
        const prefix = `f${i + 1}_`
        for (const [id, node] of Object.entries(g)) {
          const n = node as { class_type?: string; inputs?: Record<string, unknown> }
          if (!n || typeof n !== 'object' || !n.class_type) continue
          const inputs: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(n.inputs || {})) {
            inputs[k] = Array.isArray(v) && typeof v[0] === 'string' ? [`${prefix}${v[0]}`, v[1]] : v
          }
          merged[`${prefix}${id}`] = { class_type: n.class_type, inputs }
        }
      })
      if (Object.keys(merged).length === 0) return

      const title =
        built.length > 1 ? `融合 · ${built.map((b) => b.wf.name).join(' + ')}` : built[0].wf.name
      const sig = built.map((b) => b.wf.id).join('>')
      const payload = { type: 'lintools:load-workflow', id: sig, title, graph: merged, at: Date.now() }
      // 同一套图在 1.5 秒内不重复推：画布正在重建时再推一次会报 canvas is null
      const prev = lastPushRef.current
      if (prev && prev.id === sig && payload.at - prev.at < 1500) return
      lastPushRef.current = payload
      sendToCanvas({ type: payload.type, id: payload.id, title: payload.title, graph: payload.graph })
      setCanvasNote(
        built.length > 1 ? `已融合 ${built.length} 条并铺到画布` : `已同步「${built[0].wf.name}」到右边画布`,
      )
    },
    [chain, negative, ckpt, lora, loraStrength, controlnet, upscaleModel, unet, clip1, clip2, vae, sizeIdx, steps, cfg, seed, prompt, refImage],
  )

  // 预设一变就推；没开高级模式先不推，等画布打开后再补一次
  useEffect(() => {
    if (!advanced) return
    const id = previewWf || picked[picked.length - 1] || ''
    if (!id) return
    const t = window.setTimeout(() => pushCanvas(id), 150)
    return () => window.clearTimeout(t)
  }, [previewWf, picked, advanced, pushCanvas])

  /** 页面刚加载好时连发几次：桥脚本装好之前那几发会丢，多发几遍补上 */
  const pushAfterLoad = useCallback(() => {
    const id = lastPushRef.current?.id || previewWf || picked[picked.length - 1] || ''
    if (!id) return
    for (const ms of [300, 1200, 2600]) {
      window.setTimeout(() => {
        lastPushRef.current = null // 清掉去重，强制再发一遍
        pushCanvas(id)
      }, ms)
    }
  }, [pushCanvas, previewWf, picked])

  // 内置浏览器：地址栏与前进后退同步，页面加载好就补推一次画布
  useEffect(() => {
    const view = frameRef.current
    if (!advanced || !view) return
    const sync = () => {
      try {
        setCanBack(view.canGoBack())
        setCanForward(view.canGoForward())
        const u = view.getURL()
        if (u) setAddr(u)
      } catch {
        /* 还没导航过 */
      }
    }
    const onReady = () => {
      sync()
      pushAfterLoad()
    }
    const onNav = () => sync()
    view.addEventListener('dom-ready', onReady)
    view.addEventListener('did-finish-load', onReady)
    view.addEventListener('did-navigate', onNav)
    view.addEventListener('did-navigate-in-page', onNav)
    sync()
    return () => {
      view.removeEventListener('dom-ready', onReady)
      view.removeEventListener('did-finish-load', onReady)
      view.removeEventListener('did-navigate', onNav)
      view.removeEventListener('did-navigate-in-page', onNav)
    }
  }, [advanced, pushAfterLoad])

  const navBack = () => {
    try {
      frameRef.current?.goBack()
    } catch {
      /* ignore */
    }
  }
  const navForward = () => {
    try {
      frameRef.current?.goForward()
    } catch {
      /* ignore */
    }
  }
  const navReload = () => {
    try {
      frameRef.current?.reload()
    } catch {
      /* ignore */
    }
  }
  const navHome = () => {
    try {
      frameRef.current?.loadURL(base)
    } catch {
      /* ignore */
    }
  }
  const goAddr = () => {
    const view = frameRef.current
    let u = addr.trim()
    if (!view || !u) return
    if (!/^https?:\/\//i.test(u)) u = `http://${u}`
    try {
      view.loadURL(u)
    } catch {
      /* ignore */
    }
  }

  // 画布里的桥就绪 / 载入成功 / 报错，都会回一条消息
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; error?: string; id?: string } | null
      if (!d || typeof d !== 'object' || !d.type) return
      if (d.type === 'lintools:bridge-ready') {
        const last = lastPushRef.current
        if (last) pushCanvas(last.id)
        else if (previewWf) pushCanvas(previewWf)
        else setCanvasNote('画布桥接已就绪，切换左侧预设将自动同步节点图')
      } else if (d.type === 'lintools:workflow-loaded') {
        setCanvasNote((n) => n || '已同步到画布')
      } else if (d.type === 'lintools:workflow-error') {
        setCanvasNote(`画布没接住：${d.error || '未知原因'}`)
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [pushCanvas, previewWf])

  const tierBadge = !hwEval
    ? null
    : hwEval.tier === 'smooth'
      ? { text: '硬件评估：流畅', cls: 'border-teal-500/40 bg-teal-500/10 text-teal-300' }
      : hwEval.tier === 'ok'
        ? { text: '硬件评估：凑合', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300' }
        : { text: '硬件评估：偏低', cls: 'border-red-500/40 bg-red-500/10 text-red-300' }

  return (
    <>
      {/* ---- 左：引擎 + 硬件 + 工作流列表 ---- */}
      <section className="h-fit rounded-lg border border-teal-500/15 bg-white/[0.02] p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Layers className="h-4 w-4 text-teal-400" />
          工作流
          <span className="ml-auto font-mono text-[10px] text-zinc-500">
            {chain.length === 0 ? '在左侧点选两条及以上将自动融合' : `${chain.length} 条已融合`}
          </span>
        </h2>

        {/* 内置 ComfyUI 引擎 */}
        {engine && (
          <div className="mb-3 rounded-md border border-teal-500/20 bg-teal-500/[0.04] p-2.5 text-[11px]">
            <div className="mb-1.5 flex items-center gap-1 font-medium text-teal-300">
              <Download className="h-3 w-3" /> 内置 ComfyUI
              {engine.state === 'ready' && (
                <span className="ml-auto rounded-full border border-teal-500/40 bg-teal-500/10 px-1.5 py-0.5 text-[10px] text-teal-300">
                  运行中
                </span>
              )}
              <button
                onClick={engineRefresh}
                title="刷新状态"
                className={`rounded p-0.5 text-zinc-500 transition-colors hover:text-teal-300 ${engine.state === 'ready' ? '' : 'ml-auto'}`}
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            </div>

            {engine.state === 'uninstalled' && (
              <>
                <p className="mb-2 leading-relaxed text-zinc-400">
                  当前尚未部署内置 ComfyUI。点击下方按钮可执行一键部署（约 3.7GB，包含独立 Python 环境、默认基础底模与超分模型），部署完成后点击启动即可运行。
                </p>
                <button
                  onClick={engineInstall}
                  disabled={engineBusy}
                  className="w-full rounded-md bg-teal-500/90 px-2 py-1.5 font-medium text-black transition-colors hover:bg-teal-400 disabled:opacity-40"
                >
                  {engineBusy ? '正在准备…' : '一键部署内置 ComfyUI（约 3.7GB）'}
                </button>
              </>
            )}

            {(engine.state === 'preparing' || engine.state === 'starting') && (
              <>
                <div className="mb-1 flex items-center gap-1.5 text-zinc-300">
                  <Loader2 className="h-3 w-3 animate-spin text-teal-400" />
                  <span className="truncate">{engineProg?.label || (engine.state === 'starting' ? '正在启动…' : '正在准备…')}</span>
                  {typeof engineProg?.percent === 'number' && (
                    <span className="ml-auto font-mono text-[10px] text-zinc-500">{fmtPct(engineProg.percent)}%</span>
                  )}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-black/50">
                  <div
                    className="h-full rounded-full bg-teal-400 transition-all duration-300"
                    style={{ width: `${Math.max(2, Math.min(100, (engineProg?.percent ?? 0) * 100))}%` }}
                  />
                </div>
                {engine.state === 'preparing' && (
                  <button
                    onClick={enginePause}
                    className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-300"
                  >
                    <Pause className="h-3 w-3" /> 暂停（进度保留，随时可以接着下）
                  </button>
                )}
                <p className="mt-1 text-[10px] text-zinc-500">下载中别关软件，断了也能接着续。</p>
              </>
            )}

            {engine.state === 'stopped' && engine.installed && (
              <>
                <p className="mb-2 leading-relaxed text-zinc-400">
                  已装好，现在没启动。{engine.hasCheckpoint ? '点击启动后将在后台运行，不占用主界面空间。' : '没检测到底模，点「继续下载部署」把它补齐。'}
                </p>
                {engine.hasCheckpoint ? (
                  <button
                    onClick={engineStart}
                    disabled={engineBusy}
                    className="w-full rounded-md bg-teal-500/90 px-2 py-1.5 font-medium text-black transition-colors hover:bg-teal-400 disabled:opacity-40"
                  >
                    {engineBusy ? '正在启动…' : '后台启动 ComfyUI'}
                  </button>
                ) : (
                  <button
                    onClick={engineInstall}
                    disabled={engineBusy}
                    className="w-full rounded-md bg-teal-500/90 px-2 py-1.5 font-medium text-black transition-colors hover:bg-teal-400 disabled:opacity-40"
                  >
                    {engineBusy ? '正在准备…' : '继续下载部署'}
                  </button>
                )}
                <div className="mt-1.5 flex items-center gap-3">
                  <button
                    onClick={enginePurge}
                    className="flex items-center gap-1 text-[10px] text-zinc-500 underline-offset-2 hover:text-amber-300 hover:underline"
                  >
                    <Trash2 className="h-3 w-3" /> 清除下载缓存
                  </button>
                  <button
                    onClick={engineUninstall}
                    className="text-[10px] text-zinc-500 underline-offset-2 hover:text-red-300 hover:underline"
                  >
                    卸载内置 ComfyUI
                  </button>
                </div>
              </>
            )}

            {engine.state === 'stopped' && !engine.installed && (
              <>
                <p className="mb-2 leading-relaxed text-zinc-400">下载已暂停，断点进度已保存，点击下方按钮可继续下载。</p>
                <button
                  onClick={engineInstall}
                  disabled={engineBusy}
                  className="w-full rounded-md bg-teal-500/90 px-2 py-1.5 font-medium text-black transition-colors hover:bg-teal-400 disabled:opacity-40"
                >
                  {engineBusy ? '正在准备…' : '继续下载部署'}
                </button>
                <button
                  onClick={enginePurge}
                  className="mt-1.5 flex items-center gap-1 text-[10px] text-zinc-500 underline-offset-2 hover:text-amber-300 hover:underline"
                >
                  <Trash2 className="h-3 w-3" /> 清除下载，从头再来
                </button>
              </>
            )}

            {engine.state === 'ready' && (
              <>
                <p className="mb-2 leading-relaxed text-zinc-300">内置 ComfyUI 正在后台运行，服务地址已自动配置就绪。</p>
                <button
                  onClick={engineStop}
                  className="rounded-md border border-zinc-700 px-2 py-1 text-zinc-400 transition-colors hover:border-red-500/50 hover:text-red-300"
                >
                  停止
                </button>
              </>
            )}

            {engine.state === 'error' && (
              <>
                <p className="mb-2 leading-relaxed text-red-300">{engine.error || '出了点问题'}</p>
                <button
                  onClick={engineInstall}
                  disabled={engineBusy}
                  className="w-full rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-40"
                >
                  {engineBusy ? '正在重试…' : '重试'}
                </button>
                <button
                  onClick={() => openComfyLog()}
                  className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 transition-colors hover:border-teal-500/50 hover:text-teal-300"
                >
                  <FileText className="h-3 w-3" /> 打开部署日志
                </button>
              </>
            )}
          </div>
        )}

        {/* 引擎状态 */}
        <div
          className={`mb-3 rounded-md border px-2.5 py-2 text-[11px] ${
            comfy?.online
              ? 'border-teal-500/30 bg-teal-500/10 text-teal-300'
              : 'border-zinc-700 bg-black/30 text-zinc-400'
          }`}
        >
          {comfy?.online ? (
            <span className="flex items-center gap-1.5">
              <CircleCheck className="h-3.5 w-3.5" /> ComfyUI 已连接
              {comfy.comfyVersion ? ` v${comfy.comfyVersion}` : ''}
            </span>
          ) : (
            <span className="flex items-start gap-1.5">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              尚未连接 ComfyUI 服务。首次使用请点击上方「一键部署」；装好之后它会在后台自己跑起来，不用你手动开别的窗口。
            </span>
          )}
        </div>

        {/* 硬件评估 */}
        <div className="mb-3 rounded-md border border-teal-500/20 bg-teal-500/[0.04] p-2.5 text-[11px] leading-relaxed text-zinc-400">
          <div className="mb-1 flex items-center gap-1 font-medium text-teal-300">
            <Monitor className="h-3 w-3" /> 电脑状态
            {tierBadge && (
              <span className={`ml-auto rounded-full border px-1.5 py-0.5 text-[10px] ${tierBadge.cls}`}>
                {tierBadge.text}
              </span>
            )}
          </div>
          {hwEval ? (
            <>
              {hwEval.summary}
              {hw && (
                <div className="mt-1 flex items-center gap-1 font-mono text-[10px] text-zinc-500">
                  <Cpu className="h-3 w-3" /> {hw.cpuModel} · {hw.cpuCores} 线程 · 可用内存 {hw.freeRamGb}G
                </div>
              )}
            </>
          ) : (
            '正在检测…'
          )}
        </div>

        {/* 模型库入口 */}
        <button
          onClick={() => setShowModels(true)}
          className="mb-3 flex w-full items-center gap-1.5 rounded-md border border-teal-500/25 bg-teal-500/[0.06] px-2.5 py-2 text-[11px] text-teal-300 transition-colors hover:bg-teal-500/15"
        >
          <Package className="h-3.5 w-3.5" /> 模型库：底模、LoRA、放大、修脸，一键下载
        </button>

        {/* 工作流列表：点几条就融合成一条流水线 */}
        <div className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
          {STAGES.map((stage) => (
            <div key={stage.id}>
              <div className="mb-1 flex items-baseline gap-2">
                <span className="text-[11px] font-medium text-zinc-300">{stage.name}</span>
                <span className="text-[10px] text-zinc-600">{stage.why}</span>
              </div>
              <div className="space-y-1">
                {WORKFLOWS.filter((w) => w.stage === stage.id).map((w) => {
                  const order = picked.indexOf(w.id)
                  const active = order >= 0
                  const lacked = hwEval && (w.needVram > hwEval.maxVramGb || w.needRam > hwEval.totalRamGb)
                  return (
                    <button
                      key={w.id}
                      onClick={() => toggleWorkflow(w)}
                      disabled={running}
                      title={`${w.desc}（约需 ${w.needVram}G 显存 / ${w.needRam}G 内存）`}
                      className={`w-full rounded-md border px-2.5 py-1.5 text-left transition-all disabled:opacity-50 ${
                        active
                          ? 'border-teal-400 bg-teal-400/15 shadow-[0_0_12px_rgba(45,212,191,0.2)]'
                          : 'border-zinc-800 bg-black/30 hover:border-teal-500/40'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {active && (
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-teal-400/25 font-mono text-[9px] font-bold text-teal-200">
                            {order + 1}
                          </span>
                        )}
                        <span className={`text-[11px] ${active ? 'text-teal-200' : 'text-zinc-300'}`}>{w.name}</span>
                        {w.viaApi && (
                          <span className="rounded border border-sky-500/40 bg-sky-500/10 px-1 text-[9px] text-sky-300">云端</span>
                        )}
                        {w.trainer && (
                          <span className="rounded border border-violet-500/40 bg-violet-500/10 px-1 text-[9px] text-violet-300">训练</span>
                        )}
                        {lacked && <span className="rounded border border-amber-500/40 px-1 text-[9px] text-amber-400">配置吃紧</span>}
                        {active && <CircleCheck className="ml-auto h-3 w-3 text-teal-300" />}
                      </div>
                      <div className="mt-0.5 text-[10px] text-zinc-500">{w.desc}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- 中：参数 + 流水线 ---- */}
      <section className="h-fit rounded-lg border border-teal-500/15 bg-white/[0.02] p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Wand2 className="h-4 w-4 text-teal-400" />
          参数
        </h2>

        {/* 绘图 API 常驻配置：云端工作流随时可用，与文生图页是同一份 */}
        <div className="mb-3 rounded-md border border-teal-500/20 bg-teal-500/[0.04] p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-teal-300">
            <Activity className="h-3 w-3" /> 绘图 API（与文生图页共用同一份，改哪边都生效）
            <span
              className={`ml-auto rounded-full border px-1.5 py-0.5 text-[10px] ${
                apiCfg.baseUrl && apiCfg.apiKey && apiCfg.model
                  ? 'border-teal-500/40 bg-teal-500/10 text-teal-300'
                  : 'border-zinc-700 text-zinc-500'
              }`}
            >
              {apiCfg.baseUrl && apiCfg.apiKey && apiCfg.model ? '已配置' : '未配置'}
            </span>
          </div>
          <div className="space-y-1.5">
            <input
              value={apiCfg.baseUrl}
              onChange={(e) => patchApiCfg({ baseUrl: e.target.value })}
              placeholder="API 地址，比如 https://api.example.com/v1"
              className="w-full rounded-md border border-zinc-700 bg-black/40 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-teal-400"
            />
            <div className="flex gap-1.5">
              <input
                value={apiCfg.apiKey}
                onChange={(e) => patchApiCfg({ apiKey: e.target.value })}
                placeholder="密钥 sk-..."
                type="password"
                className="w-full rounded-md border border-zinc-700 bg-black/40 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-teal-400"
              />
              <input
                value={apiCfg.model}
                onChange={(e) => patchApiCfg({ model: e.target.value })}
                placeholder="模型名"
                list="wf-api-models"
                className="w-full rounded-md border border-zinc-700 bg-black/40 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-teal-400"
              />
              <datalist id="wf-api-models">
                {apiModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <button
                onClick={pullApiModels}
                disabled={apiModelsBusy}
                className="shrink-0 rounded-md border border-zinc-700 px-2 text-[10px] text-zinc-400 transition-colors hover:border-teal-500/50 hover:text-teal-300 disabled:opacity-40"
              >
                {apiModelsBusy ? '拉取中…' : '拉取模型'}
              </button>
            </div>
            {apiModelsNote && <p className="text-[10px] text-zinc-500">{apiModelsNote}</p>}
            <input
              value={apiCfg.extras || ''}
              onChange={(e) => patchApiCfg({ extras: e.target.value })}
              placeholder='附加参数（可选 JSON）：{"vae":"...","loras":["..."]}，原样发给服务商'
              className="w-full rounded-md border border-zinc-700 bg-black/40 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-teal-400"
            />
            {/* 附加模型：VAE / LoRA，填了就自动拼进请求体，不用手写 JSON */}
            <div className="grid grid-cols-2 gap-1.5">
              <input
                value={apiVae}
                onChange={(e) => setApiVae(e.target.value)}
                placeholder="VAE 文件名（可选，如 vae-ft-mse.safetensors）"
                className="w-full rounded-md border border-zinc-700 bg-black/40 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-teal-400"
              />
              <div className="flex gap-1.5">
                <input
                  value={apiLoraName}
                  onChange={(e) => setApiLoraName(e.target.value)}
                  placeholder="LoRA 名（可选）"
                  className="w-full rounded-md border border-zinc-700 bg-black/40 px-2.5 py-1.5 font-mono text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-teal-400"
                />
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.05}
                  value={apiLoraStrength}
                  onChange={(e) => setApiLoraStrength(Math.max(0, Math.min(2, Number(e.target.value) || 0)))}
                  title="LoRA 强度"
                  className="w-16 shrink-0 rounded-md border border-zinc-700 bg-black/40 px-1.5 py-1.5 font-mono text-[11px] text-zinc-200 outline-none focus:border-teal-400"
                />
              </div>
            </div>
            <p className="text-[10px] leading-relaxed text-zinc-500">
              VAE / LoRA 能不能生效取决于服务商的接口，大部分中转站会原样收下（发的是 vae、loras、lora_name、lora_strength 这几个字段）。
            </p>
          </div>
        </div>

        <label className="mb-1 block text-xs text-zinc-400">提示词</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          placeholder="英文提示词，或点下方按钮带入当前描述"
          className="mb-1 w-full resize-none rounded-md border border-zinc-700 bg-black/40 px-3 py-2 font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-teal-400"
        />
        {importedPrompt && (
          <button
            onClick={() => setPrompt(importedPrompt)}
            className="mb-2 text-[10px] text-teal-400 underline underline-offset-2 hover:text-teal-300"
          >
            带入画面描述页的当前提示词
          </button>
        )}

        {/* DS 帮写提示词 */}
        <div className="mb-3 mt-1.5 rounded-md border border-teal-500/20 bg-teal-500/[0.04] p-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-teal-300">
            <Brain className="h-3 w-3" /> DS 帮写提示词
            <span
              className={`ml-auto rounded-full border px-1.5 py-0.5 text-[10px] ${
                dsReady ? 'border-teal-500/40 bg-teal-500/10 text-teal-300' : 'border-zinc-700 text-zinc-500'
              }`}
            >
              {dsReady ? 'DS 就绪' : 'DS 未就绪'}
            </span>
          </div>
          <div className="flex gap-1.5">
            <input
              value={dsIdea}
              onChange={(e) => setDsIdea(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !dsBusy) dsWrite()
              }}
              placeholder="大白话，比如：哥特少女在房间抽烟"
              className="w-full rounded-md border border-zinc-700 bg-black/40 px-2.5 py-1.5 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-teal-400"
            />
            <button
              onClick={dsWrite}
              disabled={dsBusy || !dsReady}
              className="shrink-0 rounded-md bg-teal-500/90 px-3 text-[11px] font-medium text-black transition-colors hover:bg-teal-400 disabled:opacity-40"
            >
              {dsBusy ? '写着…' : '帮写'}
            </button>
          </div>
          {dsNote && <p className="mt-1 text-[10px] text-amber-300">{dsNote}</p>}
        </div>

        <label className="mb-1 mt-2 block text-xs text-zinc-400">反向提示词（可留空）</label>
        <input
          value={negative}
          onChange={(e) => setNegative(e.target.value)}
          placeholder="不希望出现的内容"
          className="mb-3 w-full rounded-md border border-zinc-700 bg-black/40 px-3 py-2 font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-teal-400"
        />

        {/* 模型选择：清单从 ComfyUI 实时拉 */}
        <div className="grid grid-cols-2 gap-2">
          <ModelSelect label="底模 Checkpoint" value={ckpt} onChange={setCkpt} options={models?.checkpoints || []} />
          <ModelSelect label="LoRA（LoRA 工作流用）" value={lora} onChange={setLora} options={models?.loras || []} />
          <ModelSelect label="ControlNet 模型" value={controlnet} onChange={setControlnet} options={models?.controlnets || []} />
          <ModelSelect label="放大模型" value={upscaleModel} onChange={setUpscaleModel} options={models?.upscaleModels || []} />
          <ModelSelect label="Flux UNET" value={unet} onChange={setUnet} options={models?.unets || []} />
          <ModelSelect label="Flux VAE" value={vae} onChange={setVae} options={models?.vaes || []} />
          <ModelSelect label="Flux CLIP 1" value={clip1} onChange={setClip1} options={models?.clips || []} />
          <ModelSelect label="Flux CLIP 2" value={clip2} onChange={setClip2} options={models?.clips || []} />
        </div>

        <div className="mt-2 grid grid-cols-4 gap-2">
          <label className="text-[11px] text-zinc-400">
            尺寸
            <select
              value={sizeIdx}
              onChange={(e) => setSizeIdx(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-black/40 px-2 py-1.5 font-mono text-[11px] text-zinc-200 outline-none focus:border-teal-400"
            >
              {SIZE_OPTIONS.map(([w, h], i) => (
                <option key={i} value={i}>
                  {w}x{h}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[11px] text-zinc-400">
            步数
            <input
              type="number"
              value={steps}
              min={1}
              max={60}
              onChange={(e) => setSteps(Math.max(1, Math.min(60, Number(e.target.value) || 20)))}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-black/40 px-2 py-1.5 font-mono text-[11px] text-zinc-200 outline-none focus:border-teal-400"
            />
          </label>
          <label className="text-[11px] text-zinc-400">
            CFG
            <input
              type="number"
              value={cfg}
              min={1}
              max={20}
              step={0.5}
              onChange={(e) => setCfg(Number(e.target.value) || 7)}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-black/40 px-2 py-1.5 font-mono text-[11px] text-zinc-200 outline-none focus:border-teal-400"
            />
          </label>
          <label className="text-[11px] text-zinc-400">
            LoRA 强度
            <input
              type="number"
              value={loraStrength}
              min={0}
              max={2}
              step={0.1}
              onChange={(e) => setLoraStrength(Math.max(0, Math.min(2, Number(e.target.value) || 0)))}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-black/40 px-2 py-1.5 font-mono text-[11px] text-zinc-200 outline-none focus:border-teal-400"
            />
          </label>
          <label className="text-[11px] text-zinc-400">
            种子（-1 随机）
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-zinc-700 bg-black/40 px-2 py-1.5 font-mono text-[11px] text-zinc-200 outline-none focus:border-teal-400"
            />
          </label>
        </div>

        {/* 参考图 */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) pickRef(f)
            e.target.value = ''
          }}
        />
        <div className="mt-3">
          {refImage ? (
            <div className="flex items-center gap-2 rounded-md border border-teal-500/30 bg-teal-500/5 p-2">
              <img src={refImage.preview} alt="参考图" className="h-12 w-12 rounded border border-zinc-700 object-cover" />
              <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">{refImage.file.name}</span>
              <button onClick={() => setRefImage(null)} className="rounded p-1 text-zinc-500 hover:text-red-400" title="移除">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-zinc-700 px-3 py-2.5 text-[11px] text-zinc-500 transition-colors hover:border-teal-500/50 hover:text-teal-300"
            >
              <ImagePlus className="h-3.5 w-3.5" /> 上传参考图（图生图 / 修复 / 放大类工作流用，ControlNet 控制图也用这张）
            </button>
          )}
        </div>

        {/* 流水线预览：选两条以上就是融合，按点选顺序接起来 */}
        <div className="mt-3 rounded-md border border-zinc-700/80 bg-black/40 p-3">
          <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
            执行流水线
            {chain.length > 1 && (
              <span className="rounded border border-teal-500/40 bg-teal-500/10 px-1.5 py-0.5 normal-case text-teal-300">
                融合 {chain.length} 条
              </span>
            )}
          </div>
          {chain.length === 0 ? (
            <p className="text-[11px] text-zinc-600">
              在左侧点一条就是单独跑，在左侧点选两条及以上将自动融合成一条流水线
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {chain.map((w, i) => (
                <span key={w.id} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-zinc-600">→</span>}
                  <span className="flex items-center gap-1 rounded-full border border-teal-500/40 bg-teal-500/10 px-2 py-0.5 text-[10px] text-teal-200">
                    <span className="font-mono text-teal-400/80">{i + 1}</span>
                    {w.name}
                  </span>
                </span>
              ))}
            </div>
          )}
          {chain.length > 1 && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-500">
              后一条会拿前一条的成品当底再画一遍（纯文生图那类自动改成低强度重绘），画布上看到的就是合起来的整张图
            </p>
          )}
        </div>

        {/* LoRA 训练：选到「模型训练」阶段的工作流才展开 */}
        {chain.some((w) => w.trainer) && (
          <div className="mt-3 rounded-md border border-violet-500/30 bg-violet-500/[0.05] p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-violet-200">
              <Brain className="h-3 w-3" /> LoRA 训练
              <span
                className={`ml-auto rounded-full border px-1.5 py-0.5 text-[10px] ${
                  trainEnv?.ready
                    ? 'border-teal-500/40 bg-teal-500/10 text-teal-300'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                }`}
              >
                {trainEnv?.ready ? '训练环境就绪' : '训练环境未准备'}
              </span>
            </div>
            <p className="mb-2 text-[10px] leading-relaxed text-zinc-400">
              复用 ComfyUI 内置 Python 环境运行 sd-scripts 训练框架。请选择训练图像目录（支持自动读取同名 .txt 标注），训练成果将直接输出至 models/loras。
            </p>

            <button
              onClick={pickDataset}
              className="mb-1.5 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-zinc-700 px-3 py-2 text-[11px] text-zinc-400 transition-colors hover:border-violet-400/60 hover:text-violet-200"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {dsDir || '选择训练图像文件夹（至少 3 张，建议 15 张以上）'}
            </button>

            <div className="grid grid-cols-3 gap-1.5">
              <label className="text-[10px] text-zinc-400">
                输出名
                <input
                  value={trName}
                  onChange={(e) => setTrName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-black/40 px-1.5 py-1 font-mono text-[11px] text-zinc-200 outline-none focus:border-violet-400"
                />
              </label>
              <label className="text-[10px] text-zinc-400">
                触发词
                <input
                  value={trActivation}
                  onChange={(e) => setTrActivation(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-black/40 px-1.5 py-1 font-mono text-[11px] text-zinc-200 outline-none focus:border-violet-400"
                />
              </label>
              <label className="text-[10px] text-zinc-400">
                分辨率
                <select
                  value={trRes}
                  onChange={(e) => setTrRes(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-black/40 px-1.5 py-1 font-mono text-[11px] text-zinc-200 outline-none focus:border-violet-400"
                >
                  {[512, 768, 1024].map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[10px] text-zinc-400">
                轮数
                <input
                  type="number"
                  min={1}
                  value={trEpochs}
                  onChange={(e) => setTrEpochs(Math.max(1, Number(e.target.value) || 10))}
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-black/40 px-1.5 py-1 font-mono text-[11px] text-zinc-200 outline-none focus:border-violet-400"
                />
              </label>
              <label className="text-[10px] text-zinc-400">
                dim
                <input
                  type="number"
                  min={4}
                  step={4}
                  value={trDim}
                  onChange={(e) => setTrDim(Math.max(4, Number(e.target.value) || 32))}
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-black/40 px-1.5 py-1 font-mono text-[11px] text-zinc-200 outline-none focus:border-violet-400"
                />
              </label>
              <label className="text-[10px] text-zinc-400">
                学习率
                <input
                  type="number"
                  step={0.00005}
                  value={trLr}
                  onChange={(e) => setTrLr(Number(e.target.value) || 0.0001)}
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-black/40 px-1.5 py-1 font-mono text-[11px] text-zinc-200 outline-none focus:border-violet-400"
                />
              </label>
            </div>

            <input
              value={trCaption}
              onChange={(e) => setTrCaption(e.target.value)}
              placeholder="默认标注词（留空则使用触发词；若存在同名 .txt 时优先用你自己的）"
              className="mt-1.5 w-full rounded-md border border-zinc-700 bg-black/40 px-2 py-1 font-mono text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-400"
            />

            <label className="mt-1.5 flex items-center gap-1.5 text-[10px] text-zinc-400">
              <input type="checkbox" checked={trLowVram} onChange={(e) => setTrLowVram(e.target.checked)} />
              显存紧（开低显存模式，慢一点但不容易炸）
            </label>

            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                onClick={setupTrain}
                disabled={!!trainBusy}
                className="rounded-md border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 transition-colors hover:border-violet-400/60 hover:text-violet-200 disabled:opacity-40"
              >
                {trainEnv?.ready ? '重装训练环境' : '准备训练环境'}
              </button>
              <button
                onClick={startTrain}
                disabled={!!trainBusy || !trainEnv?.ready}
                className="rounded-md border border-violet-400/60 bg-violet-400/15 px-3 py-1 text-[10px] font-medium text-violet-100 transition-colors hover:bg-violet-400/25 disabled:opacity-40"
              >
                {trainBusy === '训练中' ? '训练中…' : '开始训练'}
              </button>
              <button
                onClick={stopTrain}
                disabled={trainBusy !== '训练中'}
                className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-40"
              >
                停止
              </button>
              <button
                onClick={() => trainReveal()}
                className="rounded-md border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 transition-colors hover:text-violet-200"
              >
                打开输出目录
              </button>
            </div>

            {trainBusy && trainBusy !== '训练中' && (
              <p className="mt-1.5 flex items-center gap-1 text-[10px] text-violet-200">
                <Loader2 className="h-3 w-3 animate-spin" /> {trainBusy}
                {trainProg?.label ? ` · ${trainProg.label}` : ''}
              </p>
            )}
            {trainLog && (
              <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-md border border-zinc-800 bg-black/60 p-2 font-mono text-[10px] leading-relaxed text-zinc-400">
                {trainLog.slice(-4000)}
              </pre>
            )}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          {running ? (
            <button
              onClick={stopRun}
              className="ml-auto flex items-center gap-2 rounded-md border border-red-500/50 bg-red-500/10 px-5 py-2 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/20"
            >
              <Square className="h-4 w-4" /> 停止
            </button>
          ) : advanced ? (
            <p className="ml-auto text-[11px] leading-relaxed text-zinc-500">
              高级模式里不重复放运行按钮，直接在画布右上角点「运行」
            </p>
          ) : (
            <button
              onClick={runChain}
              className="ml-auto flex items-center gap-2 rounded-md border border-teal-400/60 bg-teal-400/15 px-5 py-2 text-sm font-semibold text-teal-200 shadow-[0_0_20px_rgba(45,212,191,0.2)] transition-all hover:bg-teal-400/25"
            >
              <Play className="h-4 w-4" /> 运行流水线
            </button>
          )}
        </div>

        {errorMsg && (
          <div className="mt-2 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5">
            <p className="text-[11px] leading-relaxed text-red-300">{errorMsg}</p>
            {comfyLog && (
              <button
                onClick={() => openComfyLog()}
                className="mt-1 flex items-center gap-1 text-[10px] text-red-200/70 underline-offset-2 hover:text-red-200 hover:underline"
              >
                <FileText className="h-3 w-3" /> 打开部署日志（排错用）
              </button>
            )}
          </div>
        )}
      </section>

      {/* ---- 右：流水线进度 + 最终结果（标准模式一直在这儿）---- */}
      <section className="flex flex-col gap-4">
        <div className="rounded-lg border border-teal-500/15 bg-white/[0.02] p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <Activity className="h-4 w-4 text-teal-400" />
            流水线状态
          </h2>
          {stageRuns.length === 0 ? (
            <p className="text-[11px] text-zinc-600">// 就绪</p>
          ) : (
            <div className="space-y-1.5">
              {stageRuns.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2 rounded border border-zinc-800 bg-black/30 px-2.5 py-1.5">
                  <span className="font-mono text-[10px] text-zinc-600">{i + 1}</span>
                  <span className="text-[11px] text-zinc-300">{s.name}</span>
                  <span className="ml-auto flex items-center gap-1 text-[10px]">
                    {s.status === 'wait' && <span className="text-zinc-500">排队中</span>}
                    {s.status === 'run' && (
                      <span className="flex items-center gap-1 text-teal-300">
                        <Loader2 className="h-3 w-3 animate-spin" /> 执行中
                      </span>
                    )}
                    {s.status === 'done' && (
                      <span className="flex items-center gap-1 text-teal-400">
                        <CircleCheck className="h-3 w-3" /> {((s.ms || 0) / 1000).toFixed(1)}s
                      </span>
                    )}
                    {s.status === 'fail' && <span className="text-red-400">失败</span>}
                  </span>
                  {s.thumb && <img src={s.thumb} alt="" className="h-8 w-8 rounded border border-zinc-700 object-cover" />}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 rounded-lg border border-teal-500/15 bg-white/[0.02] p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <ImageIcon className="h-4 w-4 text-teal-400" />
            最终结果
          </h2>
          {finalImage ? (
            <div className="overflow-hidden rounded-md border border-zinc-700">
              <img src={finalImage} alt="结果" className="block w-full object-contain" />
            </div>
          ) : (
            <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-zinc-700 text-zinc-600">
              <ImageIcon className="h-8 w-8" />
              <span className="text-xs">暂无结果</span>
            </div>
          )}
        </div>
      </section>

      {/* ---- 高级模式：从右边拉开的帷幕，里面是 ComfyUI 原版界面 ---- */}
      {advanced && (
        <div
          className="fixed bottom-0 right-0 z-[45] flex"
          style={{ top: '64px', width: curtainW }}
          onPointerMove={onCurtainMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div
            onPointerDown={startDrag}
            title="拖动调整宽度"
            className="group relative w-2.5 shrink-0 cursor-col-resize bg-gradient-to-b from-teal-400/50 via-teal-400/15 to-teal-400/50 transition-colors hover:from-teal-300 hover:via-teal-300/40 hover:to-teal-300"
          >
            <span className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/50 group-hover:bg-black/70" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col border-l border-teal-500/25 bg-[#050a0a]/95 shadow-[-30px_0_60px_rgba(0,0,0,0.55)]">
            <div className="flex items-center gap-2 border-b border-teal-500/15 px-3 py-1.5 text-[11px] text-zinc-400">
              <Monitor className="h-3.5 w-3.5 text-teal-400" />
              高级模式 · ComfyUI 原版节点界面
              {running && (
                <span className="flex items-center gap-1 text-teal-300">
                  <Loader2 className="h-3 w-3 animate-spin" /> 执行中
                </span>
              )}
              <span
                className={`ml-auto truncate font-mono text-[10px] ${
                  canvasNote.includes('没接住') ? 'text-amber-300' : 'text-teal-300/80'
                }`}
              >
                {canvasNote || '左边切预设，这里跟着换'}
              </span>
              <button
                onClick={() => setCurtainW(clampCurtain(window.innerWidth * 0.56))}
                className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:border-teal-500/50 hover:text-teal-300"
                title="恢复默认宽度"
              >
                默认
              </button>
              <button
                onClick={() => onAdvancedChange?.(false)}
                className="flex items-center gap-1 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:border-red-500/50 hover:text-red-300"
                title="点击或按 Shift + F7）"
              >
                <X className="h-3 w-3" /> 收起
              </button>
            </div>

            {/* 帷幕里也把流水线摊出来：参数面板被盖住了，这里得看得见 */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-teal-500/15 bg-black/40 px-3 py-1.5 text-[10px]">
              <span className="font-mono uppercase tracking-widest text-zinc-500">执行流水线</span>
              {chain.length > 1 && (
                <span className="rounded border border-teal-500/40 bg-teal-500/10 px-1.5 py-0.5 text-teal-300">
                  融合 {chain.length} 条
                </span>
              )}
              {chain.length === 0 ? (
                <span className="text-zinc-600">在左侧点选两条及以上将自动融合</span>
              ) : (
                chain.map((w, i) => (
                  <span key={w.id} className="flex items-center gap-1">
                    {i > 0 && <span className="text-zinc-600">→</span>}
                    <span className="flex items-center gap-1 rounded-full border border-teal-500/40 bg-teal-500/10 px-2 py-0.5 text-teal-200">
                      <span className="font-mono text-teal-400/80">{i + 1}</span>
                      {w.name}
                    </span>
                  </span>
                ))
              )}
              <span className="ml-auto shrink-0 text-zinc-600">画布右上角点「运行」执行</span>
            </div>

            {errorMsg && (
              <div className="flex items-start gap-2 border-b border-red-500/30 bg-red-500/10 px-3 py-1.5">
                <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-red-300">{errorMsg}</p>
                {comfyLog && (
                  <button
                    onClick={() => openComfyLog()}
                    className="flex shrink-0 items-center gap-1 text-[10px] text-red-200/70 underline-offset-2 hover:text-red-200 hover:underline"
                  >
                    <FileText className="h-3 w-3" /> 日志
                  </button>
                )}
              </div>
            )}
            {comfy?.online ? (
              <div className="flex min-h-0 flex-1 flex-col">
                {/* 内置浏览器的工具条：前进后退、刷新、回到 ComfyUI、地址栏 */}
                <div className="flex items-center gap-1 border-b border-teal-500/10 bg-black/40 px-2 py-1">
                  <button
                    onClick={navBack}
                    disabled={!canBack}
                    title="后退"
                    className="rounded p-1 text-zinc-400 transition-colors hover:text-teal-300 disabled:opacity-30"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={navForward}
                    disabled={!canForward}
                    title="前进"
                    className="rounded p-1 text-zinc-400 transition-colors hover:text-teal-300 disabled:opacity-30"
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={navReload}
                    title="刷新"
                    className="rounded p-1 text-zinc-400 transition-colors hover:text-teal-300"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={navHome}
                    title="回到 ComfyUI"
                    className="rounded p-1 text-zinc-400 transition-colors hover:text-teal-300"
                  >
                    <Home className="h-3.5 w-3.5" />
                  </button>
                  <input
                    value={addr}
                    onChange={(e) => setAddr(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') goAddr()
                    }}
                    placeholder={base}
                    spellCheck={false}
                    className="min-w-0 flex-1 rounded border border-zinc-700 bg-black/50 px-2 py-0.5 font-mono text-[10px] text-zinc-300 outline-none placeholder:text-zinc-600 focus:border-teal-400"
                  />
                </div>
                {createElement('webview', {
                  ref: frameRef,
                  src: base,
                  // webview 是自定义元素，默认只有 150px 高，这里直接把尺寸写死成撑满剩余空间
                  className: 'block bg-black',
                  style: { flex: '1 1 0%', minHeight: 0, width: '100%', height: '100%', display: 'flex' },
                  allowpopups: 'true',
                })}
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-zinc-500">
                {engine?.state === 'preparing' || engine?.state === 'starting' ? (
                  <>
                    <Loader2 className="h-7 w-7 animate-spin text-teal-400" />
                    <p className="text-xs text-zinc-300">{engineProg?.label || 'ComfyUI 正在后台启动…'}</p>
                    {typeof engineProg?.percent === 'number' && (
                      <div className="h-1.5 w-56 overflow-hidden rounded-full bg-black/50">
                        <div className="h-full bg-teal-400 transition-all" style={{ width: `${Math.max(2, engineProg.percent * 100)}%` }} />
                      </div>
                    )}
                  </>
                ) : engine?.installed ? (
                  <>
                    <CircleAlert className="h-7 w-7" />
                    <p className="max-w-xs text-xs leading-relaxed">
                      ComfyUI 点击启动后将在后台运行，不占用主界面空间。
                    </p>
                    <button
                      onClick={engineStart}
                      disabled={engineBusy}
                      className="rounded-md border border-teal-400/60 bg-teal-400/15 px-4 py-1.5 text-xs font-medium text-teal-200 transition-colors hover:bg-teal-400/25 disabled:opacity-40"
                    >
                      {engineBusy ? '正在启动…' : '启动 ComfyUI'}
                    </button>
                    {engine?.error && <p className="max-w-sm text-[10px] text-red-300/80">{engine.error}</p>}
                  </>
                ) : (
                  <>
                    <CircleAlert className="h-7 w-7" />
                    <p className="max-w-xs text-xs leading-relaxed">
                      请先部署 ComfyUI「一键部署」，装好之后它会在后台自己跑，这里就是原版画布。
                    </p>
                  </>
                )}
                <button
                  onClick={() => detect()}
                  className="flex items-center gap-1 rounded-md border border-zinc-700 px-3 py-1 text-[11px] text-zinc-400 transition-colors hover:border-teal-500/50 hover:text-teal-300"
                >
                  <RefreshCw className="h-3 w-3" /> 重新检测
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VC 运行库询问：缺了先问装不装；Windows 更新关着会给警告 */}
      {vcAsk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[420px] rounded-lg border border-amber-500/30 bg-[#0a1414] p-5 shadow-[0_0_50px_rgba(245,158,11,0.15)]">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <CircleAlert className="h-4 w-4 text-amber-400" /> 缺少 Visual C++ 运行库
            </h3>
            <p className="mt-3 text-xs leading-relaxed text-zinc-400">
              ComfyUI 系统组件。是否立即自动下载并安装？安装完成后将同步尝试停用 Windows 自动更新服务，防止系统自动重启中断渲染任务。
            </p>
            {vcAsk.wu.disabled && (
              <p className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-red-300">
                检测到系统已停用 Windows Update 服务，可能影响运行库安装程序执行。您可尝试点击「仍要安装」试试，装不上再跳过。
              </p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                onClick={vcInstallThenDeploy}
                disabled={vcBusy}
                className="flex-1 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
              >
                {vcBusy ? '正在安装运行库…' : vcAsk.wu.disabled ? '仍要安装' : '自动安装并继续部署'}
              </button>
              <button
                onClick={() => {
                  setVcAsk(null)
                  doEngineInstall()
                }}
                disabled={vcBusy}
                className="flex-1 rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition-colors hover:text-zinc-200 disabled:opacity-40"
              >
                跳过，直接部署
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 续传询问：上次下载被打断，问要不要接着下 */}
      {resumeAsk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[420px] rounded-lg border border-teal-500/30 bg-[#0a1414] p-5 shadow-[0_0_50px_rgba(45,212,191,0.15)]">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Download className="h-4 w-4 text-teal-400" /> 检测到未完成的 ComfyUI 下载任务
            </h3>
            <p className="mt-3 text-xs leading-relaxed text-zinc-400">
              上次的下载被打断了（关软件、断网都可能）。已下载的部分还在磁盘上，接着下不用从头再来。
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => {
                  setResumeAsk(false)
                  engineInstall()
                }}
                className="flex-1 rounded-md border border-teal-400/60 bg-teal-400/15 px-3 py-2 text-xs font-medium text-teal-200 transition-colors hover:bg-teal-400/25"
              >
                接着下载
              </button>
              <button
                onClick={() => {
                  setResumeAsk(false)
                  comfyEnginePurge()?.then((s) => s && setEngine(s))
                }}
                className="flex-1 rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition-colors hover:text-amber-300"
              >
                清除重下
              </button>
              <button
                onClick={() => setResumeAsk(false)}
                className="rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-500 transition-colors hover:text-zinc-200"
              >
                以后再说
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 硬件警告弹窗：风格与关闭询问卡片一致 */}
      {warnFor && hwEval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[420px] rounded-lg border border-amber-500/30 bg-[#0a1414] p-5 shadow-[0_0_50px_rgba(245,158,11,0.15)]">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <CircleAlert className="h-4 w-4 text-amber-400" /> 当前硬件配置可能无法流畅运行此工作流
            </h3>
            <p className="mt-3 text-xs leading-relaxed text-zinc-400">
              「{warnFor.name}」建议至少 <span className="text-amber-300">{warnFor.needVram}G 显存 / {warnFor.needRam}G 内存</span>，
              检测到本机为 <span className="text-amber-300">{hwEval.maxVramGb}G 显存 / {hwEval.totalRamGb}G 内存</span>。
              强行启用可能很慢，甚至跑到一半报错。
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => {
                  setPicked((prev) => (prev.includes(warnFor.id) ? prev : [...prev, warnFor.id]))
                  setPreviewWf(warnFor.id)
                  setWarnFor(null)
                }}
                className="flex-1 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/20"
              >
                仍要启用
              </button>
              <button
                onClick={() => setWarnFor(null)}
                className="flex-1 rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
              >
                换一条轻的
              </button>
            </div>
          </div>
        </div>
      )}

      {showModels && (
        <ModelHubModal
          onClose={() => setShowModels(false)}
          onChanged={() => detect()}
          deployed={!!engine?.installed}
        />
      )}
    </>
  )
}

function ModelSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const filtered = query.trim()
    ? options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()))
    : options
  return (
    <div className="relative block text-[11px] text-zinc-400">
      <span className="flex items-baseline gap-1">
        {label}
        {options.length > 0 && <span className="font-mono text-[9px] text-zinc-600">{options.length} 个可选</span>}
      </span>
      <div className="mt-1 flex gap-1">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={options.length ? '点击右侧按钮从列表选择，或手动输入文件名' : '手动输入文件名'}
          className="w-full min-w-0 rounded-md border border-zinc-700 bg-black/40 px-2 py-1.5 font-mono text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-teal-400"
        />
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v)
            setQuery('')
          }}
          title="从已安装模型列表中选择"
          className="shrink-0 rounded-md border border-zinc-700 px-1.5 text-zinc-400 transition-colors hover:border-teal-500/50 hover:text-teal-300"
        >
          <Search className="h-3.5 w-3.5" />
        </button>
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-hidden rounded-md border border-teal-500/30 bg-[#0a1414] shadow-[0_10px_30px_rgba(0,0,0,0.6)]">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜文件名…"
            className="w-full border-b border-zinc-800 bg-black/50 px-2 py-1.5 font-mono text-[10px] text-zinc-200 outline-none placeholder:text-zinc-600"
          />
          <div className="max-h-44 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-2 py-2 text-[10px] leading-relaxed text-zinc-500">
                {options.length === 0 ? '还没扫到模型。去上面「模型库」下载或手动输入文件名' : '没有匹配的文件名'}
              </p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => {
                    onChange(o)
                    setOpen(false)
                  }}
                  className={`block w-full truncate px-2 py-1 text-left font-mono text-[10px] transition-colors hover:bg-teal-500/15 hover:text-teal-200 ${
                    o === value ? 'text-teal-300' : 'text-zinc-300'
                  }`}
                >
                  {o}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
