'use strict'
// 渲染进程与主进程之间唯一的一座桥，只暴露本地 AI 和窗口交互相关能力
const { contextBridge, ipcRenderer } = require('electron')

function subscribe(channel, cb) {
  const handler = (_e, data) => cb(data)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('lintools', {
  ai: {
    status: () => ipcRenderer.invoke('ai:status'),
    install: (modelId) => ipcRenderer.invoke('ai:install', modelId),
    start: () => ipcRenderer.invoke('ai:start'),
    stop: () => ipcRenderer.invoke('ai:stop'),
    uninstall: () => ipcRenderer.invoke('ai:uninstall'),
    chat: (payload) => ipcRenderer.invoke('ai:chat', payload),
    directorDecide: (payload) => ipcRenderer.invoke('ai:director-decide', payload),
    coreParams: (payload) => ipcRenderer.invoke('ai:core-params', payload),
    localStatus: () => ipcRenderer.invoke('local:status'),
    mossStatus: () => ipcRenderer.invoke('moss:status'),
    mossInstall: () => ipcRenderer.invoke('moss:install'),
    mossCancelInstall: () => ipcRenderer.invoke('moss:cancel-install'),
    mossGenerate: (cfg) => ipcRenderer.invoke('moss:generate', cfg),
    mossCancel: () => ipcRenderer.invoke('moss:cancel'),
    onMossInstallProgress: (cb) => subscribe('local:install-progress', cb),
    onMossGenProgress: (cb) => subscribe('local:gen-progress', cb),
    localListRepo: (repo) => ipcRenderer.invoke('local:list-repo', repo),
    localDownload: (repo, precision) => ipcRenderer.invoke('local:download', repo, precision),
    localCancel: () => ipcRenderer.invoke('local:cancel'),
    localSaveConfig: (cfg) => ipcRenderer.invoke('local:save-config', cfg),
    onLocalProgress: (cb) => subscribe('local:progress', cb),
    searchTags: (query, limit) => ipcRenderer.invoke('ai:search-tags', query, limit),
    translateSentence: (text) => ipcRenderer.invoke('ai:translate-sentence', text),
    onProgress: (cb) => subscribe('ai:progress', cb),
    onStatus: (cb) => subscribe('ai:status', cb),
    onDelta: (cb) => subscribe('ai:delta', cb),
  },
  app: {
    // 点了窗口叉号，主进程让界面弹自己的询问卡片
    onCloseRequest: (cb) => subscribe('app:close-request', cb),
    // 界面把选择送回来：tray（藏托盘）/ quit（直接关）/ cancel（取消），remember = 勾了不再询问
    respondClose: (action, remember) => ipcRenderer.invoke('app:close-choice', { action, remember }),
  },
  comfy: {
    status: (base) => ipcRenderer.invoke('comfy:status', base),
    models: (base) => ipcRenderer.invoke('comfy:models', base),
    localModels: () => ipcRenderer.invoke('comfy:local-models'),
    queue: (base, prompt) => ipcRenderer.invoke('comfy:queue', { base, prompt }),
    history: (base, id) => ipcRenderer.invoke('comfy:history', { base, id }),
    view: (base, image) => ipcRenderer.invoke('comfy:view', { base, image }),
    upload: (base, dataUrl, name) => ipcRenderer.invoke('comfy:upload', { base, dataUrl, name }),
    syncCanvas: (base, id, title, graph) => ipcRenderer.invoke('comfy:sync-canvas', { base, id, title, graph }),
    interrupt: (base) => ipcRenderer.invoke('comfy:interrupt', base),
    smartSubmit: (base, workflow, customParams) => ipcRenderer.invoke('comfy:smart-submit', { base, workflow, customParams }),
    // 内置引擎：一键部署、启停、进度与状态事件
    engineStatus: () => ipcRenderer.invoke('comfy:engine-status'),
    engineInstall: () => ipcRenderer.invoke('comfy:engine-install'),
    engineStart: () => ipcRenderer.invoke('comfy:engine-start'),
    engineStop: () => ipcRenderer.invoke('comfy:engine-stop'),
    enginePause: () => ipcRenderer.invoke('comfy:engine-pause'),
    enginePurge: () => ipcRenderer.invoke('comfy:engine-purge'),
    engineUninstall: () => ipcRenderer.invoke('comfy:engine-uninstall'),
    engineAdopt: (dir) => ipcRenderer.invoke('comfy:engine-adopt', dir),
    engineDetach: () => ipcRenderer.invoke('comfy:engine-detach'),
    onEngineProgress: (cb) => subscribe('comfy:engine-progress', cb),
    onEngineStatus: (cb) => subscribe('comfy:engine-status', cb),
    // 上次没下完：进来先问一句要不要接着下
    downloadState: () => ipcRenderer.invoke('comfy:download-state'),
    onResumeAvailable: (cb) => subscribe('comfy:resume-available', cb),
    openLog: () => ipcRenderer.invoke('comfy:open-log'),
  },
  // 存档：备份当前程序本体、列出、回滚
  backup: {
    status: () => ipcRenderer.invoke('backup:status'),
    create: (label) => ipcRenderer.invoke('backup:create', label),
    list: () => ipcRenderer.invoke('backup:list'),
    restore: (id) => ipcRenderer.invoke('backup:restore', id),
    applyNow: (id) => ipcRenderer.invoke('backup:apply-now', id),
    openDir: () => ipcRenderer.invoke('backup:open-dir'),
    setAuto: (on) => ipcRenderer.invoke('backup:set-auto', on),
    autoFirstRun: () => ipcRenderer.invoke('backup:auto-first-run'),
  },
  // LoRA 训练
  train: {
    status: () => ipcRenderer.invoke('train:status'),
    setup: () => ipcRenderer.invoke('train:setup'),
    start: (cfg) => ipcRenderer.invoke('train:start', cfg),
    stop: () => ipcRenderer.invoke('train:stop'),
    pickDataset: () => ipcRenderer.invoke('train:pick-dataset'),
    reveal: () => ipcRenderer.invoke('train:reveal'),
    onLog: (cb) => subscribe('train:log', cb),
    onProgress: (cb) => subscribe('train:progress', cb),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    pickDir: (title) => ipcRenderer.invoke('settings:pick-dir', title),
    setAiDir: (dir) => ipcRenderer.invoke('settings:set-ai-dir', dir),
    setComfyDir: (dir) => ipcRenderer.invoke('settings:set-comfy-dir', dir),
    setImgDir: (dir) => ipcRenderer.invoke('settings:set-img-dir', dir),
    setComfyAuto: (on) => ipcRenderer.invoke('settings:set-comfy-auto', on),
    saveApiConfig: (cfg) => ipcRenderer.invoke('settings:save-api-config', cfg),
  },
  images: {
    save: (dataUrl, name) => ipcRenderer.invoke('images:save', { dataUrl, name }),
    fetchUrl: (url, name) => ipcRenderer.invoke('images:fetch-url', { url, name }),
  },
  comfyPaths: {
    get: () => ipcRenderer.invoke('comfy:paths'),
    move: (kind, target) => ipcRenderer.invoke('comfy:move-path', kind, target),
  },
  models: {
    list: () => ipcRenderer.invoke('models:list'),
    download: (id) => ipcRenderer.invoke('models:download', id),
    onProgress: (cb) => subscribe('models:progress', cb),
  },
  sys: {
    hardware: () => ipcRenderer.invoke('sys:hardware'),
    environment: () => ipcRenderer.invoke('sys:environment'),
    mockTest: (scenario) => ipcRenderer.invoke('dev:mock-test', scenario),
    vcCheck: () => ipcRenderer.invoke('sys:vc-check'),
    vcInstall: () => ipcRenderer.invoke('sys:vc-install'),
  },
})

// ---------------------------------------------------------------------------
// 模型档位切换条
// 界面是打包后的 React 产物，改不了组件，所以在这里往顶栏注入一条。
// 只做展示和切换，不碰业务逻辑，出问题删掉这一段就能回到原样。
// ---------------------------------------------------------------------------

const TIER_STYLE = {
  wrap: [
    'display:inline-flex',
    'align-items:center',
    'gap:4px',
    'margin-right:10px',
    'padding:3px 5px',
    'border-radius:9px',
    'border:1px solid rgba(45,212,191,0.35)',
    'background:rgba(8,18,18,0.9)',
    'font:11px/1 system-ui,-apple-system,sans-serif',
    'user-select:none',
  ].join(';'),
  idle: [
    'padding:4px 9px',
    'border-radius:6px',
    'border:1px solid transparent',
    'background:transparent',
    'color:#8fa3a3',
    'cursor:pointer',
    'font-size:11px',
    'transition:all .15s',
  ].join(';'),
  active: [
    'padding:4px 9px',
    'border-radius:6px',
    'border:1px solid rgba(45,212,191,0.55)',
    'background:rgba(45,212,191,0.16)',
    'color:#7fe8d4',
    'cursor:default',
    'font-size:11px',
    'font-weight:600',
  ].join(';'),
}

async function mountTierSwitcher() {
  if (document.getElementById('lt-tier-switcher')) return true
  let status = null
  try {
    status = await ipcRenderer.invoke('ai:status')
  } catch {
    return false
  }
  if (!status || !Array.isArray(status.catalog) || !status.catalog.length) return false

  // 锚到「设置」按钮前面，位置和右上角那排按钮齐平
  const anchor = Array.from(document.querySelectorAll('button')).find(
    (b) => (b.textContent || '').trim() === '设置',
  )
  if (!anchor || !anchor.parentElement) return false

  const wrap = document.createElement('div')
  wrap.id = 'lt-tier-switcher'
  wrap.style.cssText = TIER_STYLE.wrap
  wrap.title = '本机模型档位，点一下切换会按档位重新部署'

  for (const m of status.catalog) {
    const btn = document.createElement('button')
    btn.textContent = m.short || m.name || m.id
    btn.title = m.note || ''
    btn.style.cssText = m.active ? TIER_STYLE.active : TIER_STYLE.idle
    btn.addEventListener('mouseenter', () => {
      if (!btn.dataset.active) btn.style.background = 'rgba(255,255,255,0.06)'
    })
    btn.addEventListener('mouseleave', () => {
      if (!btn.dataset.active) btn.style.background = 'transparent'
    })
    if (m.active) {
      btn.dataset.active = '1'
      btn.disabled = true
      btn.title = `${m.label || m.name} · 当前运行中`
    }
    btn.addEventListener('click', async () => {
      if (btn.dataset.active) return
      const ok = window.confirm(
        `切换到「${m.short || m.name}」？\n${m.label || ''}\n${m.installed ? '本地已下载，直接切换。' : '本地还没有这个模型，会开始下载。'}`,
      )
      if (!ok) return
      const origin = btn.textContent
      btn.textContent = '切换中…'
      btn.disabled = true
      try {
        await ipcRenderer.invoke('ai:install', m.id)
      } catch (e) {
        /* 失败保持原样，状态由主进程推送 */
      }
      btn.textContent = origin
      btn.disabled = false
      location.reload()
    })
    wrap.appendChild(btn)
  }

  anchor.parentElement.insertBefore(wrap, anchor)
  return true
}

// React 渲染是异步的，而且状态变化会重渲染顶栏把注入的节点冲掉，
// 所以低频轮询保活：没了就补回去，在就什么都不做。
function keepTierSwitcher() {
  if (!document.getElementById('lt-tier-switcher')) {
    mountTierSwitcher().catch(() => {})
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', keepTierSwitcher, { once: true })
} else {
  keepTierSwitcher()
}
setInterval(keepTierSwitcher, 3000)
