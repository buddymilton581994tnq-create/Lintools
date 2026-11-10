// 存档（备份 / 回滚）在渲染进程一侧的封装：主进程负责打包，这里只转发。
export interface BackupItem {
  id: string
  at: number
  label: string
  file: string
  size: number
  sizeLabel: string
  appDir: string
  version?: string
}

export interface BackupStatus {
  appDir: string
  root: string
  backups: BackupItem[]
  autoBackupFirstRun: boolean
  autoRestoreOnCrash: boolean
  bootAttempts: number
  pendingRestore: { id: string; zip: string; at: number } | null
  busy: boolean
  lastError: string
}

interface BackupBridge {
  status: () => Promise<BackupStatus>
  create: (label?: string) => Promise<{ ok: boolean; backup?: BackupItem; backups?: BackupItem[]; error?: string }>
  list: () => Promise<BackupItem[]>
  restore: (id: string) => Promise<{ ok: boolean; pending?: BackupItem; error?: string }>
  applyNow: (id: string) => Promise<{ ok: boolean; error?: string }>
  openDir: () => Promise<string>
  setAuto: (on: boolean) => Promise<BackupStatus>
  autoFirstRun: () => Promise<{ ok: boolean; skipped?: boolean; backup?: BackupItem; error?: string }>
}

function bridge(): BackupBridge | null {
  const w = window as unknown as { lintools?: { backup?: BackupBridge } }
  return w.lintools?.backup ?? null
}

export const backupStatus = (): Promise<BackupStatus | null> => {
  const b = bridge()
  return b ? b.status().catch(() => null) : Promise.resolve(null)
}

export const backupCreate = (label?: string) =>
  bridge()?.create(label) ?? Promise.resolve({ ok: false, error: '仅桌面端可用' })

export const backupList = (): Promise<BackupItem[]> => {
  const b = bridge()
  return b ? b.list().catch(() => []) : Promise.resolve([])
}

/** 标记下次启动时恢复（不会当场覆盖正在运行的文件） */
export const backupRestore = (id: string) =>
  bridge()?.restore(id) ?? Promise.resolve({ ok: false, error: '仅桌面端可用' })

/** 立刻恢复（覆盖式），恢复完需要重启软件 */
export const backupApplyNow = (id: string) =>
  bridge()?.applyNow(id) ?? Promise.resolve({ ok: false, error: '仅桌面端可用' })

export const backupOpenDir = () => bridge()?.openDir() ?? Promise.resolve('')

export const backupSetAuto = (on: boolean) => bridge()?.setAuto(on)

export const backupAutoFirstRun = () => bridge()?.autoFirstRun()
