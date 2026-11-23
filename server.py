#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""职友 · 本地预览服务

纯标准库实现，零依赖：
  1. 静态托管 web/ 目录
  2. /api/chat 代理任意 OpenAI 兼容接口（key 只在请求里透传，服务端不保存、不落盘）

启动：
    python server.py            # 默认 http://127.0.0.1:8848
    python server.py 9000       # 指定端口
"""

import json
import os
import sys
import webbrowser
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(ROOT, "web")


class LLMError(Exception):
    pass


def _post_json(url, payload, headers, timeout=180):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:800]
        raise LLMError("模型接口返回 HTTP %s: %s" % (e.code, detail))
    except urllib.error.URLError as e:
        raise LLMError("连接模型接口失败: %s" % (e.reason,))
    except TimeoutError:
        raise LLMError("模型接口超时（>%ss）" % timeout)


def call_llm(req):
    base = (req.get("baseUrl") or "").strip().rstrip("/")
    key = (req.get("apiKey") or "").strip()
    model = (req.get("model") or "").strip()
    messages = req.get("messages") or []
    if not base:
        raise LLMError("缺少 baseUrl")
    if not model:
        raise LLMError("缺少 model")
    if not messages:
        raise LLMError("缺少 messages")

    url = base + "/chat/completions"
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = "Bearer " + key

    payload = {
        "model": model,
        "messages": messages,
        "temperature": float(req.get("temperature", 0.3)),
        "stream": False,
    }
    if req.get("maxTokens"):
        payload["max_tokens"] = int(req["maxTokens"])

    # 思考模式开关（deepseek 系支持）
    thinking = (req.get("thinking") or "").strip()
    if thinking in ("disabled", "enabled"):
        payload["thinking"] = {"type": thinking}

    want_json = bool(req.get("jsonMode"))
    if want_json:
        payload["response_format"] = {"type": "json_object"}

    try:
        body = _post_json(url, payload, headers)
    except LLMError:
        if not want_json:
            raise
        # 部分厂商（Ollama / 部分代理）不支持 response_format，降级重试一次
        payload.pop("response_format", None)
        body = _post_json(url, payload, headers)

    try:
        obj = json.loads(body)
        choice = (obj.get("choices") or [{}])[0]
        content = (choice.get("message") or {}).get("content")
    except Exception:
        raise LLMError("无法解析模型返回内容: " + body[:500])

    if not content:
        raise LLMError("模型返回内容为空")

    usage = obj.get("usage") or {}
    finish = choice.get("finish_reason")
    return {"content": content, "finishReason": finish, "usage": usage}


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def handle(self):
        # 浏览器提前断开（关标签页 / 无头截图退出）是正常现象，不打 traceback
        try:
            super().handle()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def do_GET(self):
        clean = self.path.split("?")[0]
        if clean == "/api/health":
            self._json(200, {"ok": True})
            return
        if clean == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self):
        clean = self.path.split("?")[0]
        if clean != "/api/chat":
            self._json(404, {"error": "not found"})
            return
        try:
            req = self._read_body()
        except Exception as e:
            self._json(400, {"error": "请求体格式错误: %s" % e})
            return
        try:
            self._json(200, call_llm(req))
        except LLMError as e:
            self._json(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": "服务端异常: %s" % e})


def _lan_ip():
    """猜一个局域网 IP，用于手机同 WiFi 访问。"""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:  # noqa: BLE001
        return "127.0.0.1"
    finally:
        s.close()


def main():
    if not os.path.isdir(WEB_DIR):
        print("找不到 web/ 目录: %s" % WEB_DIR, file=sys.stderr)
        sys.exit(1)

    # Windows 控制台可能是 GBK，遇到无法编码的字符不要直接崩
    try:
        sys.stdout.reconfigure(errors="replace")
        sys.stderr.reconfigure(errors="replace")
    except Exception:  # noqa: BLE001
        pass

    argv = sys.argv[1:]
    lan = "--lan" in argv
    auto_open = "--open" in argv
    nums = [a for a in argv if not a.startswith("--")]
    port = int(nums[0]) if nums else 8848
    host = "0.0.0.0" if lan else "127.0.0.1"

    url = "http://127.0.0.1:%d" % port
    server = ThreadingHTTPServer((host, port), Handler)

    print("=" * 60)
    print("  职友 · 本地网页预览（开发用）")
    print("")
    print("  [!] 这不是扩展。它只是把同一份 UI 用浏览器打开，")
    print("      方便改代码 / 截图 / 在没有扩展的环境里看效果。")
    print("")
    print("  真正要用，请安装扩展：")
    print("      1. 打开 chrome://extensions（Edge: edge://extensions）")
    print("      2. 右上角打开「开发者模式」")
    print("      3. 点「加载已解压的扩展程序」-> 选择本文件夹")
    print("      4. 去招聘网站，右侧侧边栏就是它")
    print("=" * 60)
    print("  预览地址: " + url)
    if lan:
        print("  手机访问: http://%s:%d   (需同一个 WiFi)" % (_lan_ip(), port))
    print("  停止: Ctrl + C")
    print("=" * 60)

    if auto_open:
        try:
            webbrowser.open(url)
        except Exception:  # noqa: BLE001
            pass

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
