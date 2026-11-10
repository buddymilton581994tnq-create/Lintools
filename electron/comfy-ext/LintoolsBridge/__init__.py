# Lintools 画布桥：让霖易工具箱把左边选中的工作流实时推到 ComfyUI 画布上（含独立 Edge 窗口同步）
import os
import time
import json

WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

_DIR = os.path.dirname(os.path.abspath(__file__))
_LOG = os.path.join(_DIR, "bridge.log")
_STATE_FILE = os.path.join(_DIR, "latest_workflow.json")
_LATEST_STATE = {"seq": 0, "id": "", "title": "", "graph": None, "at": 0}


def _write(line: str) -> None:
    try:
        with open(_LOG, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {line}\n")
    except Exception:
        pass


try:
    if os.path.exists(_STATE_FILE):
        with open(_STATE_FILE, "r", encoding="utf-8") as f:
            saved = json.load(f)
            if isinstance(saved, dict) and saved.get("graph"):
                _LATEST_STATE.update(saved)
except Exception:
    pass


try:
    from server import PromptServer
    from aiohttp import web

    @PromptServer.instance.routes.get("/lintools/bridge/loaded")
    async def _lintools_loaded(request):
        title = request.query.get("title", "")
        nodes = request.query.get("nodes", "")
        _write(f"canvas loaded, title={title} nodes={nodes}")
        return web.json_response({"ok": True})

    @PromptServer.instance.routes.get("/lintools/bridge/ready")
    async def _lintools_ready(_request):
        _write("bridge ready")
        return web.json_response({"ok": True, "state": _LATEST_STATE})

    @PromptServer.instance.routes.post("/lintools/bridge/sync")
    async def _lintools_sync(request):
        try:
            body = await request.json()
            graph = body.get("graph")
            if isinstance(graph, dict) and len(graph) > 0:
                _LATEST_STATE["seq"] = int(_LATEST_STATE.get("seq", 0)) + 1
                _LATEST_STATE["id"] = str(body.get("id", ""))
                _LATEST_STATE["title"] = str(body.get("title", "工作流"))
                _LATEST_STATE["graph"] = graph
                _LATEST_STATE["at"] = int(time.time() * 1000)
                try:
                    with open(_STATE_FILE, "w", encoding="utf-8") as f:
                        json.dump(_LATEST_STATE, f, ensure_ascii=False)
                except Exception:
                    pass
                try:
                    PromptServer.instance.send_sync("lintools.workflow.sync", _LATEST_STATE)
                except Exception:
                    pass
                _write(f"synced state seq={_LATEST_STATE['seq']} title={_LATEST_STATE['title']} nodes={len(graph)}")
            return web.json_response({"ok": True, "seq": _LATEST_STATE["seq"]})
        except Exception as err:
            return web.json_response({"ok": False, "error": str(err)}, status=400)

    @PromptServer.instance.routes.get("/lintools/bridge/state")
    async def _lintools_state(_request):
        return web.json_response({"ok": True, "state": _LATEST_STATE})

except Exception as e:
    _write(f"route init failed: {e}")

__all__ = ["WEB_DIRECTORY", "NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]
