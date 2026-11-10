// 新手问答：右上角点开，覆盖软件使用的方方面面。
// 文案风格按老板的口吻：书面、把事说清楚、自称「本人」。
import { useEffect, useState } from 'react'
import { ChevronDown, CircleHelp, X } from 'lucide-react'

interface Qa {
  q: string
  a: string
}

const QA_LIST: Qa[] = [
  // ---- 基本 ----
  {
    q: '这软件是干嘛的？',
    a: '本软件旨在提供专业便捷的 AI 绘画与工作流编排体验。您只需输入中文画面描述，系统将自动匹配专业视觉词库并译为英文提示词，调用云端接口或本地引擎生成图像。',
  },
  {
    q: '第一次打开要干嘛？',
    a: '先在左侧填好绘图 API 的地址和密钥，测试显示在线后即可开始绘画。本地 DS 模型会在首次启动时自动部署，无需手动操作。',
  },
  {
    q: '这个软件收费吗？',
    a: '软件本身不收取任何费用。产生费用的只有你自行配置的绘图 API，那是服务商收取的，与软件无关。',
  },
  {
    q: '对计算机硬件配置有何要求？',
    a: '文生图与图生图模式通过云端接口运行，对本地硬件无特定要求。工作流模式在本地运行 ComfyUI，建议配备 16GB 以上内存及 8GB 以上显存的 NVIDIA',
  },
  {
    q: '软件需要联网吗？',
    a: '调用 API 绘画时需要联网。DS 模型和 ComfyUI 部署完成后都在本地运行，不联网也能用它们处理提示词。',
  },
  // ---- DS 模型 ----
  {
    q: 'DS 模型是个啥？',
    a: 'DS 是 DeepSeek 的缩写，用以辅助提示词填写。模型部署在你自己的电脑上，运行时不联网，也不产生任何费用，仅首次部署需要下载几个 GB 的文件。',
  },
  {
    q: 'DS 一直显示掉线怎么办？',
    a: '先彻底退出软件再重新打开，启动时会重新加载模型。若仍然掉线，检查杀毒软件是否拦截了模型进程，将其加入白名单即可。',
  },
  {
    q: 'DS 部署失败怎么办？',
    a: '多数是下载中断或磁盘空间不足。确认磁盘剩余空间充足后重新部署即可，下载支持断点续传，不会从头再来。',
  },
  {
    q: 'DS 会看我说的话吗？',
    a: '不会。本地辅助模型与内置词库全程在您的计算机本地离线运行，输入内容不会发送至任何第三方服务器。',
  },
  // ---- API 与费用 ----
  {
    q: '画图要钱吗？',
    a: '如果是本地模型则不需要，API 需要另外购买，购买途径为各大服务商的官网或中转站。因各大中转站的质量参差不齐，所以本人就不在这里进行推荐了。',
  },
  {
    q: 'API 密钥填在哪里？',
    a: '左侧边栏的 API 配置区域，填入服务商提供的地址和密钥后点击测试，显示在线即配置成功。密钥只保存在你自己的电脑上。',
  },
  {
    q: '余额显示不准或刷新不了？',
    a: '部分服务商不提供余额查询接口，此时会显示「未检测」。以服务商官网后台的余额为准。',
  },
  {
    q: '提示「接口返回了网页而不是数据」是什么意思？',
    a: '说明地址填错了，或者该服务商的接口路径不标准。检查地址是否以 /v1 结尾，或换成标准兼容接口再试。',
  },
  // ---- 提示词 ----
  {
    q: '提示词不会写怎么办？',
    a: '用平常说话的方式输入关键词即可，例如「哥特少女在房间」。DS 会自动检测缺少的部分并列出候选，底部的细节推荐点击即可添加，不填也可以直接生成。',
  },
  {
    q: '为什么要翻译成英文？',
    a: '目前主流绘画模型对英文的理解远好于中文，直接输入中文容易画歪。软件会自动完成翻译，你不需要自己翻。',
  },
  {
    q: '反向提示词是什么？',
    a: '用来告诉模型「不要画什么」，例如低质量、变形、多余的手指。一般留空即可，软件内置了常用的保底词。',
  },
  {
    q: '细节推荐里的词可以叠加吗？',
    a: '可以。点过的词会依次追加进提示词，彼此不冲突。不想要哪个，在最终提示词里手动删掉即可。',
  },
  {
    q: '生成的提示词能自己改吗？',
    a: '可以。「最终提示词」框里的内容随时可以直接编辑，改完直接生成即可。',
  },
  {
    q: '为什么画出来和想的不一样？',
    a: '多半是描述不够具体。补上画风、光影、构图这三项，再生成一次，一般就会接近很多。',
  },
  // ---- 文生图与图生图 ----
  {
    q: '文生图与图生图模式有何区别？',
    a: '文生图为从零开始生成图片；图生图则需要你提供一张参考图，软件在该图的基础上进行修改，修改幅度可自行调整。',
  },
  {
    q: '图生图的「重绘幅度」怎么调？',
    a: '数值越低越接近原图，越高则改动越大。想微调原图用 0.3 左右，想大改构图用 0.6 以上。',
  },
  {
    q: '生成一张图要多久？',
    a: '取决于服务商和尺寸，一般几秒到几十秒。生成中页头会显示用时，卡住了可以停止后重试。',
  },
  {
    q: '画好的图在哪？',
    a: '生成完成的图片会显示在右侧的历史记录中，点开即可查看大图并保存到本地。',
  },
  {
    q: '历史记录会丢吗？',
    a: '不会。历史记录保存在你自己的电脑上，重启软件后仍在。软件内清空后才会删除。',
  },
  // ---- 工作流与 ComfyUI ----
  {
    q: '工作流模式的主要用途是什么？',
    a: '工作流将绘画拆分为出图、换风格、修脸、放大等步骤，由内置的 ComfyUI 执行。在左侧勾选需要的步骤即可，多个步骤可以同时启用，软件会按顺序依次完成。',
  },
  {
    q: 'ComfyUI 是什么？',
    a: '一个在本地运行绘画模型的开源程序。软件已经把它内置了，你不需要了解它的用法，点「一键部署」即可。',
  },
  {
    q: '一键部署的 ComfyUI 功能全吗？',
    a: '全。部署时自带 ComfyUI-Manager 插件管理器，缺什么插件在管理器里点一下就能装，和市面上的整合包能力一致。若你已安装秋叶整合包，也可以在设置里直接导入使用。',
  },
  {
    q: '工作流跑不动咋办？',
    a: '先查看「电脑状态」处的评估结果。若显示偏低，建议选择显存需求较小的工作流，或关闭其他占用显卡的程序后再试。',
  },
  {
    q: '工作流跑到一半失败了？',
    a: '先看右侧的报错信息。多数是模型没选对或模型文件缺失，在「模型库」里把对应的模型下载好再跑一次即可。',
  },
  {
    q: '可以用我自己装的 ComfyUI 吗？',
    a: '可以。打开设置，在 ComfyUI 一项中点「导入已有的整合包」，选中它的根目录即可，软件会接管启动和停止。',
  },
  // ---- 模型下载 ----
  {
    q: '模型库是干嘛的？',
    a: '模型库提供绘画所需的各类模型下载，按底模、风格、放大、修脸等功能分类，点一下即自动下载到正确的位置，无需手动放文件。',
  },
  {
    q: '底模选哪个好？',
    a: '画真人选写实类，画动漫选二次元类，不确定就选通用类。每个模型在模型库里都有说明，照着挑即可。',
  },
  {
    q: '模型下载中断了怎么办？',
    a: '重新点一次下载即可，支持断点续传，已下载的部分不会作废。',
  },
  {
    q: '模型很占地方吗？',
    a: '底模一般 2 到 7GB 一个，建议只下载常用的两三个。磁盘紧张时可在设置里更换部署位置到其他盘。',
  },
  // ---- 设置 ----
  {
    q: '怎么换界面风格？',
    a: '点右上角的「设置」，在「界面风格」里挑一套即可，颜色、字体、圆角会一起换，重启后保留。',
  },
  {
    q: '部署路径可以改吗？',
    a: '可以。设置里 DS 模型和 ComfyUI 都能换位置，例如改到空间更大的盘。换完位置需要重新部署。',
  },
  {
    q: '不想用本地功能了能删掉吗？',
    a: '可以。设置里 DS 和 ComfyUI 都有「移除部署」，点完文件就删干净了，不影响软件的其他功能。',
  },
  // ---- 隐私与其他 ----
  {
    q: '我的图片和密钥安全吗？',
    a: '密钥、配置、历史记录全部保存在你自己的电脑上，软件不上传任何数据。唯一的网络请求是调用你自己配置的绘图接口。',
  },
  {
    q: '关了软件东西会丢吗？',
    a: '不会。配置与历史记录均保存在你自己的电脑上。点击关闭按钮时，软件会询问是隐藏到托盘还是直接退出，勾选「此后不再询问」后将按照你的选择执行。',
  },
  {
    q: '软件更新后配置还在吗？',
    a: '在。配置存在系统用户目录里，与软件本体分离，更新或重装软件都不会影响。',
  },
  {
    q: '遇到问题找谁？',
    a: '把软件里的报错原文发给我即可，报错会写明出错环节，按提示处理一般都能解决。',
  },
]

