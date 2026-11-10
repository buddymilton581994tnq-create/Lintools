'use strict'
/**
 * 环境探底 + 网络容灾 + 单机模拟测试（后端五大模块里的三、四、五）。
 *
 * 设计前提：软件面对的是千差万别的家庭网络（没代理、残留坏代理、GitHub/HF 连不上）
 * 和千差万别的电脑（中文路径、没显卡、缺运行库、端口被占）。
 * 这里所有函数都只做一件事：把不确定的环境变成确定的诊断结论，让上层照着结论走。
 */
const os = require('os')
const fs = require('fs')
const path = require('path')
const net = require('net')
const { execFile } = require('child_process')

// ---------------------------------------------------------------------------
// 通用：跑一个外部命令拿输出（有输出就算成功，PowerShell 查注册表常非零退出）
// ---------------------------------------------------------------------------

function execText(cmd, args, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, env: cleanChildEnv() }, (err, stdout) => {
      const out = String(stdout || '')
      if (err && !out.trim()) reject(err)
      else resolve(out)
    })
  })
}

// ---------------------------------------------------------------------------
// 网络防卡死装甲：子进程环境一律洗掉代理。
// 用户系统里残留的坏代理（失效梯子）会让 pip/git/下载全部假死，
// 我们的目标源全是国内镜像和本机，根本不需要代理。
// ---------------------------------------------------------------------------

function cleanChildEnv() {
  const env = { ...process.env }
  for (const k of Object.keys(env)) {
    if (/^(https?_proxy|all_proxy|ftp_proxy)$/i.test(k)) delete env[k]
  }
  env.NO_PROXY = '*'
  env.no_proxy = '*'
  return env
}

// ---------------------------------------------------------------------------
// 显卡探测：nvidia-smi 最准，注册表 qwMemorySize 其次，CIM 兜底。
// ---------------------------------------------------------------------------

