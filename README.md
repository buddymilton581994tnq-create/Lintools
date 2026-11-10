# Lintools

AI 绘画提示词工具箱。Electron + React + Vite，内置本地大模型把中文描述编译成英文提示词，对接 ComfyUI 出图。

标准 Electron + Vite 工程结构，克隆下来就能 `npm install && npm run dist:win`。

## 目录

| 路径 | 内容 |
| --- | --- |
| `src/` | 前端源码。`pages/Home.tsx` 主界面，`components/WorkflowPanel.tsx` 工作流面板，`components/SettingsModal.tsx` 设置，`lib/` 接口层与提示词逻辑，`components/ui/` shadcn 组件 |
| `electron/` | 后端主进程。`main.cjs` 窗口与 62 个 IPC 通道，`llm.cjs` 本地模型部署，`corpus.cjs` 语料检索，`comfyui.cjs` 桥接，`train.cjs` 训练，`resilience.cjs` 恢复，`archive.cjs` 备份，`preload.cjs` 桥接层 |
| `electron/lexicon/` | 提示词词典，17 个主题 JSON 与生成脚本 |
| `dist/` | 线上运行的构建产物 |
| `public/` | 静态资源，字体和打赏图 |
| `ai-params/` | 本地模型调教参数 |
| `runtime-zip/llama-runtime.zip` | llama.cpp 运行时，首次启动解压 |

## 源码版本说明

磁盘上只有 11 月 9 日的源码快照，线上 `dist` 是 11 月 10 日构建的。我把两份构建产物做了文本比对，把能确定对应的文案改动回填进了 `src`，其余保留原样。

- 旧版文案片段 859 条，覆盖线上版本 52.2%
- 回填后 852 条，覆盖 61.7%
- 剩余 410 条是 11 月 10 日新增的整段协议文本和说明，旧源码里没有对应位置，需要新建界面区块才能补齐

也就是说 `src` 可以直接构建、可以改 UI，但比线上版本少了一些新增的说明段落。以 `dist/` 里的产物为线上行为基准。

## 本地 AI

模型走 llama.cpp，程序在用户数据目录自建结构。

```text
%APPDATA%\lin-toolbox\ai\
  ai.json                     推理参数
  nothink.jinja               无思考链对话模板
  prompt-compiler-rules.md    提示词编译准则
  corpus-library.json         百科语料库 3656 条
  master_index.json           扁平检索索引 7266 键
  models\                     GGUF 模型
  runtime\                    llama.cpp 二进制
```

`ai-params/` 是当前生效配置，和 `electron/llm.cjs` 里的 `DEFAULT_CONFIG`、`NO_THINK_JINJA`、`PROMPT_COMPILER_RULES_SPEC` 一致。语料库随包分发在 `electron/` 下，`corpus.cjs` 用 `__dirname` 直接读，换机器重新部署不需要额外配置。

```json
{
  "modelId": "ds4f-mini",
  "runtime": "auto",
  "port": 0,
  "reasoningBudget": 0,
  "ctxSize": 8192,
  "temperature": 0.35,
  "topP": 0.9,
  "repeatPenalty": 1.12,
  "autoStart": true
}
```

温度 0.35 稳定输出结构，topP 0.9 留用词余地，重复惩罚 1.12 压复读，上下文 8192 放系统提示加词典命中，思考预算归零关掉思维链。

模型不进仓库，放 `models/` 即可。

| id | 文件 | 大小 |
| --- | --- | --- |
| `ds4f-mini` | `ds4f-mini-q4_k_m.gguf` | 1.04 GB |
| `ds4f-qwen3-8b` | `ds4f-qwen3-8b-q4_k_m.gguf` | 4.68 GB |

## 运行

Node 20 以上。

```bash
npm install
npm run electron:start
```

打包便携版。

```bash
npm run dist:win
```

## 说明

`settings.json` 里有 API Key 和接口地址，不在仓库里，需要自己填。主进程源码只用 `config.apiKey` 变量，没有硬编码密钥。
## 线上文案提取

