import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Brain,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Clock,
  Copy,
  Crown,
  Download,
  Eye,
  EyeOff,
  Heart,
  ImageIcon,
  ImagePlus,
  Info,
  KeyRound,
  Layers,
  Link2,
  ListChecks,
  Loader2,
  Lock,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  Wallet,
  Wand2,
  X,
} from 'lucide-react'
import TechBackground from '../components/TechBackground'
import SettingsModal from '../components/SettingsModal'
import QaModal from '../components/QaModal'
import DonateModal from '../components/DonateModal'
import WorkflowPanel from '../components/WorkflowPanel'
import { comfyDownloadState, comfyEngineInstall, comfyEnginePurge, onComfyResumeAvailable } from '../lib/comfyui'
import {
  checkStatus,
  editImage,
  generateImage,
  getBalance,
  getNormalizedBase,
  listModels,
  type ApiConfig,
  type ApiStatus,
  type BalanceInfo,
} from '../lib/api'
import { PROMPT_CATEGORIES } from '../lib/prompts'
import { analyzeText } from '../lib/analyze'
import { FORM_SYSTEM_PROMPT, POLISH_SYSTEM_PROMPT } from '../lib/aiBrain'
import { fetchImageToDir, saveImageToDir } from '../lib/settings'
import { PROVIDERS, findProvider, guessProvider, normalizeProviderId, providerMismatch } from '../lib/providers'
import {
  chatAi,
  getAiStatus,
  hasAiBridge,
  installAi,
  onAiProgress,
  onAiStatus,
  onCloseRequest,
  respondClose,
  startAi,
  uninstallAi,
  type AiProgress,
  type AiStatus,
  type ChatMessage,
} from '../lib/localLlm'
import '../App.css'

const SIZES = ['1024x1024', '1024x1536', '1536x1024', '2048x2048', '2048x1152', '1152x2048']
const QUALITIES = ['high', 'medium', 'low']

const CONFIG_KEY = 'lin-toolbox-config'
const PROVIDER_KEY = 'lin-toolbox-provider'

type JobPhase = 'idle' | 'running' | 'done' | 'error'

interface HistoryItem {
  id: number
  imageData: string
  prompt: string
  size: string
  elapsedMs: number
}

/** 本地 AI 找到的一个缺漏项：名称 + 一句说明 + 候选词 */
interface AiFormField {
  name: string
  why: string
  options: { label: string; en: string }[]
}

/** AI 表单字段在 selected 里的键，加个前缀免得和规则补词的键撞上 */
const aiFieldKey = (name: string) => `ai:${name}`

/** 小模型回话常见的三种毛病：一段一个 {"fields":[...]} 地吐好几段、JSON 里带没转义的引号、
    选项直接写成字符串。这里统统接住：逐段抠、逐段救、逐条洗，最后按名字合并去重。
    返回 null 表示一个能用的 field 都没抠出来。truncated 表示有被掐断/救过的痕迹。 */
const hasCJK = (s: string) => /[一-鿿]/.test(s)

/** 洗掉模型乱加的转义、首尾引号和空白 */
function cleanStr(s: string): string {
  return s
    .replace(/\\"/g, '"')
    .replace(/\\n/g, ' ')
    .replace(/^[\s"'`\\]+|[\s"'`\\]+$/g, '')
    .trim()
}

/** 从一个选项的原始碎片里抠 label 和 en，容忍缺冒号、en_phrase、垃圾引号 */
function parseOptionBlob(blob: string): { label: string; en: string } | null {
  const labelM = /"label"\s*:?\s*"((?:[^"\\]|\\.)*)"/.exec(blob)
  const enM = /"en(?:_phrase)?"\s*:?\s*"((?:[^"\\]|\\.)*)"/.exec(blob)
  const label = labelM ? cleanStr(labelM[1]) : ''
  let en = enM ? cleanStr(enM[1]) : ''
  if (hasCJK(en)) en = '' // en 里混中文的直接废掉，省得污染最终提示词
  if (!label && !en) return null
  return { label: label || en, en: en || label }
}