export default function QaModal({ onClose, forced = false }: { onClose: () => void; forced?: boolean }) {
  const [open, setOpen] = useState<number | null>(0)
  // 强制阅读：首次启动弹出时倒计时 10 秒，数完才许关
  const [left, setLeft] = useState(forced ? 10 : 0)

  useEffect(() => {
    if (!forced || left <= 0) return
    const t = window.setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000)
    return () => window.clearInterval(t)
  }, [forced, left])

  const canClose = !forced || left <= 0

  const tryClose = () => {
    if (!canClose) return
    // 强制阅读走完即视为已读，以后启动不再自动弹
    if (forced) {
      try {
        localStorage.setItem('lin-toolbox-qa-seen', '1')
      } catch {
        /* ignore */
      }
    }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={canClose ? tryClose : undefined}
    >
      <div
        className="max-h-[86vh] w-full max-w-lg overflow-y-auto rounded-lg border border-teal-500/25 bg-[#0a1414] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2">
          <CircleHelp className="h-4 w-4 text-teal-400" />
          <h2 className="text-sm font-semibold text-zinc-100">新手问答</h2>
          <span className="font-mono text-[10px] text-zinc-500">{QA_LIST.length} 条</span>
          {forced && left > 0 && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
              首次使用请看完，{left} 秒后可关闭
            </span>
          )}
          <button
            onClick={tryClose}
            disabled={!canClose}
            className="ml-auto rounded p-1 text-zinc-500 transition-colors hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
            title={canClose ? '关闭' : `请阅读 ${left} 秒后再关闭`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-1.5">
          {QA_LIST.map((item, i) => {
            const expanded = open === i
            return (
              <div key={i} className="rounded-md border border-zinc-700/80 bg-black/30">
                <button
                  onClick={() => setOpen(expanded ? null : i)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-zinc-200"
                >
                  <span className="font-mono text-[10px] text-teal-500/80">Q{i + 1}</span>
                  {item.q}
                  <ChevronDown
                    className={`ml-auto h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
                  />
                </button>
                {expanded && (
                  <p className="border-t border-zinc-800 px-3 py-2.5 text-[11px] leading-relaxed text-zinc-400">
                    {item.a}
                  </p>
                )}
              </div>
            )
          })}
        </div>
        {forced && (
          <button
            onClick={tryClose}
            disabled={!canClose}
            className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-md border border-teal-400/60 bg-teal-400/15 px-3 py-2 text-xs font-medium text-teal-200 transition-colors hover:bg-teal-400/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {canClose ? '我已阅读完毕，开始使用' : `阅读中… ${left} 秒后可关闭`}
          </button>
        )}
      </div>
    </div>
  )
}