`src/lib/upstream-copy.ts` 存放从 11 月 10 日构建产物里提取、但 9 月源码快照里没有对应位置的文案。

- `UPSTREAM_COPY` 按组件分组，共 175 条，每条带构建时注入的行号，可直接定位插入点
- `UPSTREAM_UNPLACED` 是另外 235 条未能定位到组件的文本，多为独立协议段落

这份文件不参与任何组件渲染，只作为回填素材。需要还原线上完整文案时，按行号在对应组件里补回即可。
## 词库与翻译质量

`electron/corpus-library.json` 现在 10563 条，`electron/master_index.json` 12674 条。

数据来源是四个基站的官方中文对照表（[Yellow-Rush/zh_CN-Tags](https://github.com/Yellow-Rush/zh_CN-Tags) 下的 danbooru、gelbooru、yande、sankakucomplex），合计解析出 5760 条新词，其余靠手工补。

### 手工补的几类

- 颜色 × 部位，12 色 × 10 部位，「黑色长发」「红瞳」这类现拼组合词库里不会有
- 颜色 × 服装，12 色 × 20 种服装，「红色连衣裙」这类
- 动作词，举剑、拔剑、冲锋、跪地、比心、遮嘴、捧脸等 40 余条
- 场景、道具、职业、种族、乐器、动物、食物各补了一批

### 实测修掉的错译

用 130 条真实描述跑过三轮，修掉这些：

| 症状 | 原因 | 修法 |
| --- | --- | --- |
| 肛门 → door | 词库有单字「门」，在「肛门」内部命中 | 单字一律要求前后边界 |
| 乳头 → head | 同上，「头」 | 同上 |
| 菊花 → anus（花卉语境） | 多义词一刀切 | 加 CONTEXT_SENSITIVE 按旁证词判断 |
| 短裙 → dress | 混在「连衣裙」词条里 | 拆出 miniskirt |
| 举枪 → sword | 和举剑合用一条词条 | 拆出 holding gun up |
| 膝盖 → kneepits | 词条写错 | 改 knees |
| 红色 → red long upper shan | 机翻残渣 | 8 条颜色词条全改 |
| X色衬衫 → X upper shan | 同上 | 16 条清理 |
| 光影排在最前 | 分类名同时含「画风」和「光线」 | 光影优先判定 |
| 裸色 black / white 混进输出 | 颜色词条单独命中 | 加 PURE_COLOR_TAGS 拦截 |
| 喝咖啡 → 茶杯 | 词条映射错 | 改 holding coffee cup |

### 性能

10549 条下 `matchSlangGlossary` 单次 1.84 毫秒（50 次平均）。
## 本地模型三档

安装包不带模型，首次打开时检测显存和内存，弹框让用户选一档。

| 档位 | 模型 | 体积 | 显存建议 |
| --- | --- | --- | --- |
| 低配 | ds4f-mini（DeepSeek R1 蒸馏 1.5B） | 约 1.0 GB | 2 GB 即可 |
| 中配 | ds4f-7b（DeepSeek R1 蒸馏 7B） | 约 4.5 GB | 建议 8 GB |
| 高配 | ds4f-14b（DeepSeek R1 蒸馏 14B） | 约 9.0 GB | 建议 12 GB |

推荐规则在 `electron/llm.cjs` 的 `recommendTier(vramGb, ramGb)`：显存 11GB 以上，或 8GB 配 32GB 内存走高配；6GB 显存或 16GB 内存走中配；其余走低配。选择权在用户手上，弹框里的推荐项只是默认选中。

选完写进 `settings.json` 的 `modelTier` 和 `modelId`，之后不再询问。要换档位在设置里重新选，或者手动改 `%APPDATA%\lin-toolbox\ai\ai.json` 的 `modelId`。

模型下载地址走 hf-mirror.com，失败回落 huggingface.co。
