// 设置面板：主题切换 + DS 模型和 ComfyUI 的部署路径管理。
// 路径随时能改、能恢复默认、能整个移除；ComfyUI 还能导入现成的整合包（秋叶之类）。
import { useEffect, useState } from 'react'
import {
  Archive,
  CircleCheck,
  FolderOpen,
  Link2,
  Loader2,
  Palette,
  RotateCcw,
  Settings,
  Shield,
  Trash2,
  Type,
  Unlink,
  X,
} from 'lucide-react'
import { THEMES, applyTheme, currentThemeId } from '../lib/themes'
import { FONT_SIZES, applyFontSize, currentFontSizeId } from '../lib/fontSize'
import { getAppDirs, pickDir, setAiDir, setComfyDir, setComfyAuto, setImgDir, getComfyPaths, moveComfyPath, type AppDirs, type ComfyPaths } from '../lib/settings'
import { backupApplyNow, backupCreate, backupOpenDir, backupSetAuto, backupStatus, type BackupStatus } from '../lib/backup'
import { getAiStatus, onAiStatus, uninstallAi, type AiStatus } from '../lib/localLlm'
import { runMockTest, type MockTestResult } from '../lib/comfyui'
import {
  comfyEngineAdopt,
  comfyEngineStatus,
  comfyEngineUninstall,
  onComfyEngineStatus,
  type ComfyEngineStatus,
} from '../lib/comfyui'

