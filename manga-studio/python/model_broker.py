"""Loopback OpenAI API router. A1 is a separate resident service; heavy LLMs
hold the same process lease as image/video jobs and exit before releasing it.
Runtime commands live in an ignored JSON config and never come from API input.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from contextlib import contextmanager
import http.client
import json
import os
import select
import signal
import socket
import subprocess
import threading
import time
import urllib.request
import uuid

from mangai_gpu import GpuLease, DEFAULT_STATE, snapshot


@contextmanager
def backend(model, cancel):
    if model.get("resident"):
        yield
        return
    phase = model["phase"]
    with GpuLease(phase, model["label"], cancelled=cancel.is_set, limits=tuple(model.get("minimumFreeGiB", [])) or None):
        logs = Path(os.environ.get("MANGAI_GPU_STATE", DEFAULT_STATE)) / "logs"
        logs.mkdir(parents=True, exist_ok=True)
        with (logs / f"{phase}.log").open("ab") as log:
            child = subprocess.Popen(model["command"], cwd=model.get("cwd"), env={**os.environ, **model.get("env", {})}, stdout=log, stderr=log, start_new_session=True)
            try:
                deadline = time.monotonic() + model.get("startupTimeout", 900)
                while True:
                    if cancel.is_set():
                        raise InterruptedError("モデル起動を中止しました")
                    if child.poll() is not None:
                        raise RuntimeError(f"{model['label']}の起動に失敗しました。{phase}.logを確認してください")
                    try:
                        with urllib.request.urlopen(f"http://127.0.0.1:{model['port']}/health", timeout=2) as health:
                            if health.status == 200:
                                break
                    except (OSError, http.client.HTTPException):
                        pass
                    if time.monotonic() > deadline:
                        raise TimeoutError("モデルの起動が制限時間を超えました")
                    time.sleep(0.5)
                yield
            finally:
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGTERM)
                    try:
                        child.wait(20)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                        child.wait()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def json(self, code, value):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.headers.get("Origin"):
            return self.json(403, {"error": "Server-side local API only"})
        if self.path == "/gpu/status":
            return self.json(200, snapshot(os.environ.get("MANGAI_GPU_STATE", DEFAULT_STATE)))
        if self.path == "/v1/models":
            return self.json(200, {"object": "list", "data": [{"id": name, "object": "model", "owned_by": "local"} for name in self.server.models]})
        if self.path == "/health":
            return self.json(200, {"status": "ok"})
        self.json(404, {"error": "Not found"})

    def do_POST(self):
        if self.headers.get("Origin") or self.path != "/v1/chat/completions":
            return self.json(403, {"error": "Server-side chat completions only"})
        started = False
        cancel = threading.Event()
        transport = {"connection": None}
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > 32 * 1024 * 1024:
                return self.json(400, {"error": "Invalid content length"})
            body = self.rfile.read(length)
            request = json.loads(body)
            model = self.server.models.get(request.get("model"))
            if model is None:
                return self.json(400, {"error": "Unknown configured model"})
            def watch_disconnect():
                while not cancel.wait(0.5):
                    try:
                        readable, _, _ = select.select([self.connection], [], [], 0)
                        if readable and not self.connection.recv(1, socket.MSG_PEEK | socket.MSG_DONTWAIT):
                            cancel.set()
                            conn = transport["connection"]
                            if conn and conn.sock:
                                conn.sock.shutdown(socket.SHUT_RDWR)
                            return
                    except (OSError, ValueError):
                        cancel.set()
                        return
            threading.Thread(target=watch_disconnect, daemon=True).start()
            with backend(model, cancel):
                conn = http.client.HTTPConnection("127.0.0.1", model["port"], timeout=1800)
                transport["connection"] = conn
                try:
                    conn.request("POST", self.path, body, {"Content-Type": "application/json"})
                    upstream = conn.getresponse()
                    self.send_response(upstream.status)
                    self.send_header("Content-Type", upstream.getheader("Content-Type", "application/json"))
                    self.send_header("Connection", "close")
                    self.end_headers()
                    started = True
                    self.close_connection = True
                    saved = bytearray()
                    while chunk := upstream.read1(65536):
                        if cancel.is_set():
                            raise InterruptedError("API接続が終了したため生成を中止しました")
                        if not model.get("resident"):
                            saved.extend(chunk)
                        self.wfile.write(chunk)
                        self.wfile.flush()
                    if not model.get("resident"):
                        destination = Path(os.environ.get("MANGAI_GPU_STATE", DEFAULT_STATE)) / "responses"
                        destination.mkdir(parents=True, exist_ok=True)
                        # Persist the exact response before unloading the creative/coding model.
                        record = destination / (uuid.uuid4().hex + ".json")
                        record.write_text(json.dumps({"model": request.get("model"), "phase": model["phase"], "status": upstream.status, "request": request, "response": saved.decode("utf-8", errors="replace")}, ensure_ascii=False))
                finally:
                    transport["connection"] = None
                    conn.close()
        except (BrokenPipeError, ConnectionResetError):
            cancel.set()
        except Exception as error:
            if not started:
                self.json(503, {"error": {"message": str(error), "type": "local_model_error"}})
        finally:
            cancel.set()


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--port", type=int, default=1234)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.models = config["models"]
    server.serve_forever()


if __name__ == "__main__":
    main()