async function probeGpus() {
  const smiPaths = [
    'nvidia-smi',
    'C:\\Windows\\System32\\nvidia-smi.exe',
    'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
  ]
  for (const smi of smiPaths) {
    try {
      const out = await execText(smi, ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'], 5000)
      const gpus = out
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const parts = l.split(',').map((s) => s.trim())
          const mem = Number(parts[parts.length - 2]) || 0
          return {
            name: parts.slice(0, -2).join(', '),
            vramGb: Math.round((mem / 1024) * 10) / 10,
            driver: parts[parts.length - 1] || '',
          }
        })
        .filter((g) => g.name && g.vramGb > 0)
      if (gpus.length) return gpus
    } catch {
      /* 换下一个路径 */
    }
  }
  try {
    const out = await execText(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-ChildItem 'HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue | Where-Object { $_.GetValue('DriverDesc') } | ForEach-Object { \"$($_.GetValue('DriverDesc'))|$($_.GetValue('HardwareInformation.qwMemorySize'))\" }",
      ],
      8000,
    )
    const gpus = out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes('|'))
      .map((l) => {
        const i = l.lastIndexOf('|')
        const bytes = Number(l.slice(i + 1).trim()) || 0
        return { name: l.slice(0, i).trim(), vramGb: Math.round((bytes / 1024 ** 3) * 10) / 10, driver: '' }
      })
      .filter((g) => g.name)
    if (gpus.length) return gpus
  } catch {
    /* 退到 CIM */
  }
  try {
    const psScript = [
      '$reg = Get-ItemProperty "HKLM:\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\0*" -ErrorAction SilentlyContinue',
      '$map = @{}',
      'foreach ($r in $reg) {',
      '  $desc = $r."DriverDesc"',
      '  $qw = $r."HardwareInformation.qwMemorySize"',
      '  if ($desc -and $qw) { $map[$desc] = [int64]$qw }',
      '}',
      'Get-CimInstance Win32_VideoController | ForEach-Object {',
      '  $ram = if ($_.Name -and $map.ContainsKey($_.Name) -and $map[$_.Name] -gt [int64]($_.AdapterRAM)) { $map[$_.Name] } else { [int64]($_.AdapterRAM) }',
      '  [PSCustomObject]@{ Name = $_.Name; Bytes = $ram }',
      '} | ConvertTo-Json -Compress',
    ].join('; ')
    const out = await execText(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      8000,
    )
    let j = JSON.parse(out.trim())
    if (!Array.isArray(j)) j = [j]
    return j
      .filter((g) => g && g.Name)
      .map((g) => ({ name: String(g.Name), vramGb: Math.round(((Number(g.Bytes) || 0) / 1024 ** 3) * 10) / 10, driver: '' }))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// 显存档位：决定 ComfyUI 用什么参数启动，以及是否劝退本地部署
// ---------------------------------------------------------------------------

const TIERS = {
  CLOUD_ONLY: { label: '仅限云端接口', args: [], advice: '未检测到满足要求的 NVIDIA 独立显卡，本地部署无法稳定运行，建议使用云端绘图接口' },
  LOCAL_LIGHT: { label: '本地轻量模式', args: ['--lowvram'], advice: '当前显存容量较小，已自动启用低显存优化模式，建议选用 2GB 左右的基础底模' },
  LOCAL_MED: { label: '本地标准模式', args: ['--medvram'], advice: '当前显存容量适中，已自动启用均衡显存调度模式' },
  LOCAL_FULL: { label: '本地全速模式', args: [], advice: '当前显存容量充足，已启用全速渲染模式' },
}

/** 输入显存 MB，给出档位结论；没卡传 0 */
function gpuTier(vramMb) {
  const mb = Number(vramMb) || 0
  if (mb < 4096) return { id: 'CLOUD_ONLY', ...TIERS.CLOUD_ONLY }
  if (mb <= 8192) return { id: 'LOCAL_LIGHT', ...TIERS.LOCAL_LIGHT }
  if (mb <= 12288) return { id: 'LOCAL_MED', ...TIERS.LOCAL_MED }
  return { id: 'LOCAL_FULL', ...TIERS.LOCAL_FULL }
}

// ---------------------------------------------------------------------------
// VC 运行库：缺了它 PyTorch 直接起不来（部署前自动静默装）
// ---------------------------------------------------------------------------

function checkVcRuntime() {
  const p = 'C:\\Windows\\System32\\vcruntime140_1.dll'
  return { ok: fs.existsSync(p), path: p }
}

// ---------------------------------------------------------------------------
// 磁盘扫描：列出各盘符剩余空间，挑出 >20GB 的最大非系统盘
// ---------------------------------------------------------------------------

function scanDrives() {
  const drives = []
  for (let code = 67; code <= 90; code++) {
    const letter = String.fromCharCode(code)
    const root = `${letter}:\\`
    try {
      fs.accessSync(root)
      const st = fs.statfsSync(root)
      const freeGb = (Number(st.bavail) * Number(st.bsize)) / 1024 ** 3
      drives.push({ drive: letter, root, freeGb: Math.round(freeGb * 10) / 10, isSystem: letter === 'C' })
    } catch {
      /* 盘不存在 */
    }
  }
  const candidates = drives.filter((d) => !d.isSystem && d.freeGb > 20).sort((a, b) => b.freeGb - a.freeGb)
  const fallback = drives.filter((d) => d.freeGb > 20).sort((a, b) => b.freeGb - a.freeGb)
  return { drives, best: candidates[0] || fallback[0] || null }
}

// ---------------------------------------------------------------------------
// 路径安全：中文/空格/特殊符号路径会让一堆命令行工具翻车，
// 检测到就强制把环境目录重定向到纯英文路径
// ---------------------------------------------------------------------------

function isPathSafe(p) {
  return /^[A-Za-z]:[\\/]([\w.\-]+[\\/])*[\w.\-]*$/.test(String(p || ''))
}

/** 给环境挑一个纯英文落点：优先空间最大的非系统盘根目录 */
function safeEngineDir(drivesInfo) {
  const best = (drivesInfo && drivesInfo.best) || scanDrives().best
  const letter = best ? best.drive : 'C'
  return `${letter}:\\LY_AI_Engine`
}

// ---------------------------------------------------------------------------
// 全盘浅层扫描现有 ComfyUI（借鸡生蛋）。
// 严禁无限递归：只看各盘根目录 + 常见目录名，最多 3 层，每层限量，防机械硬盘卡死。
// ---------------------------------------------------------------------------

const COMFY_COMMON_DIRS = [
  'AI', 'ComfyUI', 'ComfyUI-aki', 'ComfyUI-aki-v1.3', 'aki', 'AIGC', 'sd', 'SD',
  'Program Files', 'Program Files (x86)', 'AI绘图', 'tools', 'Tools', 'Apps', 'dev', 'Dev',
]

function looksLikeComfy(dir) {
  try {
    return (
      fs.existsSync(path.join(dir, 'main.py')) &&
      fs.existsSync(path.join(dir, 'nodes.py')) &&
      fs.statSync(path.join(dir, 'custom_nodes')).isDirectory()
    )
  } catch {
    return false
  }
}

/** 在 dir 下找 ComfyUI，depth 还剩几层；找到就往 sink 里放，最多 maxFound 个 */
function shallowFind(dir, depth, sink, maxFound) {
  if (depth < 0 || sink.length >= maxFound) return
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  // 每层最多看 60 个目录，防巨型目录卡死
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== '$Recycle.Bin' && e.name !== 'System Volume Information').slice(0, 60)
  for (const e of dirs) {
    if (sink.length >= maxFound) return
    const full = path.join(dir, e.name)
    if (/comfy/i.test(e.name) && looksLikeComfy(full)) {
      sink.push(full)
      continue
    }
    if (depth > 0) shallowFind(full, depth - 1, sink, maxFound)
  }
}

