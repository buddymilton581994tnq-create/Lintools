// 霖易工具箱 — Electron 主进程
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const { LocalModelEngine, recommendTier } = require('./llm.cjs')
const comfy = require('./comfyui.cjs')
const res = require('./resilience.cjs')
const { Archiver } = require('./archive.cjs')
const { LoraTrainer } = require('./train.cjs')
const { LocalModelManager } = require('./localmodel.cjs')
const { MossInfer } = require('./mossinfer.cjs')

let engine = null
let comfyEngine = null
let modelHub = null
let trainer = null
let archiver = null
let win = null
let splash = null
let tray = null
let quitting = false

// 系统里挂的代理（Clash 之类）有时连 127.0.0.1 都截，内嵌的 ComfyUI 画面就会变成一片空白。
// 这里强制让本地回环地址直连；对外网的请求仍按系统代理走。
app.commandLine.appendSwitch('proxy-bypass-list', '127.0.0.1;localhost;[::1]')

// 只允许开一个实例：两个实例同时部署 ComfyUI 会把下载文件写花
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

// ---------------------------------------------------------------------------
// 设置（记住「关闭窗口时不再询问」的选择），存在程序自己的数据目录里
// ---------------------------------------------------------------------------

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))
  } catch {
    return {}
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch }
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
  } catch {
    /* 写不进就算了，下次还会问 */
  }
  return next
}

// ---------------------------------------------------------------------------
// 启动画面：盖住整个加载过程，模型就绪了才开主窗口
// ---------------------------------------------------------------------------

function createSplash() {
  splash = new BrowserWindow({
    width: 640,
    height: 360,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#07050f',
    icon: path.join(__dirname, 'icon.ico'),
    show: true,
    webPreferences: { contextIsolation: true },
  })
  splash.loadFile(path.join(__dirname, 'splash.html'))
  splash.on('closed', () => {
    splash = null
  })
}

/** 往启动画面上写一行状态，让用户知道卡在哪一步 */
function splashText(t) {
  if (splash && !splash.isDestroyed()) {
    splash.webContents
      .executeJavaScript(`window.__setSplashText ? window.__setSplashText(${JSON.stringify(t)}) : (document.getElementById('load-text').textContent = ${JSON.stringify(t)})`)
      .catch(() => {})
  }
}

function closeSplash() {
  if (splash && !splash.isDestroyed()) splash.close()
  splash = null
}

// 主窗口开出来的两个条件：页面能画了 + 本地模型就绪（没装模型则不用等）
let winReady = false
let modelReady = false
let opened = false

function maybeOpen() {
  if (opened || !winReady || !modelReady || !win) return
  opened = true
  splashText('加载完毕')
  closeSplash()
  win.show()
  win.focus()
}

// ---------------------------------------------------------------------------
// 本地 AI（ds4f）
// ---------------------------------------------------------------------------

/** 用户目录可能带中文用户名（C:\Users\张三），命令行工具容易翻车；
    检测到就不把环境放 userData，改放空间最大盘的纯英文目录 */
function safeBaseDir() {
  const ud = app.getPath('userData')
  if (res.isPathSafe(ud)) return ud
  return res.safeEngineDir()
}

function defaultAiDir() {
  return path.join(safeBaseDir(), 'ai')
}

function defaultComfyDir() {
  return path.join(safeBaseDir(), 'comfyui')
}

function defaultImgDir() {
  return path.join(app.getPath('pictures'), 'Lintools')
}

function imgDir() {
  return readSettings().imgDir || defaultImgDir()
}

function createEngine() {
  engine = new LocalModelEngine({
    dataDir: readSettings().aiDir || defaultAiDir(),
    resourcesDir: app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'runtime-zip'),
    onProgress: (p) => {
      send('ai:progress', p)
      if (p.label) splashText(p.label)
    },
    onStatus: (s) => {
      send('ai:status', s)
      if (s.state === 'starting') splashText('正在启动本地模型')
      if (s.state === 'ready') splashText('本地模型就绪')
      if (s.state === 'error') splashText('正在进入主界面')
    },
    onLog: () => {},
  })
  return engine
}

/**
 * 上次下载没走完（崩溃、强杀、断网退出）时，进来先问一句要不要接着下。
 * 进度记在 ai/download-state.json，.part 文件还在就能续传。
 */
