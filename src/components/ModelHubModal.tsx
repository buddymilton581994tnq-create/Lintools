// 模型库弹窗：按功能分类列出模型，一键下载到 ComfyUI 的 models 目录。
// 下载带进度条，支持断点续传；已下载的标绿。
import { useEffect, useMemo, useState } from 'react'
import { CircleCheck, Download, Loader2, Package, X } from 'lucide-react'
import { modelDownload, modelList, onModelProgress, type ModelItem } from '../lib/modelhub'
import { fmtPct } from '../lib/comfyui'

const CAT_ORDER = ['ckpt', 'lora', 'vae', 'upscale', 'face', 'controlnet', 'unet', 'clip', 'video']
const RATINGS = ['S', 'A', 'B', 'C', 'D']

const ratingCls = (r?: string) =>
  r === 'S'
    ? 'border-amber-400/70 bg-amber-400/15 text-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.3)]'
    : r === 'A'
      ? 'border-teal-400/60 bg-teal-400/10 text-teal-300'
      : r === 'B'
        ? 'border-sky-500/50 bg-sky-500/10 text-sky-300'
        : r === 'C'
          ? 'border-zinc-600 bg-zinc-800/50 text-zinc-400'
          : 'border-zinc-700 bg-black/40 text-zinc-600'

export default function ModelHubModal({
  onClose,
  onChanged,
  deployed,
}: {
  onClose: () => void
  onChanged?: () => void
  deployed: boolean
}) {
  const [items, setItems] = useState<ModelItem[]>([])
  const [progress, setProgress] = useState<Record<string, { percent: number; received: number; total: number }>>({})
  const [error, setError] = useState('')
  const [onlyRating, setOnlyRating] = useState('')

  const refresh = () => modelList().then(setItems)

  useEffect(() => {
    refresh()
    const off = onModelProgress((p) => {
      if (p.done) {
        setProgress((prev) => {
          const next = { ...prev }
          delete next[p.id]
          return next
        })
        refresh()
        return
      }
      setProgress((prev) => ({
        ...prev,
        [p.id]: { percent: p.percent ?? 0, received: p.received ?? 0, total: p.total ?? 0 },
      }))
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const download = async (id: string) => {
    setError('')
    const r = await modelDownload(id)
    if (r.list) setItems(r.list)
    if (!r.ok) setError(r.error || '下载失败')
    else onChanged?.()
  }

  const groups = useMemo(() => {
    const list = onlyRating ? items.filter((it) => it.rating === onlyRating) : items
    const map = new Map<string, { name: string; items: ModelItem[] }>()
    for (const it of list) {
      if (!map.has(it.cat)) map.set(it.cat, { name: it.catName, items: [] })
      map.get(it.cat)!.items.push(it)
    }
    return CAT_ORDER.filter((c) => map.has(c)).map((c) => ({ id: c, ...map.get(c)! }))
  }, [items, onlyRating])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[86vh] w-full max-w-xl overflow-y-auto rounded-lg border border-teal-500/25 bg-[#0a1414] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2">
          <Package className="h-4 w-4 text-teal-400" />
          <h2 className="text-sm font-semibold text-zinc-100">模型库</h2>
          <span className="text-[10px] text-zinc-500">一键下载，自动放到正确的目录，支持断点续传</span>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1 text-zinc-500 transition-colors hover:text-zinc-200"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-300">
            {error}
          </p>
        )}

        {!deployed && (
          <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300">
            ComfyUI 还没部署，先点工作流页的「一键部署」或导入现有整合包，以便存放下载的模型文件。
          </p>
        )}

        <p className="mb-2 font-mono text-[10px] text-zinc-500">
          评级：<span className="text-amber-300">S 必装</span> · <span className="text-teal-300">A 推荐</span> · <span className="text-sky-300">B 好用</span> · <span className="text-zinc-400">C 备选</span> · <span className="text-zinc-600">D 玩玩</span>
          ，每个模型按「功能」与「呈现效果」分开打
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] text-zinc-500">按评级筛</span>
          <button
            onClick={() => setOnlyRating('')}
            className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
              onlyRating === '' ? 'border-teal-400 bg-teal-400/15 text-teal-200' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            全部 {items.length}
          </button>
          {RATINGS.map((r) => {
            const n = items.filter((it) => it.rating === r).length
            return (
              <button
                key={r}
                onClick={() => setOnlyRating(onlyRating === r ? '' : r)}
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors ${ratingCls(r)} ${
                  onlyRating === r ? 'ring-1 ring-teal-400/60' : 'opacity-80 hover:opacity-100'
                }`}
              >
                {r} {n}
              </button>
            )
          })}
        </div>
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.id}>
              <div className="mb-1.5 text-xs font-medium text-teal-300">{g.name}</div>
              <div className="space-y-1.5">
                {g.items.map((it) => {
                  const prog = progress[it.id]
                  return (
                    <div key={it.id} className="rounded-md border border-zinc-700/80 bg-black/30 p-2.5">
                      <div className="flex items-center gap-2">
                        {it.rating && (
                          <span
                            title="综合评级：把功能覆盖与出图效果合起来看"
                            className={`flex h-4 w-4 items-center justify-center rounded border font-mono text-[10px] font-bold ${ratingCls(it.rating)}`}
                          >
                            {it.rating}
                          </span>
                        )}
                        <span className="text-xs font-medium text-zinc-100">{it.name}</span>
                        <span className="font-mono text-[10px] text-zinc-500">{it.sizeLabel}</span>
                        <span className="flex items-center gap-1 font-mono text-[9px] text-zinc-500">
                          <span title="功能评级：能做多少事" className={`rounded border px-1 ${ratingCls(it.ratingFunc)}`}>
                            功能 {it.ratingFunc || it.rating}
                          </span>
                          <span title="效果评级：生成图像的细节精度、光影质感与结构稳定性" className={`rounded border px-1 ${ratingCls(it.ratingEff)}`}>
                            效果 {it.ratingEff || it.rating}
                          </span>
                        </span>
                        {it.downloaded && !prog && (
                          <span className="ml-auto flex items-center gap-1 text-[10px] text-teal-300">
                            <CircleCheck className="h-3 w-3" /> 已就绪
                          </span>
                        )}
                        {!it.downloaded && !prog && (
                          <button
                            onClick={() => download(it.id)}
                            disabled={it.downloading || !deployed}
                            title={deployed ? '' : '请先部署 ComfyUI'}
                            className="ml-auto flex items-center gap-1 rounded-md border border-teal-500/40 bg-teal-500/10 px-2 py-1 text-[10px] text-teal-300 transition-colors hover:bg-teal-500/20 disabled:opacity-40"
                          >
                            <Download className="h-3 w-3" /> 下载
                          </button>
                        )}
                        {prog && (
                          <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-teal-300">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {fmtPct(prog.percent)}%
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">{it.desc}</p>
                      {prog && (
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/50">
                          <div
                            className="h-full rounded-full bg-teal-400 transition-all duration-300"
                            style={{ width: `${Math.max(2, Math.min(100, prog.percent * 100))}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