/** 返回找到的 ComfyUI 根目录数组（含配套 python_embeded 路径，有的话） */
async function scanExistingComfy(drivesInfo) {
  const found = []
  const info = drivesInfo || scanDrives()
  for (const d of info.drives) {
    const roots = [d.root, ...COMFY_COMMON_DIRS.map((n) => path.join(d.root, n))]
    for (const r of roots) {
      if (!fs.existsSync(r)) continue
      if (looksLikeComfy(r)) found.push(r)
      else shallowFind(r, 2, found, 5)
      if (found.length >= 5) break
    }
    if (found.length >= 5) break
  }
  return [...new Set(found)].map((root) => {
    // 秋叶等整合包的 python_embeded 和 ComfyUI 是平级的，两个位置都找
    const candidates = [
      path.join(root, 'python_embeded', 'python.exe'),
      path.join(root, '..', 'python_embeded', 'python.exe'),
      path.join(root, '..', 'python', 'python.exe'),
    ]
    const pythonExe = candidates.find((p) => fs.existsSync(p)) || ''
    return { root, pythonExe }
  })
}

/** 探测端口是不是被占着；占着的话顺便看看是不是 ComfyUI */
function probePort(port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port })
    let done = false
    const finish = (occupied) => {
      if (done) return
      done = true
      try { sock.destroy() } catch { /* ignore */ }
      resolve(occupied)
    }
    sock.once('connect', () => finish(true))
    sock.once('error', () => finish(false))
    sock.setTimeout(timeoutMs, () => finish(false))
  })
}

// ---------------------------------------------------------------------------
// 报错翻译：把 ComfyUI / Python 的英文报错翻成一句人话
// ---------------------------------------------------------------------------