async function checkPendingDownload() {
  if (!engine || typeof engine.readDownloadState !== 'function') return false
  const st = engine.readDownloadState()
  if (!st) return false

  const doneGb = (st.bytesOnDisk / 1024 ** 3).toFixed(2)
  const totalGb = st.total ? (st.total / 1024 ** 3).toFixed(2) : ''
  let response = 0
  try {
    const picked = await dialog.showMessageBox(win, {
      type: 'question',
      title: '发现未完成的下载',
      message: '上次的模型还没有下完',
      detail: [
        `模型：${st.modelName || st.modelId}`,
        totalGb ? `进度：${doneGb} GB / ${totalGb} GB` : `已下载：${doneGb} GB`,
        '',
        '继续的话从断点接着下，不会重新开始。',
      ].join('\n'),
      buttons: ['继续下载', '放弃并删除'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    response = picked.response
  } catch {
    /* 弹窗失败按继续处理 */
  }

  if (response === 1) {
    engine.discardPartialDownload(st.modelId)
    return false
  }

  // 记下档位，避免接着又被首次引导问一遍
  const target = (require('./llm.cjs').MODELS || []).find((x) => x.id === st.modelId)
  writeSettings({ modelTier: target ? target.tier : 'mid', modelId: st.modelId })
  try {
    engine.writeConfig({ modelId: st.modelId })
  } catch {
    /* ignore */
  }
  engine.ensureReady(st.modelId).catch(() => {})
  return true
}
async function ensureModelTier() {
  const s = readSettings()
  if (s.modelTier) return
  let hw = {}
  try {
    hw = await res.probeEnvironment()
  } catch {
    /* 探测失败就按最低配推 */
  }
  const gpus = Array.isArray(hw.gpus) ? hw.gpus : []
  const best = gpus.reduce((a, b) => (b.vramGb > (a ? a.vramGb : 0) ? b : a), null)
  const vram = best ? Number(best.vramGb) || 0 : 0
  const ram = Number(hw.totalRamGb) || 0
  const recTier = recommendTier(vram, ram)
  const idx = { low: 0, mid: 1, high: 2 }[recTier] ?? 0

  const mark = (t) => (t === recTier ? '   ← 推荐' : '')
  const detail = [
    `检测到：${best ? best.name : '未检测到独立显卡'}，显存 ${vram}GB，内存 ${ram}GB`,
    '',
    '安装包不自带模型，首次使用会按你选的档位下载，之后可以随时在设置里更换。',
    '',
    `兼容 1.5B   约 1.0 GB   2GB 显存即可${mark('compat')}`,
    `低配 3B     约 1.9 GB   3GB 显存起${mark('low')}`,
    `中配 7B     约 4.5 GB   6GB 显存起${mark('mid')}`,
    `高配 14B    约 9.0 GB   9GB 显存起，建议 12GB${mark('high')}`,
    '',
    '档位越高，词库没覆盖的句子翻译越准，但下载更大、占用更多。',
  ].join('\n')

  let response = { compat: 0, low: 1, mid: 2, high: 3 }[recTier] ?? 0
  try {
    const picked = await dialog.showMessageBox(win, {
      type: 'question',
      title: '选择本地模型档位',
      message: '请选择本地模型规格',
      detail,
      buttons: ['兼容 1.5B', '低配 3B', '中配 7B', '高配 14B'],
      defaultId: response,
      cancelId: response,
      noLink: true,
    })
    response = picked.response
  } catch {
    /* 弹窗失败就用推荐档位 */
  }

  const ids = ['ds4f-mini', 'qwen25-3b', 'ds4f-7b', 'ds4f-14b']
  const tiers = ['compat', 'low', 'mid', 'high']
  const pick = Math.max(0, Math.min(3, Number(response) || 0))
  writeSettings({ modelTier: tiers[pick], modelId: ids[pick] })
  try {
    if (engine) engine.writeConfig({ modelId: ids[pick] })
  } catch {
    /* ignore */
  }
}

/** 启动时就拉模型，拉起来（或兜底超时）才放主窗口出来 */
function bootModel() {
  if (!(engine.isInstalled() && engine.config.autoStart)) {
    modelReady = true
    return
  }
  splashText('正在加载本地模型')
  engine
    .start()
    .catch(() => {})
    .finally(() => {
      modelReady = true
      maybeOpen()
    })
  // 兜底：90 秒还没起来先开界面，掉线重连机制在后面接着拉
  setTimeout(() => {
    if (!modelReady) {
      modelReady = true
      maybeOpen()
    }
  }, 90000)
}

// ---------------------------------------------------------------------------
// 内置 ComfyUI 引擎（工作流模式用，按需启停，不开机自启）
// ---------------------------------------------------------------------------

function createComfyEngine() {
  comfyEngine = new comfy.ComfyUIEngine({
    dataDir: readSettings().comfyDir || defaultComfyDir(),
    external: readSettings().comfyExternal || null,
    onProgress: (p) => send('comfy:engine-progress', p),
    onStatus: (s) => send('comfy:engine-status', s),
  })
  return comfyEngine
}

/** 换部署路径 / 换外部整合包后重建引擎，旧的先停掉 */
function recreateEngine() {
  try {
    if (engine) engine.stop()
  } catch {
    /* ignore */
  }
  createEngine()
  send('ai:status', engine.getStatus())
  return engine.getStatus()
}

function recreateComfyEngine() {
  try {
    if (trainer) trainer.stop()
    if (comfyEngine) comfyEngine.stop()
  } catch {
    /* ignore */
  }
  createComfyEngine()
  trainer = new LoraTrainer(
    comfyEngine,
    (t) => send('train:log', t),
    (p) => send('train:progress', p),
  )
  send('comfy:engine-status', comfyEngine.getStatus())
  return comfyEngine.getStatus()
}

/** 后台自动拉起 ComfyUI：标准模式不显示画布，但它得一直跑着，随时能用。
 *  不弹窗、不打断使用，失败只在状态里留一句原因；机器跑不动就不硬拉。 */
async function autoStartComfy() {
  const s = readSettings()
  if (s.comfyAutoStart === false) return
  if (!comfyEngine || !comfyEngine.isInstalled()) {
    comfyEngine?.deployLog('[自动启动] 跳过：还没部署')
    return
  }
  if (comfyEngine.state === 'ready') return
  // 显存太小或者压根没 N 卡：不硬拉，免得整台机器被拖住
  try {
    const gpus = await res.probeGpus()
    const best = gpus.reduce((a, b) => (b.vramGb > (a?.vramGb || 0) ? b : a), null)
    if (best && best.vramGb > 0 && best.vramGb < 4) {
      comfyEngine.deployLog(`[自动启动] 跳过：显存只有 ${best.vramGb}G`)
      return
    }
  } catch {
    /* 探测失败就照常启动 */
  }
  // 等界面先画出来，别跟启动动画抢资源（机械硬盘的机器尤其明显）
  setTimeout(() => {
    if (!comfyEngine || comfyEngine.state === 'ready') return
    comfyEngine.deployLog('[自动启动] 后台启动 ComfyUI')
    comfyEngine.start().catch((e) => {
      comfyEngine.deployLog(`[自动启动] 失败：${e instanceof Error ? e.message : e}`)
    })
  }, 3500)
}

// ---------------------------------------------------------------------------
// 主窗口
// ---------------------------------------------------------------------------

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    title: '霖易工具箱',
    backgroundColor: '#070d0d',
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // 内置浏览器：ComfyUI 和别的网页都在软件里开，不往外抛浏览器
      webviewTag: true,
      // 界面本身是 file:// 加载的，右边那栏要内嵌 http://127.0.0.1:8188 的 ComfyUI 原版界面。
      // 不放开这一项，Chromium 会把这种「file 页面里的 http 子框架」当混合内容拦掉，画布就是一片黑。
      allowRunningInsecureContent: true,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  // 内置浏览器只放 http(s)，并且不许带 preload 之类的特权，防止被页面利用
  win.webContents.on('will-attach-webview', (_e, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    if (!/^https?:\/\//i.test(params.src || '')) params.src = 'about:blank'
  })

  if (!app._lintoolsWebviewHooked) {
    app._lintoolsWebviewHooked = true
    // 内置浏览器里再点链接、或页面自己 window.open，也一律留在软件里，不往外抛
    app.on('web-contents-created', (_e, contents) => {
      if (contents.getType() !== 'webview') return
      contents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) contents.loadURL(url)
        return { action: 'deny' }
      })
      contents.on('will-navigate', (ev, url) => {
        if (!/^https?:\/\//i.test(url)) ev.preventDefault()
      })
    })
  }
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  win.once('ready-to-show', () => {
    winReady = true
    maybeOpen()
  })

  // 点叉号不直接关：先查记没记住选择，没记住就让界面弹自己的询问卡片
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    handleCloseRequest()
  })

  win.on('closed', () => {
    win = null
  })
}