/** 从一段文本里抠 field，能 JSON.parse 就 parse，不能就正则硬抠 */
function extractFields(seg: string, sink: AiFormField[]): void {
  const cleaned = seg.replace(/```[a-z]*/gi, '').trim()
  if (!cleaned) return
  // 先整段试解析（含截尾回退 + 补全括号）
  for (let end = cleaned.lastIndexOf('}'); end > 0; end = cleaned.lastIndexOf('}', end - 1)) {
    const head = cleaned.slice(0, end + 1)
    for (const suffix of ['', ']}', ']}]', '}]}', ']}]}', '}']) {
      try {
        const p = JSON.parse(head + suffix) as { fields?: unknown }
        if (p && Array.isArray(p.fields)) {
          for (const f of p.fields) pushField(f, sink)
          return
        }
      } catch {
        /* 换一种补法再试 */
      }
    }
  }
  // 正则硬抠："name":"..." ... "options":[...]
  const fieldRe = /"name"\s*:?\s*"((?:[^"\\]|\\.)*)"[\s\S]*?"options"\s*:?\s*\[([\s\S]*?)\]/g
  let fm: RegExpExecArray | null
  while ((fm = fieldRe.exec(cleaned))) {
    const name = cleanStr(fm[1])
    if (!name) continue
    const optsRaw = fm[2]
    const options: { label: string; en: string }[] = []
    const objRe = /\{([^{}]*)\}/g
    let om: RegExpExecArray | null
    let rest = optsRaw
    while ((om = objRe.exec(optsRaw))) {
      const opt = parseOptionBlob(om[1])
      if (opt) options.push(opt)
      rest = rest.replace(om[0], ' ')
    }
    // 纯字符串选项："深夜", "厨房"
    const strRe = /"((?:[^"\\]|\\.)*)"/g
    let sm: RegExpExecArray | null
    while ((sm = strRe.exec(rest))) {
      const v = cleanStr(sm[1])
      if (v) options.push({ label: v, en: v })
    }
    if (options.length) pushField({ name, why: '', options }, sink)
  }
}

/** 合并进表单：同名 field 合并选项，按 en/label 小写去重 */
function pushField(raw: unknown, sink: AiFormField[]): void {
  if (!raw || typeof raw !== 'object') return
  const f = raw as { name?: unknown; why?: unknown; options?: unknown }
  if (typeof f.name !== 'string' || !Array.isArray(f.options)) return
  const name = cleanStr(f.name)
  if (!name) return
  const why = typeof f.why === 'string' ? cleanStr(f.why) : ''
  const options: { label: string; en: string }[] = []
  for (const o of f.options) {
    if (typeof o === 'string') {
      const v = cleanStr(o)
      if (v) options.push({ label: v, en: v })
    } else if (o && typeof o === 'object') {
      const rec = o as Record<string, unknown>
      const label = cleanStr(String(rec.label ?? ''))
      let en = cleanStr(String(rec.en ?? rec.en_phrase ?? ''))
      if (hasCJK(en)) en = ''
      if (label || en) options.push({ label: label || en, en: en || label })
    }
  }
  if (!options.length) return
  const exist = sink.find((x) => x.name === name)
  const seen = new Set((exist?.options || []).map((o) => (o.en || o.label).toLowerCase()))
  const fresh = options.filter((o) => {
    const k = (o.en || o.label).toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  if (exist) {
    exist.options = [...exist.options, ...fresh].slice(0, 10)
    if (!exist.why && why) exist.why = why
  } else if (sink.length < 8) {
    sink.push({ name, why: why.length > 24 ? why.slice(0, 24) + '…' : why, options: fresh.slice(0, 10) })
  }
}

function salvageFieldsJson(rawText: string): { parsed: { fields?: AiFormField[] }; truncated: boolean } | null {
  const sink: AiFormField[] = []
  // 按 {"fields" 出现的位置切段（模型爱一段一个对象地吐）
  const starts: number[] = []
  const re = /\{\s*"fields"\s*:?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(rawText))) starts.push(m.index)
  if (starts.length === 0) {
    extractFields(rawText, sink)
  } else {
    for (let i = 0; i < starts.length; i++) {
      extractFields(rawText.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : undefined), sink)
    }
  }
  if (sink.length === 0) return null
  // 结尾收在 } 或 ]（允许带 ``` 尾巴）就算完整，否则视为被掐断
  const truncated = !/[}\]]\s*(```)?\s*$/.test(rawText.trim())
  return { parsed: { fields: sink }, truncated }
}

/** 本地模型回话收尾：去「Subject:」头、去首尾引号、压平空白 */
function cleanPolishText(s: string): string {
  return s
    .trim()
    .replace(/^(subject|prompt)\s*[:：]\s*/i, '')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function loadConfig(): ApiConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ApiConfig>
      return {
        baseUrl: parsed.baseUrl || '',
        apiKey: parsed.apiKey || '',
        model: parsed.model || '',
        extras: parsed.extras || '',
      }
    }
  } catch {
    /* ignore */
  }
  // 程序不带任何接口地址，地址一律用户自己填
  return { baseUrl: '', apiKey: '', model: '' }
}

export default function Home() {
  const [config, setConfig] = useState<ApiConfig>(loadConfig)
  const [status, setStatus] = useState<ApiStatus>({
    online: false,
    latencyMs: null,
    message: '未检测',
    checkedAt: 0,
    state: 'unset',
  })
  const [balance, setBalance] = useState<BalanceInfo>({ available: false, label: '查询中' })
  const [polling, setPolling] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [subject, setSubject] = useState('')
  const [size, setSize] = useState('1024x1536')
  const [quality, setQuality] = useState('high')

  const [phase, setPhase] = useState<JobPhase>('idle')
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [currentImage, setCurrentImage] = useState<HistoryItem | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [elapsedSec, setElapsedSec] = useState(0)
  const [showKey, setShowKey] = useState(false)
  const [refImage, setRefImage] = useState<{ file: File; preview: string } | null>(null)
  const [genMode, setGenMode] = useState<'text' | 'image' | 'workflow'>(() =>
    typeof window !== 'undefined' && window.location.hash === '#i2i' ? 'image' : 'text',
  )
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 高级模式：Shift+F7 在工作流页内嵌 ComfyUI 原版节点界面
  const [advanced, setAdvanced] = useState(() => localStorage.getItem('lin-toolbox-advanced') === '1')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === 'F7') {
        e.preventDefault()
        setAdvanced((v) => {
          const next = !v
          localStorage.setItem('lin-toolbox-advanced', next ? '1' : '0')
          return next
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const [showSettings, setShowSettings] = useState(false)
  const [showQa, setShowQa] = useState(false)
  const [showDonate, setShowDonate] = useState(false)
  // 第一次打开：问答自动弹出，强制看完才许关
  const [qaForced, setQaForced] = useState(false)

  // 点了哪家服务商（只记选择，不带地址）；老版本存的 topapi 之类统一并到「中转站」
  const [providerId, setProviderId] = useState(() =>
    normalizeProviderId(localStorage.getItem(PROVIDER_KEY) || ''),
  )

  // ---- 本地 AI（不装也能画图，装了才有改写和找缺漏）----
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null)
  const [aiProgress, setAiProgress] = useState<AiProgress | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiPreview, setAiPreview] = useState('')
  const [aiThinking, setAiThinking] = useState(false)
  const [aiNote, setAiNote] = useState('')
  const [copied, setCopied] = useState(false)
  const aiBridge = hasAiBridge()

  // 点窗口叉号时弹的询问卡片（软件自己画的，不用系统弹窗）
  const [closeAsk, setCloseAsk] = useState(false)
  const [rememberClose, setRememberClose] = useState(false)

  // 上次 ComfyUI 没下完：不管在哪个模式，进来都问一句（工作流页里也有一份同样的询问）
  const [resumeAsk, setResumeAsk] = useState(false)
  const [resumeBusy, setResumeBusy] = useState(false)
  useEffect(() => {
    comfyDownloadState().then((d) => {
      if (d && d.partial && !d.installed && d.state !== 'preparing') setResumeAsk(true)
    })
    return onComfyResumeAvailable((p) => {
      if (p.partial && !p.installed) setResumeAsk(true)
    })
  }, [])

  useEffect(() => onCloseRequest(() => setCloseAsk(true)), [])

  // 首次进入：新手问答自动弹出，10 秒后才允许关闭；看完记住，以后不弹
  useEffect(() => {
    try {
      if (!localStorage.getItem('lin-toolbox-qa-seen')) {
        setQaForced(true)
        setShowQa(true)
      }
    } catch {
      /* ignore */
    }
  }, [])

  const closeQa = () => {
    setShowQa(false)
    setQaForced(false)
  }

  const answerClose = (action: 'tray' | 'quit' | 'cancel') => {
    setCloseAsk(false)
    respondClose(action, rememberClose)
  }

  // ---- 生成推荐词：读完关键词，列出可填可不填的表单 ----
  const [aiFields, setAiFields] = useState<AiFormField[]>([])
  const [aiFormBusy, setAiFormBusy] = useState(false)
  const [aiFieldBusy, setAiFieldBusy] = useState<Record<string, boolean>>({})
  const [aiFormNote, setAiFormNote] = useState('')
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({})
  const [customBusy, setCustomBusy] = useState<Record<string, boolean>>({})
  const aiAnalyzedForRef = useRef('')

  const locked = phase === 'running'

  const progressRef = useRef(0)
  const stageRef = useRef<Set<number>>(new Set())
  const logEndRef = useRef<HTMLDivElement>(null)

  // persist config
  useEffect(() => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  }, [config])

  useEffect(() => {
    localStorage.setItem(PROVIDER_KEY, providerId)
  }, [providerId])

  // 本地 AI 状态：装过就自己热起来，没装就不出声
  useEffect(() => {
    if (!hasAiBridge()) return
    let alive = true
    getAiStatus().then((s) => {
      if (!alive || !s) return
      setAiStatus(s)
    })
    const offS = onAiStatus((s) => {
      setAiStatus(s)
      if (s.state !== 'preparing' && s.state !== 'starting') setAiProgress(null)
    })
    const offP = onAiProgress((p) => {
      setAiProgress(p)
      if ((p.percent || 0) >= 1) window.setTimeout(() => setAiProgress(null), 1500)
    })
    return () => {
      alive = false
      offS()
      offP()
    }
  }, [])

  const activeProvider = findProvider(providerId)
  const aiReady = !!aiStatus?.ready
  const aiInstalled = !!aiStatus?.installed

  // ---- 输入即识别：停手 400ms 再算 ----
  const [analysisText, setAnalysisText] = useState('')

  useEffect(() => {
    const t = window.setTimeout(() => setAnalysisText(subject), 400)
    return () => window.clearTimeout(t)
  }, [subject])

  const analysis = useMemo(() => analyzeText(analysisText), [analysisText])

  /** 往某个分类里加一个词 */
  const applyTag = (catId: string, en: string) => {
    setSelected((prev) => {
      const arr = prev[catId] || []
      if (arr.includes(en)) return prev
      return { ...prev, [catId]: [...arr, en] }
    })
  }

  /** 当前内容整理成中文草稿，拿去给别的 AI 扩写也行 */
  const buildDraft = () => {
    const tags = PROMPT_CATEGORIES.flatMap((c) =>
      (selected[c.id] || []).map((en) => c.options.find((o) => o.en === en)?.label || en),
    )
    const body = subject.trim() || '（还没写主体）'
    return (
      `帮我写 AI 绘画提示词。\n画面主体：${body}\n` +
      `风格与效果：${tags.length ? tags.join('、') : '无特别要求'}\n` +
      '扩写成一段完整的英文绘图提示词，涵盖主体、外貌细节、风格、光影、构图、氛围，只输出提示词本身，别加解释。'
    )
  }

  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(buildDraft())
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setAiNote('复制失败，请手动复制')
    }
  }

  const installLocalAi = async () => {
    setAiNote('')
    setAiBusy(true)
    try {
      const r = await installAi()
      if (r.status) setAiStatus(r.status)
      if (!r.ok) setAiNote(r.error || '下载安装失败，请检查网络')
    } finally {
      setAiBusy(false)
    }
  }

  const startLocalAi = async () => {
    setAiNote('')
    setAiBusy(true)
    try {
      const r = await startAi()
      if (r.status) setAiStatus(r.status)
      if (!r.ok) setAiNote(r.error || '启动失败，请重试')
    } finally {
      setAiBusy(false)
    }
  }

  const removeLocalAi = async () => {
    setAiBusy(true)
    try {
      const s = await uninstallAi()
      if (s) setAiStatus(s)
      setAiPreview('')
      setAiProgress(null)
      setAiNote('')
    } finally {
      setAiBusy(false)
    }
  }

  const runPolish = async () => {
    if (!aiReady) {
      setAiNote(aiInstalled ? '本地模型未启动' : '未安装本地模型')
      return
    }
    const enTags = PROMPT_CATEGORIES.flatMap((c) => selected[c.id] || [])
    if (!subject.trim() && enTags.length === 0) {
      setAiNote('请先输入画面描述')
      return
    }
    setAiThinking(true)
    setAiNote('')
    setAiPreview('')
    const messages: ChatMessage[] = [
      { role: 'system', content: POLISH_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Subject: ${subject.trim() || 'a person'}\nStyle: ${enTags.length ? enTags.join(', ') : 'photo-realistic, soft light'}`,
      },
    ]
    let content = ''
    try {
      await chatAi(
        messages,
        (d) => {
          if (d.text) {
            content += d.text
            setAiPreview((p) => (p + d.text).slice(-3000))
          }
        },
        { temperature: 0.65, maxTokens: 1000 },
      )
      if (!content.trim()) setAiNote('未生成内容，请重试')
    } catch (e) {
      setAiNote(e instanceof Error ? e.message : '改写失败')
    } finally {
      setAiThinking(false)
      setAiProgress(null)
    }
  }


  /** 本地 AI 读关键词，找出还没说清的地方，输出带候选词的表单（JSON）。
      给了 targetDims 就重点补这几项（比如点了「还差·场景」就只补场景） */
  const runAiForm = useCallback(async (targetDims?: string[]) => {
    const kw = subject.trim()
    if (!kw) {
      setAiFormNote('请先输入画面描述')
      return
    }
    if (!aiReady) {
      setAiFormNote(aiInstalled ? '本地模型未启动' : '未安装本地模型')
      return
    }
    setAiFormBusy(true)
    setAiFormNote('')
    const known = [...new Set(analysis.hits.map((h) => h.label))]
    if (analysis.subject) known.unshift('主体')
    const focus = targetDims && targetDims.length ? targetDims : analysis.missing.map((m) => m.name)
    const buildUserText = (extra = '') =>
      `关键词：${kw}\n` +
      (known.length ? `已经说清的部分：${known.join('、')}，这些别再问。\n` : '') +
      (focus.length
        ? `重点补这几项：${focus.join('、')}。一项都别漏，每项单独出一个 field。`
        : '你觉得还缺什么就列什么。') +
      extra
    const ask = async (extra = '') => {
      let raw = ''
      await chatAi(
        [
          { role: 'system', content: FORM_SYSTEM_PROMPT },
          { role: 'user', content: buildUserText(extra) },
        ],
        (d) => {
          if (d.text) raw += d.text
        },
        { temperature: 0.5, maxTokens: 1600 },
      )
      // AI 话说到一半被掐断也尽量救：先整段解析，不行就退到最后一个完整的 field，补全外层再解析
      const salvaged = salvageFieldsJson(raw)
      if (!salvaged) return null
      const fields = (salvaged.parsed.fields || [])
        .filter((f) => f && typeof f.name === 'string' && Array.isArray(f.options))
        .slice(0, 8)
        .map((f) => ({
          name: String(f.name),
          why: typeof f.why === 'string' ? f.why : '',
          options: f.options
            .filter((o) => o && typeof o.en === 'string')
            .slice(0, 10)
            .map((o) => ({ label: String(o.label || o.en), en: String(o.en) })),
        }))
        .filter((f) => f.options.length > 0)
      return { fields, truncated: salvaged.truncated }
    }
    try {
      let result = await ask()
      // 明明还有缺项，AI 却一项都不给：追问一次，别急着下「已经够完整」的结论
      if (result && result.fields.length === 0 && focus.length > 0) {
        result = await ask('\n上次你一项都没给，不合格。重点补的项一个都不能少，重新输出完整 JSON。')
      }
      if (!result) {
        setAiFormNote('输出中断，请点击重新推荐')
        return
      }
      const { fields, truncated } = result
      if (fields.length === 0) {
        if (focus.length > 0) {
          // 规则识别明明看出有缺项，AI 连问两次都交白卷，那就是 AI 的问题，不怪用户的描述
          setAiFormNote('AI 这次没给出建议，点「重新推荐」再来一次，不填也不耽误生成')
        } else {
          setAiFields([])
          aiAnalyzedForRef.current = kw
          setAiFormNote('当前画面描述要素已完整，可直接生成图像')
        }
      } else {
        setAiFields(fields)
        aiAnalyzedForRef.current = kw
        if (truncated) {
          setAiFormNote('部分结果已生成，可点击重新推荐补全')
        }
      }
    } catch {
      setAiFormNote('解析失败，请点击重新推荐')
    } finally {
      setAiFormBusy(false)
      setAiProgress(null)
    }
  }, [subject, aiReady, aiInstalled, analysis])

  /** 只重新推荐某一项：别牵动其它已经挑好的部分 */
  const recoField = async (name: string) => {
    const kw = subject.trim()
    if (!kw) {
      setAiFormNote('请先输入画面描述')
      return
    }
    if (!aiReady) {
      setAiFormNote(aiInstalled ? '本地模型未启动' : '未安装本地模型')
      return
    }
    setAiFieldBusy((prev) => ({ ...prev, [name]: true }))
    setAiFormNote('')
    try {
      const known = [...new Set(analysis.hits.map((h) => h.label))]
      if (analysis.subject) known.unshift('主体')
      let raw = ''
      await chatAi(
        [
          { role: 'system', content: FORM_SYSTEM_PROMPT },
          {
            role: 'user',
            content:
              `关键词：${kw}\n` +
              (known.length ? `已经说清的部分：${known.join('、')}，这些别再问。\n` : '') +
              `只重新给「${name}」这一项，别的项一律不要输出。\n` +
              `输出一个 JSON 对象，格式照旧：{"fields":[{"name":"${name}","why":"两到六个字","options":[{"label":"中文词","en":"english phrase"}]}]}\n` +
              `要有 5 到 8 个和上一轮不一样的候选，彼此区别明显。`,
          },
        ],
        (d) => {
          if (d.text) raw += d.text
        },
        { temperature: 0.85, maxTokens: 1200 },
      )
      const salvaged = salvageFieldsJson(raw)
      const f = (salvaged?.parsed.fields || []).find(
        (x) => x && typeof x.name === 'string' && Array.isArray(x.options) && x.options.length > 0,
      )
      if (!f) {
        setAiFormNote(`「${name}」这次没给出新词，再点一次试试`)
        return
      }
      const options = f.options
        .filter((o) => o && typeof o.en === 'string')
        .slice(0, 10)
        .map((o) => ({ label: String(o.label || o.en), en: String(o.en) }))
        .filter((o) => !hasCJK(o.en))
      if (options.length === 0) {
        setAiFormNote(`「${name}」这次没给出新词，再点一次试试`)
        return
      }
      setAiFields((prev) => prev.map((x) => (x.name === name ? { name, why: f.why || x.why, options } : x)))
    } catch (e) {
      setAiFormNote(e instanceof Error ? e.message : '候选词解析失败，请再次点击重试')
    } finally {
      setAiFieldBusy((prev) => {
        const next = { ...prev }
        delete next[name]
        return next
      })
    }
  }

  // 输入停手 0.9 秒后：先把中文翻成英文进「最终提示词」，再自动找缺漏推荐细节。
  // 两件事排队做，避免同时打本地模型互相挤掉；同一段话各只做一次。
  const [subjectEn, setSubjectEn] = useState<{ for: string; en: string }>({ for: '', en: '' })
  const subjectRef = useRef(subject)
  const aiPolishedForRef = useRef('')
  useEffect(() => {
    subjectRef.current = subject
  }, [subject])
  useEffect(() => {
    const kw = subject.trim()
    if (!aiReady || kw.length < 4) return
    const needPolish = hasCJK(kw) && aiPolishedForRef.current !== kw
    const needForm = aiAnalyzedForRef.current !== kw
    if (!needPolish && !needForm) return
    const t = window.setTimeout(() => {
      const cur = subjectRef.current.trim()
      if (!cur) return
      ;(async () => {
        if (hasCJK(cur) && aiPolishedForRef.current !== cur) {
          aiPolishedForRef.current = cur
          try {
            const en = await chatAi(
              [
                { role: 'system', content: POLISH_SYSTEM_PROMPT },
                { role: 'user', content: `Subject: ${cur}` },
              ],
              () => {},
              { temperature: 0.3, maxTokens: 300 },
            )
            const cleaned = cleanPolishText(en)
            // 只有输入框里还是这段话才写入，免得盖住用户新写的内容
            if (cleaned && subjectRef.current.trim() === cur) {
              setSubjectEn({ for: cur, en: cleaned })
            }
          } catch {
            /* 翻译失败就保持原文，不打扰 */
          }
        }
        if (subjectRef.current.trim() === cur && aiAnalyzedForRef.current !== cur) {
          runAiForm()
        }
      })()
    }, 900)
    return () => window.clearTimeout(t)
  }, [subject, aiReady, runAiForm])

  // 写了「9比16」「16:9」这类比例，自动切到对应尺寸
  useEffect(() => {
    if (!analysis.aspect) return
    const target =
      analysis.aspect === 'portrait'
        ? '1024x1536'
        : analysis.aspect === 'landscape'
          ? '1536x1024'
          : '1024x1024'
    setSize((cur) => (cur === target ? cur : target))
  }, [analysis.aspect])

  /** 表单里自己写的一项：回车直接选中。中文先让 DS 翻成英文再进提示词，不开思考模式 */
  const addCustomOption = async (fieldName: string) => {
    const v = (customInputs[fieldName] || '').trim()
    if (!v) return
    if (hasCJK(v)) {
      if (!aiReady) {
        setAiFormNote('自定义中文词条需通过本地辅助模型转译为英文，请等待模型就绪后添加')
        return
      }
      setCustomBusy((prev) => ({ ...prev, [fieldName]: true }))
      try {
        const en = await chatAi(
          [
            { role: 'system', content: POLISH_SYSTEM_PROMPT },
            { role: 'user', content: `Subject: ${v}` },
          ],
          () => {},
          { temperature: 0.3, maxTokens: 200 },
        )
        const cleaned = cleanPolishText(en)
        if (cleaned) applyTag(aiFieldKey(fieldName), cleaned)
        else setAiFormNote('没翻出来，换个写法试试')
      } catch {
        setAiFormNote('词条转译失败，请按回车键重试')
      } finally {
        setCustomBusy((prev) => ({ ...prev, [fieldName]: false }))
        setCustomInputs((prev) => ({ ...prev, [fieldName]: '' }))
      }
      return
    }
    applyTag(aiFieldKey(fieldName), v)
    setCustomInputs((prev) => ({ ...prev, [fieldName]: '' }))
  }

  const removeAiField = (fieldName: string) => {
    setAiFields((prev) => prev.filter((f) => f.name !== fieldName))
    setSelected((prev) => {
      const next = { ...prev }
      delete next[aiFieldKey(fieldName)]
      return next
    })
  }

  const refreshModels = useCallback(
    async (quiet = false) => {
      try {
        const list = await listModels(config)
        const ids = list.map((m) => m.id)
        ids.sort((a, b) => {
          const ai = /image/i.test(a) ? 0 : 1
          const bi = /image/i.test(b) ? 0 : 1
          return ai - bi || a.localeCompare(b)
        })
        setModels(ids)
        if (!quiet) setLogs((prev) => [...prev, `已获取 ${ids.length} 个模型`])
      } catch (e) {
        if (!quiet)
          setLogs((prev) => [
            ...prev,
            `获取模型列表失败：${e instanceof Error ? e.message : '未知原因'}`,
          ])
      }
    },
    [config],
  )

  const refreshStatus = useCallback(async () => {
    const configured = !!config.baseUrl.trim() && !!config.apiKey.trim()
    if (!configured) {
      setStatus({ online: false, latencyMs: null, message: '未配置接口', checkedAt: Date.now(), state: 'unset' })
      setBalance({ available: false, label: '未配置' })
      return
    }
    setPolling(true)
    try {
      const s = await checkStatus(config)
      setStatus(s)
      if (s.online) {
        const b = await getBalance(config)
        setBalance(b)
        refreshModels(true)
      } else if (s.state === 'auth' || s.state === 'notfound' || s.state === 'wrongbase') {
        // 连不通就别硬查余额，直接把状态标出来
        setBalance({ available: false, label: '不可查', error: s.message })
      } else {
        setBalance({ available: false, label: '离线', error: s.message })
      }
    } finally {
      setPolling(false)
    }
  }, [config, refreshModels])

  // 状态和余额每 20 秒刷一次（窗口在后台也照刷，切回来再补一次）
  useEffect(() => {
    let stopped = false
    const tick = async () => {
      if (stopped) return
      await refreshStatus()
    }
    tick()
    const timer = setInterval(tick, 20000)
    const onVisible = () => {
      if (!document.hidden) tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshStatus])

  // elapsed timer while running
  useEffect(() => {
    if (phase !== 'running') return
    const t0 = Date.now() - elapsedSec * 1000
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - t0) / 1000))
    }, 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // simulated progress ramp while running
  useEffect(() => {
    if (phase !== 'running') return
    const timer = setInterval(() => {
      progressRef.current = Math.min(
        92,
        progressRef.current + (92 - progressRef.current) * 0.02 + 0.15,
      )
      const p = progressRef.current
      setProgress(p)
      const stages: Array<[number, string]> = [
        [2, '已提交请求'],
        [20, '等待服务端处理'],
        [45, '正在生成画面'],
        [75, '正在渲染细节'],
        [90, '即将完成'],
      ]
      for (const [th, msg] of stages) {
        if (p >= th && !stageRef.current.has(th)) {
          stageRef.current.add(th)
          setLogs((prev) => [...prev, msg])
        }
      }
    }, 200)
    return () => clearInterval(timer)
  }, [phase])

  // auto scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [logs])

  const finalPrompt = useMemo(() => {
    const fragments: string[] = []
    const rawSubj = subject.trim()
    // 中文描述已自动翻成英文就用英文；还没翻好（或在打字中）先放原文顶上
    const en = subjectEn.for === rawSubj ? subjectEn.en : ''
    if (en) fragments.push(en)
    else if (rawSubj) fragments.push(rawSubj)
    for (const cat of PROMPT_CATEGORIES) {
      for (const en of selected[cat.id] || []) fragments.push(en)
    }
    for (const f of aiFields) {
      for (const en of selected[aiFieldKey(f.name)] || []) fragments.push(en)
    }
    return fragments.join(', ')
  }, [subject, subjectEn, selected, aiFields])

  const selectedCount = useMemo(
    () => Object.values(selected).reduce((n, arr) => n + arr.length, 0),
    [selected],
  )

  const toggleOption = (catId: string, en: string) => {
    setSelected((prev) => {
      const arr = prev[catId] || []
      const next = arr.includes(en) ? arr.filter((x) => x !== en) : [...arr, en]
      return { ...prev, [catId]: next }
    })
  }

  const clearSelection = () => {
    setSelected({})
    setSubject('')
    setAiFields([])
    setCustomInputs({})
    setAiFormNote('')
    aiAnalyzedForRef.current = ''
  }

  const setRefFromFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setLogs((prev) => [...prev, '请选择图片格式文件'])
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      setLogs((prev) => [...prev, '图片大小不能超过 15MB'])
      return
    }
    setRefImage((old) => {
      if (old) URL.revokeObjectURL(old.preview)
      return { file, preview: URL.createObjectURL(file) }
    })
    setLogs((prev) => [...prev, `参考图已载入：${file.name}`])
  }

  const clearRefImage = () => {
    setRefImage((old) => {
      if (old) URL.revokeObjectURL(old.preview)
      return null
    })
  }

  const useResultAsRef = async (item: HistoryItem) => {
    try {
      const resp = await fetch(item.imageData)
      const blob = await resp.blob()
      const file = new File([blob], `ref-${item.id}.png`, { type: blob.type || 'image/png' })
      setRefFromFile(file)
      setGenMode('image')
    } catch {
      setLogs((prev) => [...prev, '图片已失效，无法设为参考'])
    }
  }

  const runGenerate = async () => {
    if (!config.baseUrl.trim()) {
      setErrorMsg('请先填写接口地址')
      setPhase('error')
      return
    }
    if (!config.apiKey.trim()) {
      setErrorMsg('请先填写接口密钥')
      setPhase('error')
      return
    }
    if (!finalPrompt.trim()) {
      setErrorMsg('请先输入画面描述')
      setPhase('error')
      return
    }
    if (genMode === 'image' && !refImage) {
      setErrorMsg('请先上传参考图')
      setPhase('error')
      return
    }
    setPhase('running')
    setErrorMsg('')
    setProgress(0)
    progressRef.current = 0
    stageRef.current = new Set()
    setElapsedSec(0)
    const mode = genMode === 'image' ? '图生图' : '文生图'
    setLogs([
      `模式：${mode}`,
      `模型：${config.model}`,
      `尺寸：${size} · 质量：${quality}`,
    ])
    try {
      const result =
        genMode === 'image' && refImage
          ? await editImage(
              config,
              { prompt: finalPrompt, size, quality },
              refImage.file,
              refImage.file.name,
            )
          : await generateImage(config, { prompt: finalPrompt, size, quality })
      progressRef.current = 100
      setProgress(100)
      setLogs((prev) => [...prev, `生成完成，耗时 ${(result.elapsedMs / 1000).toFixed(1)}s`])
      // 接口返回的是临时链接：让后端立刻下载落盘，防过期防跨域
      let imageData = result.imageData
      if (/^https?:\/\//i.test(imageData)) {
        setLogs((prev) => [...prev, '正在将生成图像保存至本地目录…'])
        const r = await fetchImageToDir(imageData, `霖易工具箱-${Date.now()}.png`)
        if (r.ok && r.dataUrl) {
          imageData = r.dataUrl
          setLogs((prev) => [...prev, `图片已存到：${r.path}`])
        } else {
          setLogs((prev) => [...prev, `落盘失败（${r.error || '未知原因'}），显示用临时链接`])
        }
      }
      const item: HistoryItem = {
        id: Date.now(),
        imageData,
        prompt: finalPrompt,
        size,
        elapsedMs: result.elapsedMs,
      }
      setCurrentImage(item)
      setHistory((prev) => [item, ...prev].slice(0, 12))
      setPhase('done')
      // refresh balance after a successful generation
      getBalance(config).then(setBalance).catch(() => {})
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '生成失败')
      setLogs((prev) => [...prev, `出错：${e instanceof Error ? e.message : '生成失败'}`])
      setPhase('error')
    }
  }

  const downloadImage = async (item: HistoryItem) => {
    const filename = `霖易工具箱-${item.id}.png`
    // 桌面端：直接写进设置里的图片保存目录
    let dataUrl = item.imageData
    try {
      if (!dataUrl.startsWith('data:')) {
        const blob = await (await fetch(dataUrl)).blob()
        dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader()
          fr.onload = () => resolve(String(fr.result))
          fr.onerror = () => reject(new Error('read fail'))
          fr.readAsDataURL(blob)
        })
      }
      const r = await saveImageToDir(dataUrl, filename)
      if (r.ok && r.path) {
        setLogs((prev) => [...prev, `图片已存到：${r.path}`])
        return
      }
      if (r.error && r.error !== '仅桌面端可用') {
        setLogs((prev) => [...prev, `保存失败：${r.error}`])
        return
      }
    } catch {
      /* 走浏览器下载兜底 */
    }
    // 浏览器环境兜底
    try {
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = filename
      a.click()
    } catch {
      window.open(item.imageData, '_blank')
    }
  }

  const addressMismatch = activeProvider ? providerMismatch(activeProvider.id, config.baseUrl) : false
  const suggestedProvider = addressMismatch ? guessProvider(config.baseUrl) : undefined

  /** 连接状态的各种情况都标出来，别一律叫「离线」 */
  const statusView = (() => {
    const configured = !!config.baseUrl.trim() && !!config.apiKey.trim()
    if (!configured) return { dot: 'bg-zinc-500', text: '未配置', tone: 'text-zinc-400' }
    // 地址和所选服务商对不上：一律按无连接处理，这两样先对齐了再谈通不通
    if (addressMismatch) return { dot: 'bg-red-500', text: '无连接', tone: 'text-red-300' }
    if (polling && status.checkedAt === 0) return { dot: 'bg-cyan-400 animate-pulse', text: '检测中', tone: 'text-cyan-300' }
    switch (status.state) {
      case 'online':
        return { dot: 'bg-teal-400', text: '在线', tone: 'text-zinc-300' }
      case 'auth':
        return { dot: 'bg-red-500', text: '密钥无效', tone: 'text-red-300' }
      case 'notfound':
        return { dot: 'bg-red-500', text: '地址不对', tone: 'text-red-300' }
      case 'wrongbase':
        return { dot: 'bg-red-500', text: '地址填错了', tone: 'text-red-300' }
      case 'ratelimit':
        return { dot: 'bg-amber-400', text: '被限流', tone: 'text-amber-300' }
      default:
        return { dot: 'bg-red-500', text: '连不上', tone: 'text-red-300' }
    }
  })()
  const statusTooltip = addressMismatch
    ? `当前地址不是「${activeProvider?.name}」的接口，按无连接算。把服务商改成地址对应的那家，或者换成这家的接口地址。`
    : status.message + (status.httpStatus ? `（HTTP ${status.httpStatus}）` : '')

  return (
    <div className="relative min-h-dvh bg-[#070d0d] text-zinc-200">
      <TechBackground className="pointer-events-none fixed inset-0 h-full w-full opacity-80" />

      {/* ===== header ===== */}
      <header className="sticky top-0 z-40 border-b border-teal-500/15 bg-[#070d0d]/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <img
              src={`${import.meta.env.BASE_URL}logo.png`}
              alt="霖易"
              className="h-10 w-10 object-contain drop-shadow-[0_0_10px_rgba(167,139,250,0.5)]"
              draggable={false}
            />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-wide text-zinc-50">霖易工具箱</h1>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className="flex items-center gap-1 rounded-md border border-amber-300/70 bg-gradient-to-r from-amber-400/30 via-violet-400/25 to-teal-400/20 px-2.5 py-1 text-[12px] font-bold tracking-wider text-amber-100 shadow-[0_0_20px_rgba(251,191,36,0.35)]"
                  title="本软件作者：霖易aa"
                >
                  <Crown className="h-3.5 w-3.5 text-amber-300" />
                  作者 霖易aa
                </span>
                <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-teal-500/80">
                  AI Image Workshop
                </p>
              </div>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* API status */}
            <div
              className={`flex items-center gap-2 rounded-md border px-3 py-1.5 ${
                addressMismatch
                  ? 'border-red-500/40 bg-red-500/[0.07]'
                  : status.online
                    ? 'border-teal-500/20 bg-white/[0.03]'
                    : status.state === 'unset'
                      ? 'border-zinc-700 bg-white/[0.02]'
                      : 'border-red-500/30 bg-red-500/[0.06]'
              }`}
              title={statusTooltip}
            >
              <span className={`relative flex h-2 w-2`}>
                {status.online && !addressMismatch && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-60" />
                )}
                <span className={`relative inline-flex h-2 w-2 rounded-full ${statusView.dot}`} />
              </span>
              <span className={`text-xs ${statusView.tone}`}>
                API {statusView.text}
                {status.online && !addressMismatch && status.latencyMs != null && (
                  <span className="ml-1 font-mono text-teal-300">{status.latencyMs}ms</span>
                )}
              </span>
              {status.checkedAt > 0 && (
                <span className="hidden font-mono text-[10px] text-zinc-500 sm:inline">
                  {new Date(status.checkedAt).toLocaleTimeString()}
                </span>
              )}
              {addressMismatch && (
                <span
                  className="rounded-full border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300"
                  title={statusTooltip}
                >
                  地址≠服务商
                </span>
              )}
              {activeProvider && !addressMismatch && (
                <span
                  className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
                    activeProvider.cnDirect
                      ? 'border-teal-500/40 bg-teal-500/10 text-teal-300'
                      : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  }`}
                  title="网络参考提示，以实际连接测试为准"
                >
                  {activeProvider.cnDirect ? '直连' : '需代理'}
                </span>
              )}
              <button
                onClick={refreshStatus}
                className="rounded p-0.5 text-zinc-400 transition-colors hover:text-teal-300 focus-visible:outline-2 focus-visible:outline-teal-400"
                title="立即刷新状态（每 20 秒自动更新）"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${polling ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* balance */}
            <div
              className="flex items-center gap-2 rounded-md border border-teal-500/20 bg-white/[0.03] px-3 py-1.5"
              title={balance.error || balance.detail || '每 20 秒自动查询一次'}
            >
              <Wallet className={`h-3.5 w-3.5 ${balance.available ? 'text-teal-400' : 'text-zinc-500'}`} />
              <span className="text-xs text-zinc-300">
                余额 <span className={`font-mono ${balance.available ? 'text-teal-300' : 'text-zinc-400'}`}>{balance.label}</span>
              </span>
              {balance.detail && (
                <span className="hidden text-[10px] text-zinc-500 md:inline" title={balance.detail}>
                  {balance.detail}
                </span>
              )}
              {!balance.available && balance.error && (
                <span className="hidden text-[10px] text-amber-300/80 md:inline" title={balance.error}>
                  查不到
                </span>
              )}
            </div>

            {/* 新手问答 + 设置 */}
            <button
              onClick={() => setShowQa(true)}
              className="flex items-center gap-1.5 rounded-md border border-teal-500/20 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-teal-500/50 hover:text-teal-300"
              title="面向新手的 Q/A 问答"
            >
              <CircleHelp className="h-3.5 w-3.5 text-teal-400" />
              新手问答
            </button>
            <button
              onClick={() => setShowDonate(true)}
              className="flex items-center gap-1.5 rounded-md border border-teal-500/20 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-teal-500/50 hover:text-teal-300"
              title="支持作者"
            >
              <Heart className="h-3.5 w-3.5 text-teal-400" />
              打赏
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 rounded-md border border-teal-500/20 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-teal-500/50 hover:text-teal-300"
              title="设置"
            >
              <Settings className="h-3.5 w-3.5 text-teal-400" />
              设置
            </button>
          </div>
        </div>
      </header>

      {/* ===== main ===== */}
      <main className="relative z-10 mx-auto grid max-w-[1600px] grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-[320px_minmax(0,1fr)_400px]">
        {/* 模式切换：文生图 / 图生图 / 工作流 */}
        <div className="flex lg:col-span-3">
          <div className="flex rounded-md border border-teal-500/30 bg-black/40 p-0.5">
            {(
              [
                { id: 'text', label: '文生图', icon: Wand2 },
                { id: 'image', label: '图生图', icon: ImagePlus },
                { id: 'workflow', label: '工作流', icon: Layers },
              ] as const
            ).map((m) => {
              const active = genMode === m.id
              return (
                <button
                  key={m.id}
                  onClick={() => setGenMode(m.id)}
                  className={`flex items-center gap-1.5 rounded px-4 py-1.5 text-sm font-medium transition-all focus-visible:outline-2 focus-visible:outline-teal-400 ${
                    active
                      ? 'bg-teal-400/20 text-teal-200 shadow-[0_0_14px_rgba(45,212,191,0.25)]'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  <m.icon className="h-4 w-4" />
                  {m.label}
                </button>
              )
            })}
          </div>
          {genMode === 'workflow' && (
            <div className="ml-auto flex items-center gap-2 self-center rounded-md border border-teal-500/20 bg-teal-500/[0.05] px-3 py-1.5 text-[11px] text-zinc-400">
              <kbd className="rounded border border-teal-500/40 bg-teal-500/10 px-1.5 py-0.5 font-mono text-[10px] text-teal-300">
                Shift + F7
              </kbd>
              {advanced ? '收起画布帷幕' : '拉开画布帷幕（ComfyUI 原生节点界面）'}
            </div>
          )}
        </div>

        {genMode === 'workflow' ? (
          <WorkflowPanel importedPrompt={finalPrompt} advanced={advanced} onAdvancedChange={setAdvanced} />
        ) : (
          <>
        {/* ---- left: API config ---- */}
        <section className="h-fit rounded-lg border border-teal-500/15 bg-white/[0.02] p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <KeyRound className="h-4 w-4 text-teal-400" />
            接口设置
            {locked && (
              <span className="ml-auto flex items-center gap-1 rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] text-amber-300">
                <Lock className="h-3 w-3" /> 生成中
              </span>
            )}
          </h2>

          {/* 新手指引 */}
          <div className="mb-3 rounded-md border border-teal-500/20 bg-teal-500/5 p-3 text-[11px] leading-relaxed text-zinc-400">
            <div className="mb-1 flex items-center gap-1 font-medium text-teal-300">
              <Info className="h-3 w-3" /> 配置说明
            </div>
            选择服务商，填入接口地址与密钥，选择模型即可生成
          </div>

          {/* 服务商 */}
          <label className="mb-1 flex items-center gap-1.5 text-xs text-zinc-400">
            <Sparkles className="h-3 w-3" /> 服务商
          </label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {PROVIDERS.map((p) => {
              const active = providerId === p.id
              return (
                <button
                  key={p.id}
                  disabled={locked}
                  onClick={() => setProviderId(active ? '' : p.id)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition-all focus-visible:outline-2 focus-visible:outline-teal-400 disabled:cursor-not-allowed disabled:opacity-40 ${
                    active
                      ? 'border-teal-400 bg-teal-400/15 text-teal-200 shadow-[0_0_12px_rgba(45,212,191,0.25)]'
                      : 'border-zinc-700 bg-black/30 text-zinc-400 hover:border-teal-500/50 hover:text-zinc-200'
                  }`}
                >
                  {p.name}
                </button>
              )
            })}
          </div>

          {!providerId && (
            <p className="mb-3 rounded-md border border-dashed border-zinc-700 px-2 py-2 text-[11px] leading-relaxed text-zinc-500">
              选择服务商后展开配置项
            </p>
          )}

          {/* 地址和所选服务商对不上：这儿直接说清是哪一家的地址 */}
          {providerId && addressMismatch && (
            <div className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-200">
              这个地址不是「{activeProvider?.name}」的接口
              {suggestedProvider ? (
                <>
                  ，看着像「{suggestedProvider.name}」的。点一下它，或者换成「{activeProvider?.name}」的地址。
                </>
              ) : (
                <>，检查一下服务商有没有选错，或者地址是不是填成了别家的。</>
              )}
            </div>
          )}

          {providerId && (
            <>
          {activeProvider?.tip && (
            <p className="mb-2 rounded-md border border-teal-500/20 bg-teal-500/5 px-2 py-1.5 text-[10px] leading-relaxed text-teal-200/70">
              {activeProvider.tip}
            </p>
          )}

          <label className="mb-1 flex items-center gap-1.5 text-xs text-zinc-400">
            <Link2 className="h-3 w-3" /> 接口地址
          </label>
          <input
            value={config.baseUrl}
            disabled={locked}
            onChange={(e) => setConfig((c) => ({ ...c, baseUrl: e.target.value }))}
            placeholder="输入接口地址"
            className="w-full rounded-md border border-zinc-700 bg-black/40 px-3 py-2 font-mono text-xs text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <p className="mb-3 mt-1 text-[10px] leading-relaxed text-zinc-600">
            末尾可省略版本号路径，系统自动补全
          </p>

          <label className="mb-1 flex items-center gap-1.5 text-xs text-zinc-400">
            <KeyRound className="h-3 w-3" /> API Key
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={config.apiKey}
              disabled={locked}
              onChange={(e) => setConfig((c) => ({ ...c, apiKey: e.target.value }))}
              placeholder="sk- 开头的那一串"
              className="w-full rounded-md border border-zinc-700 bg-black/40 px-3 py-2 pr-9 font-mono text-xs text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-500 transition-colors hover:text-teal-300 focus-visible:outline-2 focus-visible:outline-teal-400"
              title={showKey ? '隐藏 Key' : '显示 Key'}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="mb-3 mt-1 text-[10px] leading-relaxed text-zinc-600">
            在服务商后台的「API 令牌 / Keys」页面生成，只存在这台电脑上
          </p>

          <div className="mb-1 flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs text-zinc-400">
              <Activity className="h-3 w-3" /> 模型
            </label>
            <button
              onClick={() => refreshModels(false)}
              disabled={locked}
              className="flex items-center gap-1 text-[11px] text-teal-400 transition-colors hover:text-teal-300 focus-visible:outline-2 focus-visible:outline-teal-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw className="h-3 w-3" /> 刷新列表
            </button>
          </div>

          {models.length > 0 ? (
            <div className="mb-1 flex flex-wrap gap-1.5">
              {models.map((m) => {
                const active = config.model === m
                return (
                  <button
                    key={m}
                    disabled={locked}
                    onClick={() => setConfig((c) => ({ ...c, model: m }))}
                    className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition-all focus-visible:outline-2 focus-visible:outline-teal-400 disabled:cursor-not-allowed disabled:opacity-40 ${
                      active
                        ? 'border-teal-400 bg-teal-400/15 text-teal-200 shadow-[0_0_12px_rgba(45,212,191,0.25)]'
                        : 'border-zinc-700 bg-black/30 text-zinc-400 hover:border-teal-500/50 hover:text-zinc-200'
                    }`}
                  >
                    {m}
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="mb-1 text-[11px] text-zinc-600">
              填写地址与密钥后可拉取列表，或直接手动输入
            </p>
          )}

          <input
            value={config.model}
            disabled={locked}
            onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
            placeholder="输入模型名称"
            className="mb-1 w-full rounded-md border border-zinc-700 bg-black/40 px-3 py-2 font-mono text-xs text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
          />

          <div
            className={`mt-3 rounded-md border px-3 py-2 text-xs ${
              status.online
                ? 'border-teal-500/30 bg-teal-500/10 text-teal-300'
                : 'border-zinc-700 bg-black/30 text-zinc-400'
            }`}
          >
            {status.online ? (
              <span className="flex items-center gap-1.5">
                <CircleCheck className="h-3.5 w-3.5" /> {status.message} · {getNormalizedBase(config)}
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <CircleAlert className="h-3.5 w-3.5" /> {status.message}
              </span>
            )}
          </div>
          <button
            onClick={refreshStatus}
            disabled={locked}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition-colors hover:border-teal-500/50 hover:text-teal-200 focus-visible:outline-2 focus-visible:outline-teal-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw className="h-3.5 w-3.5" /> 测试连接
          </button>

          <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
            兼容所有遵循 OpenAI 规范的图像生成接口（/v1/images/generations），配置只存在这台电脑上
          </p>
            </>
          )}
        </section>


        {/* ---- middle: prompt workbench ---- */}
        <section className="rounded-lg border border-teal-500/15 bg-white/[0.02] p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Palette className="h-4 w-4 text-teal-400" />
              画面描述
            </h2>
            <span className="rounded-full border border-teal-500/30 px-2 py-0.5 font-mono text-[10px] text-teal-300">
              已选 {selectedCount} 项
            </span>
            {selectedCount > 0 && (
              <button
                onClick={clearSelection}
                className="flex items-center gap-1 text-[11px] text-zinc-400 transition-colors hover:text-red-400 focus-visible:outline-2 focus-visible:outline-red-400"
              >
                <X className="h-3 w-3" /> 清空
              </button>
            )}
          </div>

          {/* 图生图：参考图上传区 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) setRefFromFile(f)
              e.target.value = ''
            }}
          />
          {genMode === 'image' && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (locked) return
                const f = e.dataTransfer.files?.[0]
                if (f) setRefFromFile(f)
              }}
              className={`mb-3 rounded-md border-2 border-dashed p-3 transition-colors ${
                refImage ? 'border-teal-500/50 bg-teal-500/5' : 'border-teal-500/25 bg-black/20'
              }`}
            >
              {refImage ? (
                <div className="flex items-center gap-3">
                  <img
                    src={refImage.preview}
                    alt="参考图"
                    className="h-20 w-20 rounded border border-zinc-700 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-zinc-200">{refImage.file.name}</div>
                    <div className="mt-1 text-[11px] text-teal-400">
                      基于此参考图与下方描述重绘画面
                    </div>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={locked}
                      className="mt-1 text-[11px] text-zinc-400 underline underline-offset-2 transition-colors hover:text-teal-300 focus-visible:outline-2 focus-visible:outline-teal-400 disabled:opacity-40"
                    >
                      更换图片
                    </button>
                  </div>
                  <button
                    onClick={clearRefImage}
                    disabled={locked}
                    className="rounded p-1 text-zinc-500 transition-colors hover:text-red-400 focus-visible:outline-2 focus-visible:outline-red-400 disabled:opacity-40"
                    title="移除参考图"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={locked}
                  className="flex w-full flex-col items-center justify-center gap-1.5 py-6 text-zinc-400 transition-colors hover:text-teal-300 focus-visible:outline-2 focus-visible:outline-teal-400 disabled:opacity-40"
                >
                  <ImagePlus className="h-8 w-8 text-teal-500/70" />
                  <span className="text-sm">上传参考图</span>
                  <span className="text-[11px] text-zinc-600">
                    点击选择或拖入图片，上限 15MB
                  </span>
                </button>
              )}
            </div>
          )}

          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="输入画面主体、场景、光影或风格（支持中文自动转译，Ctrl"
            className="mb-2 w-full rounded-md border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-teal-400"
          />

          {/* ===== 输入即识别，缺什么一项一项补 ===== */}
          <div className="mb-3 rounded-md border border-teal-500/20 bg-teal-500/[0.04] p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-[11px] text-teal-300">
                <Sparkles className="h-3.5 w-3.5" /> 快捷词库
              </span>
              <span className="text-[10px] text-zinc-500">{analysis.hint}</span>
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  onClick={copyDraft}
                  className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:border-teal-500/50 hover:text-teal-200"
                  title="复制当前提示词需求"
                >
                  <Copy className="h-3 w-3" /> {copied ? '已复制' : '复制需求'}
                </button>
                {analysis.canCompose && (
                  <button
                    onClick={runGenerate}
                    disabled={phase === 'running'}
                    className="flex items-center gap-1 rounded border border-teal-400/50 bg-teal-400/10 px-2 py-1 text-[11px] text-teal-200 transition-colors hover:bg-teal-400/20 disabled:opacity-50"
                  >
                    <Play className="h-3 w-3" /> 直接生成
                  </button>
                )}
              </div>
            </div>

            {/* 识别结果 */}
            {(analysis.hits.length > 0 || analysis.subject) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-zinc-500">已包含</span>
                {analysis.subject && (
                  <span className="rounded-full border border-teal-400/40 bg-teal-400/10 px-2 py-0.5 text-[10px] text-teal-200">
                    主体 · {analysis.subject.length > 12 ? analysis.subject.slice(0, 12) + '…' : analysis.subject}
                  </span>
                )}
                {analysis.hits.map((h) => (
                  <span
                    key={h.en}
                    className="rounded-full border border-zinc-600 bg-black/30 px-2 py-0.5 text-[10px] text-zinc-300"
                  >
                    {h.label}
                  </span>
                ))}
              </div>
            )}

            {/* 本地 AI 行 */}
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-2">
              {!aiBridge ? (
                <span className="text-[10px] text-zinc-600">仅桌面端可用</span>
              ) : aiReady ? (
                <>
                  <button
                    onClick={() => runPolish()}
                    disabled={aiThinking}
                    className="flex items-center gap-1 text-[10px] text-teal-300 transition-colors hover:text-teal-200 disabled:opacity-50"
                  >
                    {aiThinking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
                    {aiThinking ? '正在改写…' : '译为英文提示词'}
                  </button>
                  <span className="text-[10px] text-zinc-600">离线运行</span>
                  <button
                    onClick={removeLocalAi}
                    disabled={aiBusy}
                    className="ml-auto text-[10px] text-zinc-600 underline underline-offset-2 hover:text-red-400 disabled:opacity-40"
                  >
                    卸载模型
                  </button>
                </>
              ) : aiInstalled ? (
                <button
                  onClick={startLocalAi}
                  disabled={aiBusy}
                  className="flex items-center gap-1 text-[10px] text-teal-300 transition-colors hover:text-teal-200 disabled:opacity-50"
                >
                  {aiBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} 启动本地模型
                </button>
              ) : (
                <button
                  onClick={installLocalAi}
                  disabled={aiBusy || !aiBridge}
                  className="flex items-center gap-1 text-[10px] text-zinc-400 transition-colors hover:text-teal-200 disabled:opacity-40"
                  title="本地离线运行，仅首次下载"
                >
                  {aiBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  {aiBusy ? '尚未部署本地模型，请前往右上角' : '下载本地模型 (约 1GB)'}
                </button>
              )}
              {aiPreview && !aiThinking && (
                <>
                  <button
                    onClick={() => {
                      const clean = cleanPolishText(aiPreview)
                      setSubject(clean)
                      setAiPreview('')
                    }}
                    className="rounded border border-teal-400/50 bg-teal-400/10 px-2 py-0.5 text-[10px] text-teal-200"
                  >
                    应用
                  </button>
                  <button onClick={() => setAiPreview('')} className="text-[10px] text-zinc-500 hover:text-zinc-300">
                    忽略
                  </button>
                </>
              )}
            </div>

            {/* 下载/加载进度 */}
            {aiProgress && (
              <div className="mt-2">
                <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-400">
                  <span className="truncate">{aiProgress.label}</span>
                  <span className="ml-2 shrink-0 font-mono">
                    {Math.round((aiProgress.percent || 0) * 100)}%
                  </span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-teal-400 transition-all"
                    style={{ width: `${Math.min(100, Math.round((aiProgress.percent || 0) * 100))}%` }}
                  />
                </div>
              </div>
            )}

            {aiPreview && (
              <textarea
                readOnly
                value={aiPreview}
                rows={2}
                className="mt-2 w-full resize-none rounded border border-zinc-800 bg-black/50 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-teal-100/80 outline-none"
              />
            )}

            {aiNote && (
              <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-300">
                {aiNote}
              </p>
            )}
            {aiStatus?.error && (
              <p className="mt-2 break-all rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-red-300">
                {aiStatus.error}
              </p>
            )}
          </div>

          {/* ===== 生成推荐词：列出还没说清的地方，给候选词，可填可不填 ===== */}
          <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1 lg:max-h-[60vh]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
                <ListChecks className="h-3.5 w-3.5 text-teal-400" /> 细节推荐
              </span>
              <span className="text-[10px] text-zinc-500">
                根据当前描述推荐细节标签，按需点选
              </span>
              {aiReady && (
                <button
                  onClick={() => runAiForm()}
                  disabled={aiFormBusy}
                  className="ml-auto flex items-center gap-1 rounded border border-teal-400/50 bg-teal-400/10 px-2 py-1 text-[11px] text-teal-200 transition-colors hover:bg-teal-400/20 focus-visible:outline-2 focus-visible:outline-teal-400 disabled:opacity-50"
                >
                  {aiFormBusy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Brain className="h-3 w-3" />
                  )}
                  {aiFormBusy ? '分析中…' : aiFields.length > 0 ? '重新推荐' : '生成推荐词'}
                </button>
              )}
            </div>

            {!aiBridge ? (
              <p className="rounded-md border border-dashed border-zinc-700 px-3 py-3 text-[11px] leading-relaxed text-zinc-500">
                当前环境不支持本地模型，直接输入提示词生成即可
              </p>
            ) : !aiReady ? (
              <div className="rounded-md border border-dashed border-zinc-700 px-3 py-3 text-[11px] leading-relaxed text-zinc-500">
                <p className="mb-2">
                  启动本地模型后，可根据基础描述自动从词库取词推荐
                </p>
                {aiInstalled ? (
                  <button
                    onClick={startLocalAi}
                    disabled={aiBusy}
                    className="flex items-center gap-1 rounded border border-teal-400/50 bg-teal-400/10 px-2 py-1 text-[11px] text-teal-200 transition-colors hover:bg-teal-400/20 disabled:opacity-50"
                  >
                    {aiBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    启动本地模型
                  </button>
                ) : (
                  <button
                    onClick={installLocalAi}
                    disabled={aiBusy}
                    className="flex items-center gap-1 rounded border border-teal-400/50 bg-teal-400/10 px-2 py-1 text-[11px] text-teal-200 transition-colors hover:bg-teal-400/20 disabled:opacity-50"
                    title="本地离线运行，仅首次下载"
                  >
                    {aiBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                    {aiBusy ? '尚未部署本地模型，请前往右上角' : '下载本地模型 (约 1GB)'}
                  </button>
                )}
              </div>
            ) : aiFormBusy && aiFields.length === 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-teal-500/20 bg-teal-500/5 px-3 py-3 text-[11px] text-teal-200">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                正在分析画面要素…
              </div>
            ) : aiFields.length === 0 ? (
              <p className="rounded-md border border-dashed border-zinc-700 px-3 py-3 text-[11px] leading-relaxed text-zinc-500">
                输入描述后将自动列出推荐细节标签，不选也可直接生成
              </p>
            ) : (
              aiFields.map((f) => {
                const key = aiFieldKey(f.name)
                const chosen = selected[key] || []
                const customChosen = chosen.filter((en) => !f.options.some((o) => o.en === en))
                return (
                  <div key={key} className="rounded-md border border-teal-500/20 bg-black/25 p-2.5">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="text-xs font-medium text-zinc-200">{f.name}</span>
                      {f.why && <span className="text-[10px] text-zinc-500">{f.why}</span>}
                      <span className="font-mono text-[10px] text-zinc-600">
                        已选 {chosen.length}
                      </span>
                      <button
                        onClick={() => recoField(f.name)}
                        disabled={!!aiFieldBusy[f.name] || aiFormBusy}
                        className="ml-auto flex items-center gap-1 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:border-teal-500/50 hover:text-teal-300 disabled:opacity-40"
                        title="只重新推荐这一项"
                      >
                        {aiFieldBusy[f.name] ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3 w-3" />
                        )}
                        {aiFieldBusy[f.name] ? '换…' : '换一批'}
                      </button>
                      <button
                        onClick={() => removeAiField(f.name)}
                        className="rounded p-0.5 text-zinc-600 transition-colors hover:text-red-400 focus-visible:outline-2 focus-visible:outline-red-400"
                        title="移除此项"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {f.options.map((opt) => {
                        const active = chosen.includes(opt.en)
                        return (
                          <button
                            key={opt.en}
                            onClick={() => toggleOption(key, opt.en)}
                            title={opt.en}
                            className={`rounded-full border px-2.5 py-1 text-xs transition-all focus-visible:outline-2 focus-visible:outline-teal-400 ${
                              active
                                ? 'border-teal-400 bg-teal-400/15 text-teal-200 shadow-[0_0_12px_rgba(45,212,191,0.25)]'
                                : 'border-zinc-700 bg-black/30 text-zinc-400 hover:border-teal-500/50 hover:text-zinc-200'
                            }`}
                          >
                            {opt.label}
                          </button>
                        )
                      })}
                      {customChosen.map((en) => (
                        <button
                          key={en}
                          onClick={() => toggleOption(key, en)}
                          title={en}
                          className="rounded-full border border-teal-400 bg-teal-400/15 px-2.5 py-1 text-xs text-teal-200 shadow-[0_0_12px_rgba(45,212,191,0.25)] transition-all focus-visible:outline-2 focus-visible:outline-teal-400"
                        >
                          ✎ {en.length > 14 ? en.slice(0, 14) + '…' : en}
                        </button>
                      ))}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <input
                        value={customInputs[f.name] || ''}
                        onChange={(e) =>
                          setCustomInputs((prev) => ({ ...prev, [f.name]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !customBusy[f.name]) addCustomOption(f.name)
                        }}
                        placeholder="输入自定义词条（中文会自动翻成英文），按回车添加"
                        className="flex-1 rounded border border-zinc-700 bg-black/40 px-2 py-1 text-[11px] text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-teal-400"
                      />
                      <button
                        onClick={() => addCustomOption(f.name)}
                        disabled={!!customBusy[f.name]}
                        className="rounded border border-zinc-700 p-1 text-zinc-400 transition-colors hover:border-teal-500/50 hover:text-teal-200 focus-visible:outline-2 focus-visible:outline-teal-400 disabled:opacity-40"
                        title="加入"
                      >
                        {customBusy[f.name] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                      </button>
                    </div>
                  </div>
                )
              })
            )}

            {aiFormNote && (
              <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-300">
                {aiFormNote}
              </p>
            )}
          </div>

          {/* composed prompt preview */}
          <div className="mt-4 rounded-md border border-zinc-700/80 bg-black/40 p-3">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
              最终提示词
            </div>
            <p className="max-h-20 overflow-y-auto break-all font-mono text-xs leading-relaxed text-teal-100/80">
              {finalPrompt || '— 暂无内容，输入描述或选择标签后自动汇总 —'}
            </p>
          </div>

          {/* size / quality / generate */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={size}
              onChange={(e) => setSize(e.target.value)}
              className="rounded-md border border-zinc-700 bg-black/40 px-2 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-teal-400"
            >
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value)}
              className="rounded-md border border-zinc-700 bg-black/40 px-2 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-teal-400"
            >
              {QUALITIES.map((q) => (
                <option key={q} value={q}>
                  质量 {q}
                </option>
              ))}
            </select>
            <button
              onClick={runGenerate}
              disabled={phase === 'running'}
              className="ml-auto flex items-center gap-2 rounded-md border border-teal-400/60 bg-teal-400/15 px-5 py-2 text-sm font-semibold text-teal-200 shadow-[0_0_20px_rgba(45,212,191,0.2)] transition-all hover:bg-teal-400/25 focus-visible:outline-2 focus-visible:outline-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === 'running' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {phase === 'running' ? '生成中…' : genMode === 'image' ? '开始重绘' : '开始生成'}
            </button>
          </div>
        </section>

        {/* ---- right: progress & result ---- */}
        <section className="flex flex-col gap-4">
          <div className="rounded-lg border border-teal-500/15 bg-white/[0.02] p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Activity className="h-4 w-4 text-teal-400" />
              任务状态
              {phase === 'running' && (
                <span className="ml-auto flex items-center gap-1 font-mono text-xs text-teal-300">
                  <Clock className="h-3 w-3" /> {elapsedSec}s
                </span>
              )}
            </h2>

            {/* progress ring */}
            <div className="flex items-center gap-4">
              <div className="relative h-24 w-24 shrink-0">
                <svg viewBox="0 0 96 96" className="h-full w-full -rotate-90">
                  <circle cx="48" cy="48" r="42" fill="none" stroke="rgba(63,63,70,0.5)" strokeWidth="6" />
                  <circle
                    cx="48"
                    cy="48"
                    r="42"
                    fill="none"
                    stroke="rgb(45,212,191)"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 42}
                    strokeDashoffset={2 * Math.PI * 42 * (1 - progress / 100)}
                    className="transition-[stroke-dashoffset] duration-200"
                  />
                </svg>
                {phase === 'running' && (
                  <div className="absolute inset-0 animate-[spin_6s_linear_infinite] rounded-full border border-dashed border-teal-500/30" />
                )}
                <div className="absolute inset-0 flex items-center justify-center font-mono text-sm text-teal-200">
                  {Math.floor(progress)}%
                </div>
              </div>

              {/* log terminal */}
              <div className="h-24 flex-1 overflow-y-auto rounded-md border border-zinc-800 bg-black/50 p-2 font-mono text-[10px] leading-relaxed text-teal-100/70">
                {logs.length === 0 && <span className="text-zinc-600">// 就绪</span>}
                {logs.map((l, i) => (
                  <div key={i}>
                    <span className="text-teal-500">›</span> {l}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>

            {phase === 'error' && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
          </div>

          {/* result */}
          <div className="flex-1 rounded-lg border border-teal-500/15 bg-white/[0.02] p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <ImageIcon className="h-4 w-4 text-teal-400" />
              生成结果
            </h2>

            {currentImage ? (
              <div>
                <div className="overflow-hidden rounded-md border border-zinc-700">
                  <img
                    src={currentImage.imageData}
                    alt="生成结果"
                    className="block w-full object-contain"
                  />
                </div>
                <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-zinc-500">
                  <span>{currentImage.size}</span>
                  <span>{(currentImage.elapsedMs / 1000).toFixed(1)}s</span>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => downloadImage(currentImage)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-teal-400/50 bg-teal-400/10 px-3 py-2 text-xs text-teal-200 transition-colors hover:bg-teal-400/20 focus-visible:outline-2 focus-visible:outline-teal-400"
                  >
                    <Download className="h-3.5 w-3.5" /> 下载图片
                  </button>
                  <button
                    onClick={() => useResultAsRef(currentImage)}
                    disabled={locked}
                    className="flex items-center justify-center gap-1.5 rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition-colors hover:border-teal-500/50 hover:text-teal-200 focus-visible:outline-2 focus-visible:outline-teal-400 disabled:opacity-50"
                    title="将此图设为参考图"
                  >
                    <ImagePlus className="h-3.5 w-3.5" /> 设为参考
                  </button>
                  <button
                    onClick={runGenerate}
                    disabled={phase === 'running'}
                    className="flex items-center justify-center gap-1.5 rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition-colors hover:border-teal-500/50 hover:text-teal-200 focus-visible:outline-2 focus-visible:outline-teal-400 disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> 重新生成
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-zinc-700 text-zinc-600">
                <ImageIcon className="h-8 w-8" />
                <span className="text-xs">暂无生成结果</span>
              </div>
            )}

            {/* history */}
            {history.length > 1 && (
              <div className="mt-4">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                  历史记录 ({history.length})
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {history.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => setCurrentImage(h)}
                      className={`overflow-hidden rounded border transition-all focus-visible:outline-2 focus-visible:outline-teal-400 ${
                        currentImage?.id === h.id
                          ? 'border-teal-400'
                          : 'border-zinc-700 hover:border-teal-500/50'
                      }`}
                      title={h.prompt.slice(0, 80)}
                    >
                      <img src={h.imageData} alt="" className="aspect-square w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
          </>
        )}
      </main>

      <footer className="relative z-10 border-t border-teal-500/10 px-4 py-3 text-center font-mono text-[10px] text-zinc-600">
        霖易工具箱 · <span className="text-amber-300/80">作者 霖易aa</span> · 本地存储配置 · 兼容标准图像接口
      </footer>

      {/* 上次 ComfyUI 没下完：进软件就问一句要不要接着下 */}
      {resumeAsk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-[440px] rounded-lg border border-teal-500/30 bg-[#0a1414] p-5 shadow-[0_0_50px_rgba(45,212,191,0.18)]">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Download className="h-4 w-4 text-teal-400" /> 检测到未完成的 ComfyUI 下载任务
            </h3>
            <p className="mt-3 text-xs leading-relaxed text-zinc-400">
              检测到上次部署被中断（关软件、断网、断电都可能）。已下载的部分还在磁盘上，
              接着下不会从头再来，点「接着下载」就会从断的地方继续。
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={async () => {
                  setResumeBusy(true)
                  setResumeAsk(false)
                  try {
                    await comfyEngineInstall()
                  } finally {
                    setResumeBusy(false)
                  }
                }}
                disabled={resumeBusy}
                className="flex-1 rounded-md border border-teal-400/60 bg-teal-400/15 px-3 py-2 text-xs font-medium text-teal-200 transition-colors hover:bg-teal-400/25 disabled:opacity-40"
              >
                接着下载
              </button>
              <button
                onClick={async () => {
                  setResumeAsk(false)
                  await comfyEnginePurge()
                }}
                className="flex-1 rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition-colors hover:text-amber-300"
              >
                清掉，重新下
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

      {/* 关闭询问：软件自己风格的卡片 */}
      {closeAsk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[400px] rounded-lg border border-teal-500/25 bg-[#0a1414] p-5 shadow-[0_0_50px_rgba(45,212,191,0.18)]">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Wand2 className="h-4 w-4 text-teal-400" /> 关闭窗口
            </h3>
            <p className="mt-3 text-xs leading-relaxed text-zinc-400">
              <span className="text-teal-300">隐藏到托盘</span>：最小化到系统托盘，保持后台运行
              <br />
              <span className="text-red-300">直接关闭</span>：退出程序并停止本地模型服务
            </p>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={rememberClose}
                onChange={(e) => setRememberClose(e.target.checked)}
                className="h-3.5 w-3.5 accent-teal-400"
              />
              此后不再询问
            </label>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => answerClose('tray')}
                className="flex-1 rounded-md border border-teal-400/60 bg-teal-400/15 px-3 py-2 text-xs font-medium text-teal-200 transition-colors hover:bg-teal-400/25"
              >
                隐藏到托盘
              </button>
              <button
                onClick={() => answerClose('quit')}
                className="flex-1 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20"
              >
                直接关闭
              </button>
              <button
                onClick={() => answerClose('cancel')}
                className="rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showQa && <QaModal forced={qaForced} onClose={closeQa} />}
      {showDonate && <DonateModal onClose={() => setShowDonate(false)} />}
    </div>
  )
}