function DirRow({
  label,
  dir,
  custom,
  busy,
  onChange,
  onReset,
}: {
  label: string
  dir: string
  custom: boolean
  busy: boolean
  onChange: () => void
  onReset: () => void
}) {
  return (
    <div className="rounded-md border border-zinc-700/80 bg-black/30 p-2.5">
      <div className="mb-1 flex items-center gap-2 text-xs text-zinc-300">
        {label}
        {!custom && <span className="rounded-full border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-500">默认位置</span>}
      </div>
      <p className="mb-2 break-all font-mono text-[10px] leading-relaxed text-zinc-500">{dir}</p>
      <div className="flex gap-1.5">
        <button
          onClick={onChange}
          disabled={busy}
          className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:border-teal-500/50 hover:text-teal-300 disabled:opacity-40"
        >
          <FolderOpen className="h-3 w-3" /> 换个位置
        </button>
        {custom && (
          <button
            onClick={onReset}
            disabled={busy}
            className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-teal-500/50 hover:text-teal-300 disabled:opacity-40"
          >
            恢复默认
          </button>
        )}
      </div>
    </div>
  )
}

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [dirs, setDirs] = useState<AppDirs | null>(null)
  const [comfyPaths, setComfyPaths] = useState<ComfyPaths | null>(null)
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [comfy, setComfy] = useState<ComfyEngineStatus | null>(null)
  const [theme, setTheme] = useState(currentThemeId())
  const [fontSize, setFontSize] = useState(currentFontSizeId())
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [mockResult, setMockResult] = useState<MockTestResult | null>(null)
  const [mockBusy, setMockBusy] = useState('')
  const [bkp, setBkp] = useState<BackupStatus | null>(null)
  const [bkpBusy, setBkpBusy] = useState('')
  const [autoStart, setAutoStart] = useState(true)

  useEffect(() => {
    getAppDirs().then((d) => {
      if (!d) return
      setDirs(d)
      setAutoStart(d.comfyAutoStart !== false)
    })
    getComfyPaths().then(setComfyPaths)
    getAiStatus().then(setAi)
    comfyEngineStatus().then((s) => s && setComfy(s))
    backupStatus().then((s) => s && setBkp(s))
    const offA = onAiStatus(setAi)
    const offC = onComfyEngineStatus(setComfy)
    return () => {
      offA()
      offC()
    }
  }, [])

  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true)
    setNote('')
    try {
      await fn()
      setDirs(await getAppDirs())
      setNote(okText)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const changeAiDir = () =>
    run(async () => {
      const dir = await pickDir('选择 DS 模型的部署位置')
      if (dir) await setAiDir(dir)
    }, '部署路径已更新，新目录为空，请重新执行部署模型')

  const resetAiDir = () => run(async () => setAiDir(null), '已恢复默认位置')

  const removeAi = () => {
    if (!window.confirm('确认移除本地辅助模型部署？相关模型文件将被删除，后续使用需重新下载。') ) return
    run(async () => uninstallAi(), 'DS 模型已移除')
  }

  const changeComfyDir = () =>
    run(async () => {
      const dir = await pickDir('选择 ComfyUI 的部署位置')
      if (dir) await setComfyDir(dir)
    }, '部署路径已更新，新目录为空，请重新执行部署')

  const resetComfyDir = () => run(async () => setComfyDir(null), '已恢复默认位置')

  const changeImgDir = () =>
    run(async () => {
      const dir = await pickDir('选择图片保存位置（已有的图会一起搬过去）')
      if (!dir) return
      const r = await setImgDir(dir)
      if (!r.ok) throw new Error(r.error || '换位置失败')
    }, '图片保存位置换好了，旧图也搬过去了')

  const resetImgDir = () =>
    run(async () => {
      const r = await setImgDir(null)
      if (!r.ok) throw new Error(r.error || '恢复失败')
    }, '已恢复默认保存目录，原有图像已同步迁回')

  const moveComfy = (kind: 'nodes' | 'models', label: string) =>
    run(async () => {
      const dir = await pickDir(`选择${label}的新位置（里面的东西会一起搬过去）`)
      if (!dir) return
      const r = await moveComfyPath(kind, dir)
      if (!r.ok) throw new Error(r.error || '迁移失败')
      setComfyPaths(await getComfyPaths())
    }, `${label}已取消本地 ComfyUI 生成`)

  const moveComfyBack = (kind: 'nodes' | 'models', label: string) =>
    run(async () => {
      const r = await moveComfyPath(kind, null)
      if (!r.ok) throw new Error(r.error || '迁回失败')
      setComfyPaths(await getComfyPaths())
    }, `${label}已迁回原位`)

  const adoptComfy = () =>
    run(async () => {
      const dir = await pickDir('选择整合包的根目录（秋叶整合包选最外层文件夹）')
      if (!dir) return
      const r = await comfyEngineAdopt(dir)
      if (!r?.ok) throw new Error(r?.error || '导入失败')
    }, '导入成功，ComfyUI 已关联')

  // ---- 存档 ----
  const doBackup = async (label: string) => {
    setBkpBusy('backup')
    setNote('')
    try {
      const r = await backupCreate(label)
      if (!r.ok) setNote(r.error || '备份失败')
      else setNote('备份好了，出问题时能从这里退回去')
      setBkp(await backupStatus())
    } finally {
      setBkpBusy('')
    }
  }

  const doRestore = async (id: string) => {
    if (!window.confirm('确认使用该存档恢复当前程序？界面将重新加载，现有配置与模型文件不受影响。')) return
    setBkpBusy(id)
    setNote('')
    try {
      const r = await backupApplyNow(id)
      if (!r.ok) {
        setNote(r.error || '恢复失败')
        return
      }
      setNote('已恢复，正在重新加载界面…')
      setTimeout(() => window.location.reload(), 900)
    } finally {
      setBkpBusy('')
    }
  }

  const toggleAutoRestore = async (on: boolean) => {
    const s = await backupSetAuto(on)
    if (s) setBkp(s)
  }

  const removeComfy = () => {
    const external = comfy?.external
    const msg = external
      ? '确认解除与外部整合包的关联？整合包原有文件不会被删除。'
      : '确认移除内置 ComfyUI 部署？约 4GB 的运行环境与基础模型文件将被删除。'
    if (!window.confirm(msg)) return
    run(async () => comfyEngineUninstall(), external ? '已解除关联' : '内置 ComfyUI 已移除')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[86vh] w-full max-w-lg overflow-y-auto rounded-lg border border-teal-500/25 bg-[#0a1414] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2">
          <Settings className="h-4 w-4 text-teal-400" />
          <h2 className="text-sm font-semibold text-zinc-100">设置</h2>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1 text-zinc-500 transition-colors hover:text-zinc-200"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 主题 */}
        <div className="mb-5">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-300">
            <Palette className="h-3.5 w-3.5 text-teal-400" /> 界面风格
          </div>
          <div className="grid grid-cols-2 gap-2">
            {THEMES.map((t) => {
              const active = theme === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    applyTheme(t.id)
                    setTheme(t.id)
                  }}
                  className={`rounded-md border p-2.5 text-left transition-colors ${
                    active
                      ? 'border-teal-400/60 bg-teal-400/10'
                      : 'border-zinc-700 bg-black/30 hover:border-zinc-500'
                  }`}
                >
                  <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-zinc-100">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.accent }} />
                    {t.name}
                    {active && <CircleCheck className="ml-auto h-3.5 w-3.5 text-teal-300" />}
                  </span>
                  <span className="text-[10px] leading-relaxed text-zinc-500">{t.desc}</span>
                  <span className="mt-1 block text-[10px] leading-relaxed text-teal-400/70">
                    推荐字体：{t.font}（文件名 {t.fontFile}，放进 fonts 目录即生效）
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* 字号 */}
        <div className="mb-5">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-300">
            <Type className="h-3.5 w-3.5 text-teal-400" /> 字号
          </div>
          <div className="flex gap-1.5">
            {FONT_SIZES.map((s) => {
              const active = fontSize === s.id
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    applyFontSize(s.id)
                    setFontSize(s.id)
                  }}
                  className={`flex-1 rounded-md border px-2 py-2 text-xs transition-colors ${
                    active
                      ? 'border-teal-400/60 bg-teal-400/10 text-teal-200'
                      : 'border-zinc-700 bg-black/30 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  {s.name}
                  <span className="ml-1 font-mono text-[10px] text-zinc-500">{s.px}px</span>
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-[10px] text-zinc-500">全局调节界面字号大小，重启程序后保持生效。</p>
        </div>

        {/* DS 模型 */}
        <div className="mb-5">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-300">
            本地模型（DS）
            {ai && (
              <span className={`ml-auto text-[10px] ${ai.installed ? 'text-teal-300' : 'text-zinc-500'}`}>
                {ai.installed ? (ai.ready ? '运行中' : '已部署') : '未部署'}
              </span>
            )}
          </div>
          {dirs && (
            <DirRow
              label="部署位置"
              dir={ai?.dir || dirs.aiDir}
              custom={dirs.aiDirCustom}
              busy={busy}
              onChange={changeAiDir}
              onReset={resetAiDir}
            />
          )}
          {ai?.installed && (
            <button
              onClick={removeAi}
              disabled={busy}
              className="mt-2 flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-40"
            >
              <Trash2 className="h-3 w-3" /> 移除部署（清理模型文件）
            </button>
          )}
        </div>

        {/* ComfyUI */}
        <div className="mb-2">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-300">
            ComfyUI（工作流模式用）
            {comfy && (
              <span className={`ml-auto text-[10px] ${comfy.installed ? 'text-teal-300' : 'text-zinc-500'}`}>
                {comfy.external ? '已关联整合包' : comfy.installed ? (comfy.ready ? '运行中' : '已部署') : '未部署'}
              </span>
            )}
          </div>
          {comfy?.external ? (
            <div className="rounded-md border border-zinc-700/80 bg-black/30 p-2.5">
              <div className="mb-1 flex items-center gap-2 text-xs text-zinc-300">
                当前关联的整合包
                <span className="rounded-full border border-teal-500/40 bg-teal-500/10 px-1.5 py-0.5 text-[10px] text-teal-300">
                  外部
                </span>
              </div>
              <p className="mb-2 break-all font-mono text-[10px] leading-relaxed text-zinc-500">{comfy.dir}</p>
              <p className="text-[10px] text-zinc-500">整合包是满的，插件模型都齐，启动由这里管。</p>
            </div>
          ) : (
            dirs && (
              <DirRow
                label="部署位置"
                dir={comfy?.dir || dirs.comfyDir}
                custom={dirs.comfyDirCustom}
                busy={busy}
                onChange={changeComfyDir}
                onReset={resetComfyDir}
              />
            )
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              onClick={adoptComfy}
              disabled={busy}
              className="flex items-center gap-1 rounded-md border border-teal-500/40 bg-teal-500/10 px-2 py-1 text-[11px] text-teal-300 transition-colors hover:bg-teal-500/20 disabled:opacity-40"
            >
              <Link2 className="h-3 w-3" /> 导入已有的整合包（秋叶等）
            </button>
            {(comfy?.installed || comfy?.external) && (
              <button
                onClick={removeComfy}
                disabled={busy}
                className="flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-40"
              >
                {comfy?.external ? <Unlink className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}
                {comfy?.external ? '解除关联（保留文件）' : '移除部署（清理文件）'}
              </button>
            )}
          </div>

          {/* 后台自动运行：标准模式看不到画布，但它一直待命 */}
          <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-md border border-zinc-700/80 bg-black/30 px-2.5 py-2 text-[11px] text-zinc-400">
            <input
              type="checkbox"
              className="mt-0.5 accent-teal-400"
              checked={autoStart}
              onChange={async (e) => {
                const on = e.target.checked
                setAutoStart(on)
                await setComfyAuto(on)
                setDirs(await getAppDirs())
                setNote(on ? '开启服务，以便执行 ComfyUI 节点工作流' : '已关闭：需要时再手动启动')
              }}
            />
            <span>
              请先部署 ComfyUI
              <span className="block text-[10px] text-zinc-500">
                开着的话软件启动几秒后它自己就在后台跑，标准模式不占界面，随时点开画布就能用。
              </span>
            </span>
          </label>
        </div>

        {/* ComfyUI 插件与模型目录 */}
        {comfyPaths?.deployed && (
          <div className="mb-5 space-y-2">
            {(
              [
                { kind: 'nodes' as const, label: '插件目录', dir: comfyPaths.nodesDir, linked: comfyPaths.nodesLinked },
                { kind: 'models' as const, label: '模型目录', dir: comfyPaths.modelsDir, linked: comfyPaths.modelsLinked },
              ]
            ).map((row) => (
              <div key={row.kind} className="rounded-md border border-zinc-700/80 bg-black/30 p-2.5">
                <div className="mb-1 flex items-center gap-2 text-xs text-zinc-300">
                  {row.label}
                  {row.linked && (
                    <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                      已迁出
                    </span>
                  )}
                </div>
                <p className="mb-2 break-all font-mono text-[10px] leading-relaxed text-zinc-500">{row.dir}</p>
                <div className="flex gap-1.5">
                  {!row.linked ? (
                    <button
                      onClick={() => moveComfy(row.kind, row.label)}
                      disabled={busy}
                      className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:border-teal-500/50 hover:text-teal-300 disabled:opacity-40"
                    >
                      <FolderOpen className="h-3 w-3" /> 迁到别的位置
                    </button>
                  ) : (
                    <button
                      onClick={() => moveComfyBack(row.kind, row.label)}
                      disabled={busy}
                      className="rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-teal-500/50 hover:text-teal-300 disabled:opacity-40"
                    >
                      迁回原位
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 图片保存位置 */}
        <div className="mb-2">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-300">
            图片保存位置
          </div>
          {dirs && (
            <DirRow
              label="保存到"
              dir={dirs.imgDir}
              custom={dirs.imgDirCustom}
              busy={busy}
              onChange={changeImgDir}
              onReset={resetImgDir}
            />
          )}
          <p className="mt-1.5 text-[10px] text-zinc-500">生成历史里点「存图」就写到这里。换位置时已有的图会一起搬过去。</p>
        </div>

        {/* 存档：备份与回滚 */}
        <div className="mb-2 mt-4">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-300">
            <Archive className="h-3.5 w-3.5 text-teal-400" /> 存档（备份与回滚）
            {bkp && bkp.backups.length > 0 && (
              <span className="ml-auto text-[10px] text-teal-300">{bkp.backups.length} 份</span>
            )}
          </div>
          <p className="mb-2 text-[10px] leading-relaxed text-zinc-500">
            把当前这套程序（界面 + 主进程 + 全部逻辑）打成一个包存起来，不含模型和图片。
            第一次启动会自动存一份出厂快照；程序要是连续两次启动失败，会自动退回到最近一份能用的存档。
          </p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button
              onClick={() => doBackup('手动备份')}
              disabled={!!bkpBusy}
              className="flex items-center gap-1 rounded-md border border-teal-500/40 bg-teal-500/10 px-2 py-1 text-[11px] text-teal-300 transition-colors hover:bg-teal-500/20 disabled:opacity-40"
            >
              {bkpBusy === 'backup' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
              立刻备份当前程序
            </button>
            <button
              onClick={() => backupOpenDir()}
              className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:border-teal-500/50 hover:text-teal-300"
            >
              <FolderOpen className="h-3 w-3" /> 打开备份目录
            </button>
          </div>

          {bkp && (
            <>
              <label className="mb-2 flex items-center gap-1.5 text-[11px] text-zinc-400">
                <input type="checkbox" checked={bkp.autoRestoreOnCrash} onChange={(e) => toggleAutoRestore(e.target.checked)} />
                <Shield className="h-3 w-3 text-teal-400" /> 启动连续失败时自动恢复最近一份存档
                {bkp.bootAttempts > 0 && <span className="text-amber-300">（本次已是第 {bkp.bootAttempts} 次启动）</span>}
              </label>
              <div className="space-y-1.5">
                {bkp.backups.length === 0 ? (
                  <p className="rounded-md border border-dashed border-zinc-700 px-2 py-2 text-[10px] text-zinc-500">
                    还没有存档，点上面「立刻备份」存一份。
                  </p>
                ) : (
                  bkp.backups.map((b) => (
                    <div key={b.id} className="flex items-center gap-2 rounded-md border border-zinc-700/80 bg-black/30 px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] text-zinc-200">{b.label}</div>
                        <div className="truncate font-mono text-[10px] text-zinc-500">
                          {new Date(b.at).toLocaleString()} · {b.sizeLabel}
                          {b.version ? ` · v${b.version}` : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => doRestore(b.id)}
                        disabled={!!bkpBusy}
                        className="flex shrink-0 items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
                      >
                        {bkpBusy === b.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                        恢复这份
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {note && (
          <p className="mt-3 flex items-center gap-1.5 rounded-md border border-teal-500/20 bg-teal-500/5 px-2.5 py-2 text-[11px] text-zinc-300">
            {busy ? <Loader2 className="h-3 w-3 animate-spin text-teal-400" /> : null}
            {note}
          </p>
        )}

        {/* 开发自测：单机上模拟极端环境，验证调度决策 */}
        <div className="mt-5 border-t border-zinc-800 pt-4">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-300">
            开发自测（模拟极端环境）
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['NO_GPU', '无显卡'],
                ['LOW_VRAM', '6G 显存'],
                ['BAD_PROXY_AND_MIRROR_FAIL', '坏代理'],
                ['PORT_CONFLICT', '端口占用'],
                ['CHINESE_SPACE_PATH', '中文路径'],
              ] as const
            ).map(([sc, label]) => (
              <button
                key={sc}
                disabled={!!mockBusy}
                onClick={async () => {
                  setMockBusy(sc)
                  const r = await runMockTest(sc)
                  setMockResult(r || { scenario: sc, error: '仅桌面端可用' })
                  setMockBusy('')
                }}
                className="rounded-md border border-zinc-700 bg-black/30 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-teal-500/50 hover:text-teal-300 disabled:opacity-40"
              >
                {mockBusy === sc ? <Loader2 className="inline h-3 w-3 animate-spin" /> : null} {label}
              </button>
            ))}
          </div>
          {mockResult && (
            <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded-md border border-zinc-800 bg-black/50 p-2.5 font-mono text-[10px] leading-relaxed text-teal-100/70">
              {JSON.stringify(mockResult, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
