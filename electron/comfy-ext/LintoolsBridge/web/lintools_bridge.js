// 霖易工具箱 · ComfyUI 画布桥（postMessage + WebSocket + HTTP 三通道，重建排队串行）
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const TAG = "[Lintools]";
let lastAppliedSeq = 0;
let lastAppliedHash = "";
let pendingTimer = null;
let queue = Promise.resolve();

function toParent(msg) {
  try {
    window.parent.postMessage(msg, "*");
  } catch (e) {
    /* ignore */
  }
}

function report(title, nodes) {
  try {
    fetch(`/lintools/bridge/loaded?title=${encodeURIComponent(title)}&nodes=${nodes}`).catch(() => {});
  } catch (e) {
    /* ignore */
  }
}

function hashGraph(g) {
  try {
    return JSON.stringify(g);
  } catch {
    return "";
  }
}

/** 真正画到画布上：一次只跑一个，绝不并发重建 */
async function applyGraph(apiJson, title) {
  const name = `霖易 · ${title || "工作流"}`;
  if (typeof app.loadApiJson === "function") {
    await app.loadApiJson(apiJson, name);
  } else if (typeof app.loadGraphData === "function") {
    await app.loadGraphData(apiJson);
  } else {
    throw new Error("当前 ComfyUI 版本不支持载入节点图");
  }
  // 重建后把视图对准节点，否则节点排在视野外，用户看到的是空白画布
  const fitView = () => {
    try {
      const g = app?.graph ?? app?.rootGraph;
      const cv = app?.canvas;
      if (!g || !cv) return;
      if (typeof g.arrange === "function") g.arrange();
      if (typeof cv.ds?.fitToBounds === "function" && typeof g.getBounding === "function") {
        const b = g.getBounding();
        if (b && b[2] > 0 && b[3] > 0) {
          cv.ds.fitToBounds(b, { viewport: cv.visible_area });
        }
      } else if (typeof cv.fitViewToSelectionAnimated === "function") {
        cv.fitViewToSelectionAnimated();
      }
      if (typeof cv.setDirty === "function") cv.setDirty(true, true);
    } catch (e) {
      /* 对准失败不影响图本身 */
    }
  };
  fitView();
  setTimeout(fitView, 360);
  setTimeout(fitView, 1000);
  const nodes = app?.graph?._nodes?.length ?? app?.graph?.nodes?.length ?? 0;
  report(name, nodes);
  toParent({ type: "lintools:workflow-loaded", title, nodes });
  console.log(TAG, "已同步载入", name, "节点数", nodes);
}

/** 串行执行：后一次一定等前一次画完 */
function loadGraph(apiJson, title, id) {
  if (!apiJson || typeof apiJson !== "object" || Object.keys(apiJson).length === 0) {
    return Promise.resolve();
  }
  const h = hashGraph(apiJson);
  if (h && h === lastAppliedHash) return Promise.resolve();
  lastAppliedHash = h;
  queue = queue.then(
    () => applyGraph(apiJson, title).catch((e) => {
      console.warn(TAG, "载入失败", e);
      toParent({ type: "lintools:workflow-error", id, error: String(e && e.message ? e.message : e) });
    }),
    () => applyGraph(apiJson, title).catch(() => {}),
  );
  return queue;
}

/** 防抖：参数连续变只画最后一次 */
function scheduleGraph(apiJson, title, id, delay = 700) {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    loadGraph(apiJson, title, id);
  }, delay);
}

async function pullRemoteState() {
  try {
    const resp = await fetch("/lintools/bridge/state", { cache: "no-store" });
    if (!resp.ok) return;
    const j = await resp.json();
    const st = j && j.state;
    if (st && st.graph && Number(st.seq || 0) > lastAppliedSeq) {
      lastAppliedSeq = Number(st.seq || 0);
      scheduleGraph(st.graph, st.title, st.id, 120);
    }
  } catch (e) {
    /* ignore */
  }
}

app.registerExtension({
  name: "Lintools.CanvasBridge",
  async setup() {
    try {
      localStorage.removeItem("workflow");
      localStorage.removeItem("Comfy.PreviousWorkflow");
      sessionStorage.removeItem("workflow");
      if (app.graph && typeof app.graph.clear === "function") app.graph.clear();
    } catch (e) {
      /* ignore */
    }

    // 1. 内嵌 webview 的 postMessage 通道
    window.addEventListener("message", (ev) => {
      const data = ev.data;
      if (!data || typeof data !== "object") return;
      if (data.type !== "lintools:load-workflow") return;
      scheduleGraph(data.graph, data.title, data.id, 60);
    });

    // 2. ComfyUI WebSocket 广播通道
    try {
      api.addEventListener("lintools.workflow.sync", (ev) => {
        const st = ev && ev.detail;
        if (st && st.graph) {
          lastAppliedSeq = Math.max(lastAppliedSeq, Number(st.seq || 0));
          scheduleGraph(st.graph, st.title, st.id, 80);
        }
      });
    } catch (e) {
      /* ignore */
    }

    // 3. 启动时拉一次最新状态
    try {
      const r = await fetch("/lintools/bridge/ready", { cache: "no-store" });
      if (r.ok) {
        const j = await r.json().catch(() => null);
        if (j?.state?.graph) {
          lastAppliedSeq = Number(j.state.seq || 0);
          loadGraph(j.state.graph, j.state.title, j.state.id);
        }
      }
    } catch (e) {
      /* ignore */
    }

    setInterval(pullRemoteState, 1800);
    toParent({ type: "lintools:bridge-ready" });
    console.log(TAG, "画布桥已就绪（重建已串行化，防抖 700ms）");
  },
});
