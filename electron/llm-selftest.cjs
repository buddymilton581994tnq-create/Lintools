'use strict'
// 引擎自检：真实下载 + 真跑一次推理，不依赖 electron
const path = require('path')
const fs = require('fs')
const { LocalModelEngine } = require('./llm.cjs')

const dataDir = process.argv[2] || path.join(require('os').tmpdir(), 'lintools-ai-test')
const modelId = process.argv[3] || 'qwen25-3b'

let last = -10
const engine = new LocalModelEngine({
  dataDir,
  resourcesDir: path.join(__dirname, '..', 'runtime-zip'),
  onProgress: (p) => {
    const pct = Math.round((p.percent || 0) * 100)
    if (pct >= last + 10 || pct === 100) {
      last = pct
      const mb = p.received ? ` ${(p.received / 1048576).toFixed(0)}MB` : ''
      console.log(`[progress] ${p.label} ${pct}%${mb}`)
    }
  },
  onStatus: (s) => console.log(`[status] ${s.state}${s.error ? ' :: ' + s.error : ''}`),
  onLog: () => {},
})

;(async () => {
  fs.mkdirSync(dataDir, { recursive: true })
  console.log('[status-before]', engine.getStatus().installed)
  const t0 = Date.now()
  await engine.ensureReady(modelId)
  const st = engine.getStatus()
  console.log(`[ready] ${((Date.now() - t0) / 1000).toFixed(1)}s  port=${st.port}  model=${st.modelName}`)

  const messages = [
    {
      role: 'system',
      content:
        '你是 AI 绘画提示词专家。把用户给的中文描述和已选效果词，合成一段高质量英文绘图提示词，' +
        '涵盖主体、外貌、风格、光影、构图、氛围，只输出提示词本身，不要解释。',
    },
    { role: 'user', content: '主体：哥特少女在房间里。已选效果：厚涂插画、昏暗冷调、中近景、蕾丝黑裙' },
  ]
  const t1 = Date.now()
  let reasoning = 0
  const out = await engine.chat(messages, (d) => {
    if (d.reasoning) reasoning += d.reasoning.length
  })
  console.log(`[chat] ${((Date.now() - t1) / 1000).toFixed(1)}s reasoning=${reasoning} chars`)
  console.log('[RESULT] ' + out.trim().slice(0, 700))

  const t2 = Date.now()
  const jsonOut = await engine.chat([
    { role: 'system', content: '你帮用户补全 AI 绘画提示词。只输出一个 JSON 对象 {"fields":[]}' },
    { role: 'user', content: '关键词：穿汉服的少女在竹林\n已经说清的部分：主体、场景，这些别再问。\n重点补这几项：画风、光影、构图、发型发色。一项都别漏，每项单独出一个 field。' },
  ])
  console.log(`[json-chat] ${((Date.now() - t2) / 1000).toFixed(1)}s`)
  console.log('[JSON-RESULT] ' + jsonOut.trim().slice(0, 700))

  engine.resetAndClean()
  process.exit(0)
})().catch((e) => {
  console.error('[FAIL]', e && e.message)
  engine.stop()
  process.exit(1)
})