// ---------------------------------------------------------------------------
// 关闭询问：卡片画在软件自己的界面里，这里只负责收答案
// ---------------------------------------------------------------------------

async function handleCloseRequest() {
  // 模型正在下载：退出前让用户决定进度怎么处理
  let pending = null
  try {
    pending = engine && engine.readDownloadState ? engine.readDownloadState() : null
  } catch {
    pending = null
  }
  if (pending) {
    let response = 1
    try {
      const picked = await dialog.showMessageBox(win, {
        type: 'warning',
        title: '模型正在下载',
        message: '本地模型还没下完',
        detail: [
          `模型：${pending.modelName || pending.modelId}`,
          `已下载：${(pending.bytesOnDisk / 1024 ** 3).toFixed(2)} GB`,
          '',
          '保留下载进度的话，下次打开会从断点继续，不用从头再来。',
        ].join('\n'),
        buttons: ['取消', '保留下载进度并退出', '删除下载任务并退出'],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      })
      response = picked.response
    } catch {
      /* 弹窗失败按保留处理 */
    }
    if (response === 0) return
    if (response === 2) {
      try {
        engine.discardPartialDownload(pending.modelId)
      } catch {
        /* ignore */
      }
      quitApp(false)
      return
    }
    quitApp(true)
    return
  }

  const action = readSettings().closeAction || 'ask'
  if (action === 'tray') return hideToTray()
  if (action === 'quit') return quitApp()
  send('app:close-request')
}

function hideToTray() {
  ensureTray()
  if (win) win.hide()
}

function ensureTray() {
  if (tray) return
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray-icon.png'))
  tray = new Tray(icon)
  tray.setToolTip('霖易工具箱')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '打开主窗口',
        click: () => {
          if (win) {
            win.show()
            win.focus()
          }
        },
      },
      { type: 'separator' },
      { label: '退出', click: () => quitApp() },
    ]),
  )
  tray.on('click', () => {
    if (win) {
      win.show()
      win.focus()
    }
  })
}

function cleanAppCache() {
  try {
    const userData = app.getPath('userData')
    const cacheDirs = [
      'Cache',
      'Code Cache',
      'GPUCache',
      'GPUPersistentCache',
      'DawnGraphiteCache',
      'DawnWebGPUCache',
      'GrShaderCache',
      'ShaderCache',
      'blob_storage',
      'Session Storage',
      'Shared Dictionary',
    ]
    for (const dir of cacheDirs) {
      fs.rmSync(path.join(userData, dir), { recursive: true, force: true })
    }
  } catch {
    /* ignore */
  }
}

