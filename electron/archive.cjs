'use strict'
/**
 * 存档（备份 / 回滚）：把当前这套程序本体整个打包存一份，出致命问题时能原地回到某个节点。
 *
 * 存的什么：dist（界面）+ electron（主进程与全部逻辑）+ package.json，也就是 resources/app 整个目录。
 * 不存什么：模型（几十 G，备份一次能撑爆盘）、图片、缓存。模型目录本来就在 userData 下，回滚不碰它。
 *
 * 三个使用场景：
 *   1. 首次启动自动存一份「出厂快照」，以后随时能退回去；
 *   2. 设置里手动「立刻备份」，上线新版本前建议点一下；
 *   3. 启动连续失败两次（白屏、主进程炸、界面加载失败）→ 自动恢复最近一份能用的存档。
 */
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const MAX_BACKUPS = 5

function runPs(script, timeoutMs = 180000) {
  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
    })
    let out = ''
    let err = ''
    const dec = new TextDecoder('gbk')
    ps.stdout.on('data', (c) => (out += dec.decode(c, { stream: true })))
    ps.stderr.on('data', (c) => (err += dec.decode(c, { stream: true })))
    const timer = setTimeout(() => {
      try {
        ps.kill()
      } catch {
        /* ignore */
      }
    }, timeoutMs)
    ps.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, out: out + String(e.message || e), err })
    })
    ps.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, out, err })
    })
  })
}

const psQuote = (p) => String(p).replace(/'/g, "''")

function dirSize(dir) {
  let total = 0
  const walk = (d) => {
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else {
        try {
          total += fs.statSync(full).size
        } catch {
          /* ignore */
        }
      }
    }
  }
  walk(dir)
  return total
}

class Archiver {
  /**
   * @param {object} opts
   * @param {string} opts.userData  程序数据目录（设置、备份都在这）
   * @param {string} opts.appDir    程序本体目录（要备份的东西）
   * @param {object} opts.settings  读写设置的钩子：{ read, write }
   */
  constructor(opts) {
    this.userData = opts.userData
    this.appDir = opts.appDir
    this.readSettings = opts.settings.read
    this.writeSettings = opts.settings.write
    this.busy = false
    this.lastError = ''
  }

  get root() {
    return path.join(this.userData, 'backups')
  }

  get pendingPath() {
    return path.join(this.userData, 'pending-restore.json')
  }

  ensureRoot() {
    fs.mkdirSync(this.root, { recursive: true })
  }

  /** 现有的存档列表（新的在前） */
  list() {
    this.ensureRoot()
    const out = []
    for (const name of fs.readdirSync(this.root)) {
      const dir = path.join(this.root, name)
      const mf = path.join(dir, 'manifest.json')
      if (!fs.existsSync(mf)) continue
      try {
        const m = JSON.parse(fs.readFileSync(mf, 'utf8'))
        if (!fs.existsSync(path.join(dir, m.file || 'app.zip'))) continue
        out.push(m)
      } catch {
        /* 坏档跳过 */
      }
    }
    out.sort((a, b) => (b.at || 0) - (a.at || 0))
    return out
  }

  status() {
    const st = this.readSettings() || {}
    return {
      appDir: this.appDir,
      root: this.root,
      backups: this.list(),
      autoBackupFirstRun: st.autoBackupDone === true,
      autoRestoreOnCrash: st.autoRestore !== false,
      bootAttempts: st.bootAttempts || 0,
      pendingRestore: this.readPending(),
      busy: this.busy,
      lastError: this.lastError,
    }
  }

  readPending() {
    try {
      return JSON.parse(fs.readFileSync(this.pendingPath, 'utf8'))
    } catch {
      return null
    }
  }

  clearPending() {
    try {
      fs.rmSync(this.pendingPath, { force: true })
    } catch {
      /* ignore */
    }
  }

  /** 立刻打一份存档。label 会显示在列表里（首次启动 / 手动 / 升级前） */
  async create(label = '手动备份') {
    if (this.busy) return { ok: false, error: '备份任务正在执行中，请稍候' }
    this.busy = true
    this.lastError = ''
    try {
      this.ensureRoot()
      const at = Date.now()
      const id = new Date(at).toISOString().replace(/[:.]/g, '-')
      const dir = path.join(this.root, id)
      fs.mkdirSync(dir, { recursive: true })
      const zip = path.join(dir, 'app.zip')
      const stagingSrc = path.join(this.userData, 'backups', '_pack_src')
      fs.rmSync(stagingSrc, { recursive: true, force: true })
      fs.mkdirSync(stagingSrc, { recursive: true })
      fs.cpSync(this.appDir, stagingSrc, {
        recursive: true,
        filter: (s) => !/\.bak($|_|\.)/i.test(path.basename(s)) && path.basename(s) !== 'node_modules',
      })
      const r = await runPs(
        `Compress-Archive -Path '${psQuote(path.join(stagingSrc, '*'))}' -DestinationPath '${psQuote(zip)}' -Force`,
        300000,
      )
      fs.rmSync(stagingSrc, { recursive: true, force: true })
      if (r.code !== 0 || !fs.existsSync(zip)) {
        this.lastError = `打包失败：${(r.err || r.out).trim().slice(0, 200)}`
        fs.rmSync(dir, { recursive: true, force: true })
        return { ok: false, error: this.lastError }
      }
      const size = fs.statSync(zip).size
      const manifest = {
        id,
        at,
        label,
        file: 'app.zip',
        size,
        sizeLabel: `${(size / 1024 ** 2).toFixed(1)} MB`,
        appDir: this.appDir,
        version: this.appVersion(),
      }
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
      this.prune()
      return { ok: true, backup: manifest, backups: this.list() }
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
      return { ok: false, error: this.lastError }
    } finally {
      this.busy = false
    }
  }

