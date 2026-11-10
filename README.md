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
| `runtime/llama-runtime.zip` | llama.cpp 运行时，首次启动解压 |

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
