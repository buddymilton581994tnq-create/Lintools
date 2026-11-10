// 打赏窗口：两张收款码并排，扫码随意。
import { Heart, X } from 'lucide-react'

const alipay = `${import.meta.env.BASE_URL}donate/alipay.jpg`
const wechat = `${import.meta.env.BASE_URL}donate/wechat.png`

export default function DonateModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[86vh] w-full max-w-md overflow-y-auto rounded-lg border border-teal-500/25 bg-[#0a1414] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <Heart className="h-4 w-4 text-teal-400" />
          <h2 className="text-sm font-semibold text-zinc-100">支持作者</h2>
          <button
            onClick={onClose}
            className="ml-auto rounded p-1 text-zinc-500 transition-colors hover:text-zinc-200"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-zinc-400">
          本软件为霖易aa的个人作品，免费使用。若它对你有所帮助，扫码随意打赏，多少都是心意。
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-zinc-700/80 bg-black/30 p-2 text-center">
            <img src={wechat} alt="微信赞赏码" className="mx-auto w-full rounded-sm" />
            <p className="mt-1.5 text-[11px] text-zinc-400">微信赞赏</p>
          </div>
          <div className="rounded-md border border-zinc-700/80 bg-black/30 p-2 text-center">
            <img src={alipay} alt="支付宝收款码" className="mx-auto w-full rounded-sm" />
            <p className="mt-1.5 text-[11px] text-zinc-400">支付宝</p>
          </div>
        </div>
        <p className="mt-3 text-center font-mono text-[10px] text-zinc-500">作者：霖易aa</p>
      </div>
    </div>
  )
}