  appVersion() {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(this.appDir, 'package.json'), 'utf8'))
      return pkg.version || ''
    } catch {
      return ''
    }
  }

  /** 只留最近 MAX_BACKUPS 份，旧的删掉省空间 */
  prune() {
    const list = this.list()
    for (const old of list.slice(MAX_BACKUPS)) {
      try {
        fs.rmSync(path.join(this.root, old.id), { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * 标记「下次启动前把这份存档盖回去」。
   * 不在运行中直接覆盖：Electron 正跑着这套代码，边跑边改容易改出半截文件。
   */
  stage(id) {
    const list = this.list()
    const target = list.find((b) => b.id === id) || list[0]
    if (!target) return { ok: false, error: '暂无可用的备份存档' }
    try {
      fs.writeFileSync(
        this.pendingPath,
        JSON.stringify({ id: target.id, zip: path.join(this.root, target.id, target.file || 'app.zip'), at: Date.now() }, null, 2),
        'utf8'
      )
      return { ok: true, pending: target }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 启动时调用：有待恢复的存档就盖回去，返回是否恢复过 */
  async applyPending(log = () => {}) {
    const pending = this.readPending()
    if (!pending) return { restored: false }
    if (!fs.existsSync(pending.zip)) {
      log(`待恢复的存档文件不存在：${pending.zip}`)
      this.clearPending()
      return { restored: false, error: '备份存档文件不存在或已丢失' }
    }
    const r = await this.restoreNow(pending.zip, pending.id, log)
    if (r.ok) this.clearPending()
    return r.ok ? { restored: true, id: pending.id } : { restored: false, error: r.error }
  }

  /** 把一个存档包真正盖回 appDir（启动早期调用，界面还没加载，安全） */
  async restoreNow(zip, id, log = () => {}) {
    const staging = path.join(this.userData, 'backups', '_staging')
    try {
      fs.rmSync(staging, { recursive: true, force: true })
      fs.mkdirSync(staging, { recursive: true })
      log(`正在解包存档 ${id || ''}`)
      const r = await runPs(`Expand-Archive -Path '${psQuote(zip)}' -DestinationPath '${psQuote(staging)}' -Force`, 300000)
      if (r.code !== 0) throw new Error((r.err || r.out).trim().slice(0, 200) || '解压存档失败')
      // 先把当前这套挪到 _pre-restore，恢复中途出事还能手动退回来
      const safety = path.join(this.userData, 'backups', '_pre-restore')
      fs.rmSync(safety, { recursive: true, force: true })
      try {
        fs.cpSync(this.appDir, safety, { recursive: true })
      } catch {
        /* 存不下也继续 */
      }
      // 逐个文件覆盖式恢复（比整目录重命名稳，不会把正在用的路径换掉）
      const copyOver = (from, to) => {
        for (const e of fs.readdirSync(from, { withFileTypes: true })) {
          const src = path.join(from, e.name)
          const dst = path.join(to, e.name)
          if (e.isDirectory()) {
            fs.mkdirSync(dst, { recursive: true })
            copyOver(src, dst)
          } else {
            fs.mkdirSync(path.dirname(dst), { recursive: true })
            fs.copyFileSync(src, dst)
          }
        }
      }
      copyOver(staging, this.appDir)
      fs.rmSync(staging, { recursive: true, force: true })
      log(`存档 ${id || ''} 已恢复到 ${this.appDir}`)
      return { ok: true }
    } catch (e) {
      log(`恢复失败：${e instanceof Error ? e.message : e}`)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 启动时的守门人：记账本次启动、若有待恢复项就应用、连续失败两次自动回滚。返回 {attempts, restored} */
  async bootGuard(log = () => {}) {
    const st = this.readSettings() || {}
    const attempts = (st.bootAttempts || 0) + 1
    this.writeSettings({ bootAttempts: attempts, lastBootAt: Date.now() })
    log(`第 ${attempts} 次启动`)
    const pend = await this.applyPending(log)
    if (pend.restored) return { attempts, restored: true, id: pend.id }
    // 自动回滚改为显式开启，避免悄悄把改过的文件整份盖回去
    if (attempts >= 2 && st.autoRestore === true) {
      const list = this.list()
      if (list.length) {
        const zip = path.join(this.root, list[0].id, list[0].file || 'app.zip')
        if (fs.existsSync(zip)) {
          log(`连续 ${attempts} 次没启动成功，自动恢复到 ${list[0].id}`)
          const r = await this.restoreNow(zip, list[0].id, log)
          if (r.ok) return { attempts, restored: true, id: list[0].id }
        }
      }
    }
    return { attempts, restored: false }
  }

  markBootOk() {
    this.writeSettings({ bootAttempts: 0 })
  }

  /** 首次启动自动存一份出厂快照（后台做，不挡界面） */
  async autoBackupFirstRun() {
    const st = this.readSettings() || {}
    if (st.autoBackupDone) return { ok: true, skipped: true }
    const r = await this.create('首次启动 · 出厂快照')
    if (r.ok) this.writeSettings({ autoBackupDone: true })
    return r
  }

  openDir() {
    this.ensureRoot()
    return this.root
  }
}

module.exports = { Archiver, dirSize, runPs }