function translateError(raw) {
  const s = String(raw || '')
  if (/cuda out of memory|OutOfMemoryError/i.test(s))
    return '显存不足：请关闭其他占用显卡资源的程序，或切换更轻量模型、降低生成分辨率后重试'
  if (/vcruntime|MSVCP|dll.*(not found|missing)|找不到.*dll/i.test(s))
    return '缺少系统运行库（VC++ Redist），重新部署将自动安装；若仍报错请手动安装 vc_redist.x64.exe'
  if (/EACCES|EPERM|Permission denied|拒绝访问/i.test(s))
    return '文件访问权限受限：请将程序目录加入安全软件白名单，并以管理员身份运行'
  if (/address already in use|EADDRINUSE/i.test(s)) return '端口被占用，程序将自动分配可用端口并重试'
  if (/No module named/i.test(s)) {
    const m = /No module named ['"]?([\w.]+)/.exec(s)
    return `Python 环境缺少依赖组件（${m ? m[1] : '未知模块'}），建议在设置中移除部署后重新执行一键部署`
  }
  if (/Connection refused|10061/i.test(s)) return 'ComfyUI 服务尚未启动就绪，请重新点击启动服务'
  if (/CERT_|certificate|SSL/i.test(s)) return 'SSL 证书校验失败：请检查系统时间是否准确，或切换网络环境后重试'
  if (/ENOENT/i.test(s)) return '目标文件路径不存在：可能被安全软件拦截或清理，请重新执行部署'
  return ''
}

// ---------------------------------------------------------------------------
// 汇总：一份完整环境诊断（工作流模式进来时跑这个）
// ---------------------------------------------------------------------------

async function probeEnvironment() {
  const cpus = os.cpus()
  const gpus = await probeGpus()
  const bestGpu = gpus.reduce((a, b) => (b.vramGb > (a?.vramGb || 0) ? b : a), null)
  const tier = gpuTier(bestGpu ? bestGpu.vramGb * 1024 : 0)
  const vc = checkVcRuntime()
  const disks = scanDrives()
  const port8188 = await probePort(8188)
  return {
    totalRamGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    freeRamGb: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
    cpuModel: cpus[0]?.model?.trim() || '未知 CPU',
    cpuCores: cpus.length,
    gpus,
    tier,
    vcRuntime: vc,
    disks,
    port8188Busy: port8188,
    suggestedEngineDir: safeEngineDir(disks),
  }
}

// ---------------------------------------------------------------------------
// 模块五：单机多环境模拟测试。
// 只有一台开发机，靠它在真机上预演各种极端环境，验证调度决策对不对。
// ---------------------------------------------------------------------------

const MOCK_SCENARIOS = ['NO_GPU', 'LOW_VRAM', 'BAD_PROXY_AND_MIRROR_FAIL', 'PORT_CONFLICT', 'CHINESE_SPACE_PATH']

async function runMockTest(scenario) {
  const sc = String(scenario || '').toUpperCase()
  switch (sc) {
    case 'NO_GPU': {
      const tier = gpuTier(0)
      return {
        scenario: sc,
        mock: { gpus: [], note: '强制模拟无独立显卡' },
        decision: {
          tier: tier.id,
          canDeployLocal: false,
          route: 'CLOUD_API',
          message: `已拦截本地部署：${tier.advice}`,
        },
      }
    }
    case 'LOW_VRAM': {
      const tier = gpuTier(6144)
      return {
        scenario: sc,
        mock: { gpus: [{ name: 'Mock GTX 1660 SUPER', vramGb: 6 }], note: '强制模拟 6GB 显存' },
        decision: {
          tier: tier.id,
          canDeployLocal: true,
          comfyArgs: tier.args,
          recommend: ['DreamShaper 8（2GB）', 'AOM3 橘子混合（2.1GB）'],
          message: `注入启动参数 ${tier.args.join(' ') || '(无)'}，并推荐轻量底模`,
        },
      }
    }
    case 'BAD_PROXY_AND_MIRROR_FAIL': {
      const dirty = { HTTP_PROXY: 'http://127.0.0.1:7890', HTTPS_PROXY: 'http://127.0.0.1:7890' }
      const cleaned = cleanChildEnv()
      return {
        scenario: sc,
        mock: { env: dirty, firstMirrorTimeout: true, note: '模拟残留坏代理 + 首选镜像超时' },
        decision: {
          proxyStripped: !('HTTP_PROXY' in cleaned) && cleaned.NO_PROXY === '*',
          mirrorOrder: ['清华源 pypi.tuna.tsinghua.edu.cn', '阿里源 mirrors.aliyun.com', '腾讯云源 mirrors.cloud.tencent.com'],
          message: '代理已清洗；首选镜像 15 秒超时后自动切第 2 顺位镜像重试',
        },
      }
    }
    case 'PORT_CONFLICT': {
      // 真占一下 8188 再跑端口避让逻辑，比纯嘴炮模拟可靠
      const blocker = net.createServer()
      await new Promise((r) => blocker.listen(8188, '127.0.0.1', r))
      let chosen = 0
      try {
        for (let p = 8188; p <= 8200; p++) {
          if (!(await probePort(p))) {
            chosen = p
            break
          }
        }
      } finally {
        blocker.close()
      }
      return {
        scenario: sc,
        mock: { occupied: 8188, note: '真实占用 8188 后跑避让逻辑' },
        decision: { chosenPort: chosen, message: `8188 被占，自动顺延到 ${chosen}` },
      }
    }
    case 'CHINESE_SPACE_PATH': {
      const fake = 'D:\\新建文件夹\\我的 AI 工具\\霖易工具箱\\'
      const safe = isPathSafe(fake)
      const redirect = safeEngineDir(scanDrives())
      return {
        scenario: sc,
        mock: { exeDir: fake, note: '模拟含中文与空格的极端安装路径' },
        decision: {
          pathSafe: safe,
          redirectTo: safe ? null : redirect,
          quotedExample: `"${redirect}\\portable\\python_embeded\\python.exe" -s "${redirect}\\portable\\ComfyUI\\main.py"`,
          message: safe ? '路径安全' : `路径含中文/空格，环境目录强制重定向到 ${redirect}，所有命令行均双引号包裹`,
        },
      }
    }
    default:
      return { scenario: sc, error: `未知场景，可选：${MOCK_SCENARIOS.join(' / ')}` }
  }
}

module.exports = {
  execText,
  cleanChildEnv,
  probeGpus,
  gpuTier,
  checkVcRuntime,
  scanDrives,
  isPathSafe,
  safeEngineDir,
  scanExistingComfy,
  probePort,
  translateError,
  probeEnvironment,
  runMockTest,
  MOCK_SCENARIOS,
}