function quitApp(keepDownloads = false) {
  quitting = true
  try {
    if (trainer) trainer.stop()
    if (engine) {
      if (typeof engine.resetAndClean === 'function') engine.resetAndClean({ keepDownloads })
      else if (typeof engine.stop === 'function') engine.stop()
      else if (typeof engine.killProc === 'function') engine.killProc()
    }
    if (comfyEngine) comfyEngine.stop()
  } catch {
    /* ignore */
  }
  cleanAppCache(keepDownloads)
  if (tray) {
    tray.destroy()
    tray = null
  }
  app.quit()
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('ai:status', () => engine.getStatus())
  ipcMain.handle('ai:install', async (_e, modelId) => {
    try {
      return { ok: true, status: await engine.ensureReady(modelId) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), status: engine.getStatus() }
    }
  })

  ipcMain.handle('ai:start', async () => {
    try {
      return { ok: true, status: await engine.ensureReady() }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), status: engine.getStatus() }
    }
  })

  ipcMain.handle('ai:stop', () => {
    engine.stop()
    return engine.getStatus()
  })

  ipcMain.handle('ai:uninstall', () => engine.uninstall())

  ipcMain.handle('ai:chat', async (_e, payload) => {
    const { requestId, messages, temperature, maxTokens } = payload || {}
    try {
      const text = await engine.chat(
        messages || [],
        (delta) => send('ai:delta', { requestId, ...delta }),
        { temperature, maxTokens },
      )
      return { ok: true, text }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // 界面的关闭询问卡片把答案送回来
  ipcMain.handle('app:close-choice', (_e, payload) => {
    const { action, remember } = payload || {}
    if (action === 'cancel') return
    if (remember && (action === 'tray' || action === 'quit')) writeSettings({ closeAction: action })
    if (action === 'tray') hideToTray()
    else if (action === 'quit') quitApp()
  })

  // ComfyUI 与硬件探测
  ipcMain.handle('comfy:status', (_e, base) => comfy.getStatus(base))
  ipcMain.handle('comfy:models', (_e, base) => comfy.getModelLists(base))
  // ComfyUI 不在线时的兜底：直接扫本地 models 目录
  ipcMain.handle('comfy:local-models', () => {
    try {
      return comfyEngine.localModelLists()
    } catch {
      return null
    }
  })
  ipcMain.handle('comfy:queue', (_e, p) => comfy.queuePrompt(p?.base, p?.prompt))
  ipcMain.handle('comfy:history', (_e, p) => comfy.getHistory(p?.base, p?.id))
  ipcMain.handle('comfy:view', (_e, p) => comfy.fetchImage(p?.base, p?.image))
  ipcMain.handle('comfy:upload', async (_e, p) => {
    try {
      const resUp = await comfy.uploadImage(p?.base, p?.dataUrl, p?.name)
      if (comfyEngine?.comfyRoot && fs.existsSync(comfyEngine.comfyRoot)) {
        const inDir = path.join(comfyEngine.comfyRoot, 'input')
        fs.mkdirSync(inDir, { recursive: true })
        const srcFile = path.join(inDir, resUp.name)
        if (fs.existsSync(srcFile)) {
          for (const alias of ['lintools-input.png', 'lintools-chain.png']) {
            try { fs.copyFileSync(srcFile, path.join(inDir, alias)) } catch {}
          }
        }
      }
      return resUp
    } catch (err) {
      const m = /^data:([^;]+);base64,(.+)$/.exec(String(p?.dataUrl || ''))
      if (m && comfyEngine?.comfyRoot && fs.existsSync(comfyEngine.comfyRoot)) {
        const inDir = path.join(comfyEngine.comfyRoot, 'input')
        fs.mkdirSync(inDir, { recursive: true })
        const fname = String(p?.name || `lintools-${Date.now()}.png`).replace(/[\\/:*?"<>|]/g, '-')
        const buf = Buffer.from(m[2], 'base64')
        fs.writeFileSync(path.join(inDir, fname), buf)
        for (const alias of ['lintools-input.png', 'lintools-chain.png']) {
          try { fs.writeFileSync(path.join(inDir, alias), buf) } catch {}
        }
        return { name: fname, subfolder: '' }
      }
      throw err
    }
  })
  ipcMain.handle('comfy:sync-canvas', async (_e, p) => {
    try {
      if (comfyEngine?.comfyRoot) comfy.ensureDefaultInputImages(comfyEngine.comfyRoot)
      const base = comfy.normBase(p?.base)
      const resp = await fetch(`${base}/lintools/bridge/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p?.id || '', title: p?.title || '工作流', graph: p?.graph || {} }),
        signal: AbortSignal.timeout(3000),
      }).catch(() => null)
      return { ok: !!resp?.ok }
    } catch {
      return { ok: false }
    }
  })
  ipcMain.handle('comfy:interrupt', (_e, base) => comfy.interrupt(base))
  ipcMain.handle('comfy:smart-submit', (_e, p) => comfy.submitSmartTask(p?.base, p?.workflow, p?.customParams))
  ipcMain.handle('ai:director-decide', async (_e, payload) => {
    try {
      const decision = await engine.decideComfyDirectorParams(payload || {})
      return { ok: true, decision }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  // ---- 本地模型（MOSS-Image）----
  const localModels = new LocalModelManager(
    () => (comfyEngine && comfyEngine.comfyRoot) || '',
    (p) => send('local:progress', p),
  )
  // ---- 原生推理引擎（MossInfer，不依赖 ComfyUI）----
  const mossInfer = new MossInfer(
    app.getPath('userData'),
    (p) => send('local:install-progress', p),
    (p) => send('local:gen-progress', p),
  )
  ipcMain.handle('moss:status', () => {
    try {
      return { ok: true, ...mossInfer.status() }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('moss:install', async () => {
    try {
      return await mossInfer.install()
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('moss:cancel-install', () => mossInfer.cancel())
  ipcMain.handle('moss:generate', async (_e, cfg) => {
    try {
      const root = (comfyEngine && comfyEngine.comfyRoot) || ''
      const abs = (name, kind) => {
        if (!name) return ''
        if (path.isAbsolute(String(name))) return String(name)
        return root ? path.join(root, 'models', kind, String(name)) : String(name)
      }
      const args = { ...(cfg || {}) }
      args.dit = abs(args.dit, 'diffusion_models')
      args.te = abs(args.te, 'text_encoders')
      args.vae = abs(args.vae, 'vae')
      const r = await mossInfer.generate(args)
      return { ok: true, ...r }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('moss:cancel', () => mossInfer.cancel())
  ipcMain.handle('local:status', () => {
    try {
      return { ok: true, installed: localModels.installed(), root: comfyEngine?.comfyRoot || '' }
    } catch (e) {
      return { ok: false, installed: [], error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('local:list-repo', async (_e, repo) => {
    try {
      return { ok: true, ...(await localModels.listRepo(repo)) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('local:download', async (_e, repo, precision) => {
    try {
      return await localModels.fetchAll(repo, precision)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('local:cancel', () => localModels.cancel())
  ipcMain.handle('local:save-config', (_e, cfg) => {
    try {
      writeSettings({ localModel: cfg || null })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('ai:core-params', async (_e, payload) => {
    try {
      const result = await engine.decideCoreParams(payload || {})
      return { ok: true, result }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('ai:search-tags', (_e, query, limit) => {
    try {
      const { getUniversalTranslator } = require('./corpus.cjs')
      const customDirs = [engine?.dataDir, engine?.resourcesDir].filter(Boolean)
      const items = getUniversalTranslator(customDirs).searchTags(query, Number(limit) || 24)
      return { ok: true, items }
    } catch (e) {
      return { ok: false, items: [], error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('ai:translate-sentence', (_e, text) => {
    try {
      const { getUniversalTranslator } = require('./corpus.cjs')
      const customDirs = [engine?.dataDir, engine?.resourcesDir].filter(Boolean)
      const resScan = getUniversalTranslator(customDirs).scanHits(String(text || ''))
      return { ok: true, ...resScan }
    } catch (e) {
      return { ok: false, translatedText: String(text || ''), hits: [], error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('sys:hardware', () => comfy.probeHardware())
  // VC 运行库检查 + Windows 更新服务状态（部署 ComfyUI 前前端会先调这个）
  ipcMain.handle('sys:vc-check', async () => {
    const vc = res.checkVcRuntime()
    let wu = { disabled: false, stopped: false, unknown: true }
    try {
      const qc = await res.execText('sc', ['qc', 'wuauserv'], 10000)
      const q = await res.execText('sc', ['query', 'wuauserv'], 10000)
      wu = {
        disabled: /START_TYPE\s*:\s*4\s+DISABLED/i.test(qc),
        stopped: /STATE\s*:\s*1\s+STOPPED/i.test(q),
        unknown: false,
      }
    } catch {
      /* 查不到就当作正常，不拦路 */
    }
    return { vcOk: vc.ok, wu }
  })
  // 安装 VC 运行库（微软官方直链），装完顺手关闭 Windows 更新服务
  ipcMain.handle('sys:vc-install', async () => {
    try {
      const exe = path.join(app.getPath('userData'), 'vc_redist.x64.exe')
      fs.mkdirSync(app.getPath('userData'), { recursive: true })
      await comfy.fetchWithRetry(['https://aka.ms/vs/17/release/vc_redist.x64.exe'], exe, () => {}, 4)
      await res.execText(exe, ['/install', '/quiet', '/norestart'], 300000)
      // 装完关闭 Windows 更新，免得自动重启打断出图（需要管理员权限，失败不报错）
      let wuOff = false
      let wuNote = ''
      try {
        await res.execText('sc', ['config', 'wuauserv', 'start=', 'disabled'], 15000)
        await res.execText('net', ['stop', 'wuauserv'], 20000).catch(() => {})
        const qc = await res.execText('sc', ['qc', 'wuauserv'], 15000).catch(() => '')
        wuOff = /START_TYPE\s*:\s*4\s+DISABLED/i.test(qc)
        if (!wuOff) wuNote = '缺少管理员权限，未能停用 Windows 更新服务；建议以管理员身份重新运行本程序后再试'
      } catch {
        wuNote = '停用 Windows 更新服务失败（权限不足）'
      }
      return { ok: res.checkVcRuntime().ok, wuOff, wuNote }
    } catch (e) {
      return { ok: false, wuOff: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  // 完整环境诊断：显卡档位、VC 运行库、磁盘、端口、中文路径建议
  ipcMain.handle('sys:environment', () => res.probeEnvironment())

  // 内置 ComfyUI 引擎
  ipcMain.handle('comfy:engine-status', () => comfyEngine.getStatus())
  ipcMain.handle('comfy:engine-install', async () => {
    try {
      return { ok: true, status: await comfyEngine.ensureReady() }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), status: comfyEngine.getStatus() }
    }
  })
  ipcMain.handle('comfy:engine-start', async () => {
    try {
      return { ok: true, status: await comfyEngine.start() }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), status: comfyEngine.getStatus() }
    }
  })
  ipcMain.handle('comfy:engine-stop', () => comfyEngine.stop())
  // 暂停下载（进度保留，可继续）/ 清除下载缓存 / 刷新状态
  ipcMain.handle('comfy:engine-pause', () => comfyEngine.pause())
  ipcMain.handle('comfy:engine-purge', () => comfyEngine.purgeDownload())

  ipcMain.handle('comfy:engine-uninstall', () => {
    // 导入的整合包不删文件，只解除关联；内置的才删目录
    if (comfyEngine.external) {
      writeSettings({ comfyExternal: null })
      return recreateComfyEngine()
    }
    return comfyEngine.uninstall()
  })

  // ---- 设置：部署路径、导入整合包、选文件夹 ----
  ipcMain.handle('settings:get', () => {
    const s = readSettings()
    return {
      aiDir: s.aiDir || defaultAiDir(),
      comfyDir: s.comfyDir || defaultComfyDir(),
      imgDir: imgDir(),
      aiDirCustom: !!s.aiDir,
      comfyDirCustom: !!s.comfyDir,
      imgDirCustom: !!s.imgDir,
      comfyExternal: s.comfyExternal || null,
      comfyAutoStart: s.comfyAutoStart === true,
      savedApiConfig: s.savedApiConfig || null,
    }
  })

  ipcMain.handle('settings:save-api-config', (_e, cfg) => {
    if (!cfg) {
      writeSettings({ savedApiConfig: null })
      return { ok: true, savedApiConfig: null }
    }
    const savedApiConfig = {
      providerId: String(cfg.providerId || ''),
      baseUrl: String(cfg.baseUrl || ''),
      apiKey: String(cfg.apiKey || ''),
      model: String(cfg.model || ''),
      extras: String(cfg.extras || ''),
      savedAt: Date.now(),
    }
    writeSettings({ savedApiConfig })
    return { ok: true, savedApiConfig }
  })

  ipcMain.handle('settings:set-comfy-auto', (_e, on) => {
    const next = !!on
    writeSettings({ comfyAutoStart: next })
    return { ok: true, comfyAutoStart: next }
  })

  ipcMain.handle('settings:pick-dir', async (_e, title) => {
    const r = await dialog.showOpenDialog(win, {
      title: title || '选择文件夹',
      properties: ['openDirectory', 'createDirectory'],
    })
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0]
  })

  ipcMain.handle('settings:set-ai-dir', (_e, dir) => {
    writeSettings({ aiDir: dir || null })
    return recreateEngine()
  })

  ipcMain.handle('settings:set-comfy-dir', (_e, dir) => {
    writeSettings({ comfyDir: dir || null })
    return recreateComfyEngine()
  })

  ipcMain.handle('comfy:engine-adopt', (_e, dir) => {
    const found = comfy.inspectComfyDir(dir)
    if (!found.ok) return { ok: false, error: found.error, status: comfyEngine.getStatus() }
    writeSettings({
      comfyExternal: { root: path.resolve(dir), pythonExe: found.pythonExe, mainPy: found.mainPy },
    })
    const status = recreateComfyEngine()
    return { ok: true, status }
  })

  ipcMain.handle('comfy:engine-detach', () => {
    writeSettings({ comfyExternal: null })
    return recreateComfyEngine()
  })

  // ---- 图片保存 ----
  ipcMain.handle('images:save', (_e, p) => {
    try {
      const dataUrl = String(p?.dataUrl || '')
      if (!dataUrl.startsWith('data:')) return { ok: false, error: '图像数据格式无效' }
      const dir = imgDir()
      fs.mkdirSync(dir, { recursive: true })
      const name = String(p?.name || `img-${Date.now()}.png`).replace(/[\\/:*?"<>|]/g, '-')
      const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
      const full = path.join(dir, name)
      fs.writeFileSync(full, buf)
      return { ok: true, path: full, dir }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // 云端接口返回的是临时图片链接：后端立刻下载落盘，防链接过期、防跨域拦截
  ipcMain.handle('images:fetch-url', async (_e, p) => {
    try {
      const url = String(p?.url || '')
      if (!/^https?:\/\//i.test(url)) return { ok: false, error: '链接地址格式无效' }
      const resp = await fetch(url, { signal: AbortSignal.timeout(120000) })
      if (!resp.ok) return { ok: false, error: `下载图片失败 HTTP ${resp.status}` }
      const mime = resp.headers.get('content-type') || 'image/png'
      if (!mime.startsWith('image/')) return { ok: false, error: '远程服务器返回的内容不是有效图像' }
      const buf = Buffer.from(await resp.arrayBuffer())
      if (buf.length > 60 * 1024 * 1024) return { ok: false, error: '图像文件超过 60MB 上限' }
      const ext = mime.includes('webp') ? 'webp' : mime.includes('jpeg') ? 'jpg' : 'png'
      const dir = imgDir()
      fs.mkdirSync(dir, { recursive: true })
      const name = String(p?.name || `霖易工具箱-${Date.now()}.${ext}`).replace(/[\\/:*?"<>|]/g, '-')
      const full = path.join(dir, name)
      fs.writeFileSync(full, buf)
      return { ok: true, path: full, dataUrl: `data:${mime};base64,${buf.toString('base64')}` }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // 换图片保存位置：旧图一并搬过去
  ipcMain.handle('settings:set-img-dir', (_e, dir) => {
    const oldDir = path.resolve(imgDir())
    const next = path.resolve(dir || defaultImgDir())
    try {
      if (next.toLowerCase() !== oldDir.toLowerCase()) {
        if (next.toLowerCase().startsWith(oldDir.toLowerCase() + path.sep)) {
          return { ok: false, error: '不能将保存目录设在当前图片目录的子文件夹中，请另选同级或其他磁盘目录' }
        }
        fs.mkdirSync(next, { recursive: true })
        if (fs.existsSync(oldDir)) {
          for (const f of fs.readdirSync(oldDir)) {
            const from = path.join(oldDir, f)
            const to = path.join(next, f)
            try {
              fs.renameSync(from, to)
            } catch {
              const st = fs.lstatSync(from)
              if (st.isDirectory()) fs.cpSync(from, to, { recursive: true })
              else fs.copyFileSync(from, to)
              fs.rmSync(from, { recursive: true, force: true })
            }
          }
        }
      }
      writeSettings({ imgDir: dir || null })
      return { ok: true, dir: next }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ---- ComfyUI 插件/模型目录迁移：内容搬到新位置，原位置留目录联接（ComfyUI 无感知） ----
  const isJunction = (p) => {
    try {
      return fs.lstatSync(p).isSymbolicLink()
    } catch {
      return false
    }
  }

  ipcMain.handle('comfy:paths', () => {
    const root = comfyEngine.comfyRoot
    const nodesDir = path.join(root, 'custom_nodes')
    const modelsDir = path.join(root, 'models')
    return {
      deployed: comfyEngine.isInstalled(),
      nodesDir,
      modelsDir,
      nodesLinked: isJunction(nodesDir),
      modelsLinked: isJunction(modelsDir),
    }
  })

  // kind: 'nodes' | 'models'；target 为 null 表示迁回原位
  ipcMain.handle('comfy:move-path', async (_e, kind, target) => {
    const name = kind === 'nodes' ? 'custom_nodes' : 'models'
    const src = path.join(comfyEngine.comfyRoot, name)
    const wasRunning = comfyEngine.state === 'ready'
    try {
      if (!comfyEngine.isInstalled()) throw new Error('请先完成 ComfyUI 部署或导入后再执行目录迁移')
      comfyEngine.stop()

      if (target) {
        // 迁出：src → target，原位置留 junction
        if (isJunction(src)) throw new Error('该目录已处于迁出状态，请先迁回原位置后再更换目录')
        fs.mkdirSync(target, { recursive: true })
        if (fs.existsSync(src)) {
          fs.cpSync(src, target, { recursive: true })
          fs.rmSync(src, { recursive: true, force: true })
        }
        await new Promise((resolve, reject) => {
          const ps = spawn('cmd', ['/c', 'mklink', '/J', src, target], { windowsHide: true })
          let err = ''
          ps.stderr.on('data', (c) => (err += c))
          ps.on('error', reject)
          ps.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`建立目录联接失败 ${err.slice(0, 120)}`))))
        })
      } else {
        // 迁回：拆掉 junction，内容搬回来
        if (!isJunction(src)) return { ok: true, ...(await comfyEngine.getStatus()) }
        const real = fs.readlinkSync(src)
        fs.rmSync(src, { force: true })
        fs.mkdirSync(src, { recursive: true })
        if (fs.existsSync(real)) {
          fs.cpSync(real, src, { recursive: true })
          fs.rmSync(real, { recursive: true, force: true })
        }
      }
      if (wasRunning) comfyEngine.start().catch(() => {})
      return { ok: true }
    } catch (e) {
      if (wasRunning) comfyEngine.start().catch(() => {})
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ---- 模型中心 ----
  ipcMain.handle('models:list', () => modelHub.list())
  ipcMain.handle('models:download', async (_e, id) => {
    try {
      if (!comfyEngine.isInstalled()) {
        return { ok: false, error: '请先部署或导入 ComfyUI，完成后即可下载模型至对应目录', list: modelHub.list() }
      }
      return { ok: true, list: await modelHub.download(id) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), list: modelHub.list() }
    }
  })

  // ---- 下载中断：给界面一个「上次没下完，要不要接着下」的结论 ----
  ipcMain.handle('comfy:download-state', () => {
    const s = comfyEngine.getStatus()
    return {
      partial: !!s.partialDownload,
      installed: !!s.installed,
      state: s.state,
      dir: s.dir,
      logPath: comfyEngine.logPath,
      savedState: comfyEngine.readDownloadState(),
    }
  })
  ipcMain.handle('comfy:open-log', () => {
    try {
      shell.showItemInFolder(comfyEngine.logPath)
      return { ok: true, path: comfyEngine.logPath }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  // ---- 存档（备份 / 回滚） ----
  ipcMain.handle('backup:status', () => archiver.status())
  ipcMain.handle('backup:create', (_e, label) => archiver.create(label || '手动备份'))
  ipcMain.handle('backup:list', () => archiver.list())
  ipcMain.handle('backup:restore', (_e, id) => archiver.stage(id))
  ipcMain.handle('backup:apply-now', async (_e, id) => {
    // 立即恢复（界面会提示重启），失败也能说清原因
    const list = archiver.list()
    const t = list.find((b) => b.id === id) || list[0]
    if (!t) return { ok: false, error: '没有可用的存档' }
    const zip = path.join(archiver.root, t.id, t.file || 'app.zip')
    const r = await archiver.restoreNow(zip, t.id, (m) => comfyEngine.deployLog(`[存档] ${m}`))
    return r
  })
  ipcMain.handle('backup:open-dir', () => {
    const dir = archiver.openDir()
    try {
      shell.openPath(dir)
    } catch {
      /* ignore */
    }
    return dir
  })
  ipcMain.handle('backup:set-auto', (_e, on) => {
    writeSettings({ autoRestore: !!on })
    return archiver.status()
  })
  ipcMain.handle('backup:auto-first-run', () => archiver.autoBackupFirstRun())

  // ---- LoRA 训练 ----
  ipcMain.handle('train:status', async () => {
    if (!trainer) return { ready: false, error: '训练模块尚未完成初始化' }
    try {
      const st = await trainer.envStatus()
      return { ...st, outputDir: trainer.outDir, datasetDefault: '' }
    } catch (e) {
      return { ready: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('train:setup', async () => {
    try {
      const st = await trainer.setupEnv()
      return { ok: true, ...st }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('train:start', async (_e, cfg) => {
    try {
      return await trainer.start(cfg || {})
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('train:stop', () => {
    trainer.stop()
    return { ok: true }
  })
  ipcMain.handle('train:pick-dataset', async () => {
    const r = await dialog.showOpenDialog(win, { title: '选择训练用的图片文件夹', properties: ['openDirectory'] })
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0]
  })
  ipcMain.handle('train:reveal', () => {
    try {
      shell.openPath(trainer.outDir)
      return { ok: true, path: trainer.outDir }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  createSplash()
  // 本地回环直连（内嵌 ComfyUI 靠它）
  try {
    const { session } = require('electron')
    await session.defaultSession.setProxy({
      mode: 'system',
      proxyBypassRules: '127.0.0.1;localhost;[::1]',
    })
    // ComfyUI 0.44 会按 Sec-Fetch-* 判断请求是不是跨站，跨站一律 403。
    // 界面是 file:// 打开的，再内嵌 8188 就必然被判成跨站，所以对本地回环地址把这些头去掉。
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/i.test(details.url || '')) {
        for (const k of Object.keys(details.requestHeaders)) {
          if (/^sec-fetch-/i.test(k) || /^referer$/i.test(k) || /^origin$/i.test(k)) delete details.requestHeaders[k]
        }
      }
      callback({ requestHeaders: details.requestHeaders })
    })
  } catch {
    /* 老版本 Electron 不支持就算了 */
  }
  createEngine()
  createComfyEngine()

  // 存档系统：启动先过一次守门（有存档要恢复就现在恢复，界面还没加载，最安全）
  archiver = new Archiver({
    userData: app.getPath('userData'),
    appDir: app.isPackaged ? path.join(process.resourcesPath, 'app') : app.getAppPath(),
    settings: { read: readSettings, write: writeSettings },
  })
  try {
    const boot = await archiver.bootGuard((m) => comfyEngine.deployLog(`[启动] ${m}`))
    if (boot.restored) splashText('已恢复到上一个存档节点')
  } catch {
    /* 存档出问题不能挡住启动 */
  }

  trainer = new LoraTrainer(
    comfyEngine,
    (t) => send('train:log', t),
    (p) => send('train:progress', p),
  )
  modelHub = new comfy.ModelHub(
    () => comfyEngine.comfyRoot,
    (p) => send('models:progress', p),
  )
  registerIpc()
  createWindow()

  win.webContents.once('did-finish-load', () => {
    // 界面画出来了才算启动成功；8 秒后还没被关掉就清零失败计数
    setTimeout(() => archiver.markBootOk(), 8000)
    // 上次下载没下完：主动问一句
    setTimeout(() => {
      try {
        send('comfy:resume-available', {
          partial: comfyEngine.getStatus().partialDownload,
          installed: comfyEngine.isInstalled(),
        })
      } catch {
        /* ignore */
      }
    }, 1500)
    // 首次启动自动存一份出厂快照（后台悄悄做）
    setTimeout(() => archiver.autoBackupFirstRun().catch(() => {}), 20000)
    // ComfyUI 保持关闭，需用户进入工作流模式后手动点击启动
  })

  // 上次下载没下完的先问一句，接着下就不用再走首次引导
  const resumed = await checkPendingDownload()
  if (!resumed) await ensureModelTier()
  bootModel()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else if (win) win.show()
  })
})

app.on('window-all-closed', () => {
  // 正常关窗都被拦下来走询问了，能到这步说明是在退出
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  quitting = true
  try {
    if (trainer) trainer.stop()
    if (engine) {
      if (typeof engine.resetAndClean === 'function') engine.resetAndClean()
      else if (typeof engine.stop === 'function') engine.stop()
      else if (typeof engine.killProc === 'function') engine.killProc()
    }
    if (comfyEngine) comfyEngine.stop()
  } catch {
    /* ignore */
  }
  cleanAppCache()
})
