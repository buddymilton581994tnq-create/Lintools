// 服务商清单：只有名字和分组，不含任何接口地址。
// 地址一律用户自己填，程序不内置任何 API 地址。
// hosts 只是用来做「地址和服务商是不是对得上」的提示，不参与任何请求。
export interface Provider {
  id: string
  name: string
  group: 'relay' | 'official'
  /** 这家在国内通常能不能直连，只用来给个提示 */
  cnDirect: boolean
  tip: string
  /** 这家的接口域名特征（填了才做匹配检查，留空表示任意地址都算对） */
  hosts?: string[]
}

export const PROVIDERS: Provider[] = [
  {
    // 中转站就是中转站：具体哪一家由地址自己决定，不在这里单列某一家的名字
    id: 'relay',
    name: '中转站',
    group: 'relay',
    cnDirect: true,
    tip: '填入中转站后台给的接口地址和令牌，一般形如 https://xxx.com/v1',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    group: 'official',
    cnDirect: false,
    tip: '需配置网络代理，并在官方控制台获取 API 密钥',
    hosts: ['api.openai.com', 'openai.com'],
  },
  {
    id: 'azure',
    name: 'Azure',
    group: 'official',
    cnDirect: false,
    tip: '填入完整的终结点地址',
    hosts: ['openai.azure.com', 'cognitiveservices.azure.com', 'azure.com'],
  },
  {
    id: 'ark',
    name: '火山方舟',
    group: 'official',
    cnDirect: true,
    tip: '支持国内直连，请填写智谱图像生成模型名称',
    hosts: ['volces.com', 'volcengine.com'],
  },
  {
    id: 'zhipu',
    name: '智谱 AI',
    group: 'official',
    cnDirect: true,
    tip: '支持国内直连，请填写智谱图像生成模型名称',
    hosts: ['bigmodel.cn', 'zhipuai.cn'],
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    group: 'official',
    cnDirect: true,
    tip: '支持国内直连，可在服务商模型广场查看可用图像生成模型',
    hosts: ['siliconflow.cn', 'siliconflow.com'],
  },
  {
    id: 'dashscope',
    name: '阿里百炼',
    group: 'official',
    cnDirect: true,
    tip: '支持国内直连，请先在阿里云百炼控制台开通对应模型服务',
    hosts: ['aliyuncs.com', 'dashscope.aliyun.com'],
  },
]

/** 老版本存过 topapi / relay-other 这两个 id，统一并到「中转站」 */
const LEGACY_IDS: Record<string, string> = {
  topapi: 'relay',
  'relay-other': 'relay',
}

export function normalizeProviderId(id: string): string {
  return LEGACY_IDS[id] || id
}

export function findProvider(id: string): Provider | undefined {
  const real = normalizeProviderId(id)
  return PROVIDERS.find((p) => p.id === real)
}

/** 地址和所选服务商对不上时返回 true（服务商没填域名特征、地址为空都算对得上） */
export function providerMismatch(providerId: string, baseUrl: string): boolean {
  const p = findProvider(providerId)
  if (!p?.hosts?.length) return false
  const raw = String(baseUrl || '').trim()
  if (!raw) return false
  let host = ''
  try {
    host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase()
  } catch {
    return true
  }
  return !p.hosts.some((h) => host === h || host.endsWith(`.${h}`))
}

/** 这个地址看着像哪家的接口（认不出来返回 undefined），用来给个「你是不是想选它」的提示 */
export function guessProvider(baseUrl: string): Provider | undefined {
  const raw = String(baseUrl || '').trim()
  if (!raw) return undefined
  let host = ''
  try {
    host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase()
  } catch {
    return undefined
  }
  return PROVIDERS.find((p) => (p.hosts || []).some((h) => host === h || host.endsWith(`.${h}`)))
}
