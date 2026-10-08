"""Loopback router: A1 stays resident; coding workers can stay warm between calls.

One manager owns the heavy GPU lease. Its child exits before release. Commands
come only from local config, never API input. Waiting GPU jobs interrupt idle
retention, not an active generation.
"""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
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

from mangai_gpu import GpuLease, DEFAULT_STATE, database, process_stamp, snapshot


class BackendManager:
    def __init__(self, models, *, root=None, poll_seconds=1):
        self.models = models
        self.root = Path(root or os.environ.get("MANGAI_GPU_STATE", DEFAULT_STATE))
        self.lock = threading.Lock()
        self.closed = threading.Event()
        self.active = None
        self.last_state = {"state": "stopped"}
        for model in models.values():
            seconds = model.get("keepAliveSeconds", 0)
            if not isinstance(seconds, (int, float)) or not 0 <= seconds <= 3600:
                raise ValueError("keepAliveSeconds must be between 0 and 3600")
        self.reaper = threading.Thread(target=self._reap, args=(poll_seconds,), daemon=True)
        self.reaper.start()

    def state(self):
        return dict(self.last_state)

    def _publish(self, state, **values):
        self.last_state = {"state": state, **values}

    def _waiting(self):
        if not self.active:
            return False
        own = self.active["lease"].record["id"]
        with database(self.root) as db:
            rows = db.execute("SELECT body FROM requests WHERE json_extract(body,'$.state') IN ('queued','waiting_memory')").fetchall()
        return any(r["id"] != own and process_stamp(r["pid"]) == r.get("processStamp")
                   for r in (json.loads(row[0]) for row in rows))

    def _stop(self, reason="released"):
        active = self.active
        if active is None:
            return
        self._publish("draining", model=active["id"], reason=reason)
        child = active["child"]
        try:
            for sig in (signal.SIGTERM, signal.SIGKILL):
                try:
                    os.killpg(child.pid, sig)
                except ProcessLookupError:
                    pass
                try:
                    child.wait(timeout=30 if sig == signal.SIGTERM else 5)
                except subprocess.TimeoutExpired:
                    if sig == signal.SIGKILL:
                        raise RuntimeError("モデル終了を確認できないためGPU利用権を保持します")
            child.wait()
        except BaseException:
            # Never hand the GPU to another job while our child may still own it.
            raise
        else:
            active["log"].close()
            active["lease"].__exit__(None, None, None)
            self.active = None
            self._publish("stopped", reason=reason)

    def _start(self, model_id, model, cancel):
        self._publish("starting", model=model_id)
        lease = GpuLease(model["phase"], model["label"], root=self.root,
                         cancelled=lambda: cancel.is_set() or self.closed.is_set(),
                         limits=tuple(model.get("minimumFreeGiB", [])) or None)
        entered, log = False, None
        try:
            lease.__enter__()
            entered = True
            with socket.socket() as probe:
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                probe.bind(("127.0.0.1", model["port"]))
            logs = self.root / "logs"
            logs.mkdir(parents=True, exist_ok=True)
            log = (logs / f"{model['phase']}.log").open("ab")
            env = {**os.environ, **model.get("env", {})}
            pass_fds = ()
            if model.get("externalLease"):
                fd = lease.fd.fileno()
                env.update(MANGAI_GPU_LEASE_FD=str(fd), MANGAI_GPU_STATE=str(self.root))
                pass_fds = (fd,)
            child = subprocess.Popen(model["command"], cwd=model.get("cwd"), env=env,
                                     stdout=log, stderr=log, start_new_session=True, pass_fds=pass_fds)
            self.active = {"id": model_id, "model": model, "child": child,
                           "lease": lease, "log": log, "last_used": time.monotonic()}
            deadline = time.monotonic() + model.get("startupTimeout", 900)
            while True:
                if cancel.is_set() or self.closed.is_set():
                    raise InterruptedError("モデル起動を中止しました")
                if child.poll() is not None:
                    raise RuntimeError(f"{model['label']}の起動に失敗しました。ログを確認してください")
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{model['port']}/health", timeout=2) as health:
                        if health.status == 200:
                            return
                except (OSError, http.client.HTTPException):
                    pass
                if time.monotonic() > deadline:
                    raise TimeoutError("モデルの起動が制限時間を超えました")
                cancel.wait(.1)
        except BaseException:
            if self.active:
                self._stop("startup failed")
            else:
                if log:
                    log.close()
                if entered:
                    lease.__exit__(None, None, None)
                self._publish("stopped", reason="startup failed")
            raise

    @contextmanager
    def use(self, model_id, cancel, session_id=None):
        model = self.models[model_id]
        if model.get("resident"):
            yield None
            return
        acquired = False
        try:
            while not acquired:
                if cancel.is_set() or self.closed.is_set():
                    raise InterruptedError("モデル待機を中止しました")
                acquired = self.lock.acquire(timeout=.1)
            if cancel.is_set() or self.closed.is_set():
                raise InterruptedError("モデル待機を中止しました")
            if self.active and (self.active["id"] != model_id or self.active["child"].poll() is not None):
                self._stop("switch model or backend exited")
            if self.active and self._waiting():
                self._stop("yield to queued GPU work")
                cancel.wait(.6)
            if not self.active:
                self._start(model_id, model, cancel)
            self.active["session_id"] = session_id
            pid = self.active["child"].pid
            self._publish("busy", model=model_id, pid=pid, sessionId=session_id)
            try:
                yield pid
            except BaseException:
                self._stop("request failed")
                raise
            finally:
                if self.active:
                    if cancel.is_set() or self.closed.is_set() or not model.get("keepAliveSeconds", 0) or self._waiting():
                        self._stop("request ended or GPU work waiting")
                    else:
                        self.active["last_used"] = time.monotonic()
                        self._publish("ready", model=model_id, pid=pid, sessionId=session_id,
                                      keepAliveSeconds=model["keepAliveSeconds"])
        finally:
            if acquired:
                self.lock.release()

    def unload(self, model_id, session_id=None):
        if not self.lock.acquire(blocking=False):
            raise RuntimeError("生成中です。終了後に解放してください")
        try:
            if not self.active or self.active["id"] != model_id:
                return False
            if session_id is not None and self.active.get("session_id") != session_id:
                raise RuntimeError("別セッションがモデルを利用しています")
            self._stop("explicit release")
            return True
        finally:
            self.lock.release()

    def _reap(self, poll_seconds):
        while not self.closed.wait(poll_seconds):
            if not self.lock.acquire(blocking=False):
                continue
            try:
                if self.active:
                    active = self.active
                    if (active["child"].poll() is not None or
                            time.monotonic() - active["last_used"] >= active["model"].get("keepAliveSeconds", 0) or self._waiting()):
                        self._stop("idle timeout, queued work or backend exited")
            except Exception as error:
                self._publish("error", reason=str(error))
            finally:
                self.lock.release()

    def close(self):
        self.closed.set()
        with self.lock:
            self._stop("broker shutdown")
        self.reaper.join(timeout=5)


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
            return self.json(200, {**snapshot(self.server.manager.root), "backend": self.server.manager.state()})
        if self.path == "/v1/models":
            return self.json(200, {"object": "list", "data": [{"id": name, "object": "model", "owned_by": "local"} for name in self.server.models]})
        if self.path == "/models/status":
            return self.json(200, self.server.manager.state())
        if self.path == "/health":
            return self.json(200, {"status": "ok"})
        self.json(404, {"error": "Not found"})

    def do_POST(self):
        if self.headers.get("Origin") or self.path not in ("/v1/chat/completions", "/v1/models/unload"):
            return self.json(403, {"error": "Server-side local API only"})
        started = False
        cancel = threading.Event()
        transport = {"socket": None}
        try:
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 1 or length > 32 * 1024 * 1024:
                    raise ValueError("Invalid content length")
                body = self.rfile.read(length)
                request = json.loads(body)
                if not isinstance(request, dict):
                    raise ValueError("Request must be an object")
            except (ValueError, UnicodeError) as error:
                self.close_connection = True
                return self.json(400, {"error": str(error)})
            model_id = request.get("model")
            model = self.server.models.get(model_id) if isinstance(model_id, str) else None
            if model is None:
                return self.json(400, {"error": "Unknown configured model"})
            session_id = self.headers.get("X-MangAI-Session")
            if session_id is not None and (not session_id or len(session_id) > 200):
                return self.json(400, {"error": "Invalid session header"})
            if self.path == "/v1/models/unload":
                try:
                    return self.json(200, {"unloaded": self.server.manager.unload(model_id, session_id)})
                except RuntimeError as error:
                    return self.json(409, {"error": str(error)})

            def watch_disconnect():
                while not cancel.wait(.1):
                    try:
                        readable, _, _ = select.select([self.connection], [], [], 0)
                        disconnected = readable and not self.connection.recv(1, socket.MSG_PEEK | socket.MSG_DONTWAIT)
                        if disconnected or self.server.manager.closed.is_set():
                            cancel.set()
                            upstream_socket = transport["socket"]
                            if upstream_socket:
                                upstream_socket.shutdown(socket.SHUT_RDWR)
                            return
                    except (OSError, ValueError):
                        cancel.set()
                        return
            threading.Thread(target=watch_disconnect, daemon=True).start()
            with self.server.manager.use(model_id, cancel, session_id) as pid:
                conn = http.client.HTTPConnection("127.0.0.1", model["port"], timeout=model.get("requestTimeout", 1800))
                try:
                    conn.request("POST", "/v1/chat/completions", body, {"Content-Type": "application/json"})
                    transport["socket"] = conn.sock
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
                    if cancel.is_set():
                        raise InterruptedError("生成を中止しました")
                    if not model.get("resident"):
                        destination = self.server.manager.root / "responses"
                        destination.mkdir(parents=True, exist_ok=True)
                        record = destination / (uuid.uuid4().hex + ".json")
                        record.write_text(json.dumps({"model": model_id, "phase": model["phase"], "sessionId": session_id,
                            "backendPid": pid, "status": upstream.status, "request": request,
                            "response": saved.decode("utf-8", errors="replace")}, ensure_ascii=False))
                finally:
                    transport["socket"] = None
                    conn.close()
        except (BrokenPipeError, ConnectionResetError):
            cancel.set()
        except Exception as error:
            if not started and not cancel.is_set():
                try:
                    self.json(503, {"error": {"message": str(error), "type": "local_model_error"}})
                except (BrokenPipeError, ConnectionResetError):
                    cancel.set()
        finally:
            cancel.set()


class BrokerServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, models, **manager_options):
        self.models = models
        super().__init__(address, Handler)
        self.manager = BackendManager(models, **manager_options)

    def server_close(self):
        self.manager.close()
        super().server_close()


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--port", type=int, default=1234)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    server = BrokerServer(("127.0.0.1", args.port), config["models"])
    def stop(_signum, _frame):
        server.manager.closed.set()
        threading.Thread(target=server.shutdown, daemon=True).start()
    for event in (signal.SIGTERM, signal.SIGINT):
        signal.signal(event, stop)
    try:
        server.serve_forever(poll_interval=.2)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
