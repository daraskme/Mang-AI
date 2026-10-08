"""A process-shared GPU lease. Resident A1 never enters this heavy-work queue.

Set MANGAI_GPU_STATE to enable it in managed generation environments. The file
lock is released by the OS on crashes; the registry is for progress, not locking.
No external applications are stopped. Callers must unload their own model before
leaving the context (or run a subprocess that exits before leaving it).
"""
from contextlib import AbstractContextManager
from pathlib import Path
import fcntl
import json
import os
import signal
import sqlite3
import subprocess
import sys
import time
import uuid
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_STATE = ROOT / "work" / "gpu"
REQUIREMENTS = {  # free memory floors in GiB, checked before load; tune from measurements
    "gemma": (36, 40), "coder": (88, 72), "krea": (16, 48),
    "h3": (24, 48), "longvideo": (24, 48), "caption": (16, 24),
    "training": (24, 64), "editing": (4, 4),
}


def memory():
    info = dict(line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines())
    ram = int(info["MemAvailable"].split()[0]) / 1024**2
    result = subprocess.run(["nvidia-smi", "--query-gpu=memory.free,memory.total", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=5, check=True)
    free, total = map(float, result.stdout.splitlines()[0].split(","))
    return {"ramAvailableGiB": round(ram, 2), "vramFreeGiB": round(free / 1024, 2), "vramTotalGiB": round(total / 1024, 2)}


def process_stamp(pid):
    try:
        # Fields after the final ')' start with process state (field 3).
        return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19]
    except (OSError, IndexError):
        return None


def database(root):
    root.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(root / "queue.sqlite", timeout=10)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, body TEXT NOT NULL)")
    return db


def snapshot(root=DEFAULT_STATE):
    with database(Path(root)) as db:
        requests = [json.loads(row[0]) for row in db.execute("SELECT body FROM requests ORDER BY rowid DESC LIMIT 100")]
    for request in requests:
        if request["state"] in ("queued", "waiting_memory", "running") and process_stamp(request["pid"]) != request["processStamp"]:
            request.update(state="interrupted", reason="所有プロセスが終了しました")
    try:
        resources = memory()
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        resources = {"error": str(error)}
    try:
        with urllib.request.urlopen("http://127.0.0.1:1240/health", timeout=1) as response:
            resident = "準備完了" if response.status == 200 else "読み込み中"
    except OSError:
        resident = "未接続・読み込み中"
    return {"resident": {"model": "Agents A1 4B Q8", "status": resident}, "resources": resources, "requests": requests}


class GpuLease(AbstractContextManager):
    def __init__(self, phase, label="", *, root=None, cancelled=lambda: False, progress=lambda message: None, limits=None, measure=memory, timeout=1800):
        if phase not in REQUIREMENTS:
            raise ValueError("Unknown GPU phase")
        state = root or os.environ.get("MANGAI_GPU_STATE")
        self.root = Path(state) if state else None
        self.phase, self.label = phase, label or phase
        self.cancelled, self.progress, self.measure = cancelled, progress, measure
        self.limits = limits or REQUIREMENTS[phase]
        self.timeout = timeout
        self.fd = None
        self.record = {"id": uuid.uuid4().hex, "phase": phase, "label": self.label, "pid": os.getpid(), "processStamp": process_stamp(os.getpid()), "createdAt": time.time(), "state": "queued", "minimumRamGiB": self.limits[0], "minimumVramGiB": self.limits[1]}

    def update(self, state, reason="", **extra):
        self.record.update(state=state, reason=reason, updatedAt=time.time(), **extra)
        with database(self.root) as db:
            db.execute("INSERT OR REPLACE INTO requests VALUES (?, ?)", (self.record["id"], json.dumps(self.record, ensure_ascii=False)))
            db.execute("DELETE FROM requests WHERE rowid NOT IN (SELECT rowid FROM requests ORDER BY rowid DESC LIMIT 300) AND json_extract(body,'$.state') NOT IN ('queued','waiting_memory','running')")
        self.progress(reason)

    def __enter__(self):
        if self.root is None:
            return self
        self.update("queued", "GPUの空きを待っています。A1は常駐を維持します")
        self.fd = open(self.root / "heavy.lock", "a+b")
        deadline = time.monotonic() + self.timeout
        locked = False
        try:
            while True:
                if self.cancelled():
                    raise InterruptedError("GPU待機を中止しました")
                if time.monotonic() > deadline:
                    raise TimeoutError("GPU/メモリ待機が上限に達しました。進捗画面の必要量と空き容量を確認してください")
                if not locked:
                    try:
                        fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        locked = True
                    except BlockingIOError:
                        time.sleep(0.5)
                        continue
                free = self.measure()
                if free["ramAvailableGiB"] >= self.limits[0] and free["vramFreeGiB"] >= self.limits[1]:
                    self.update("running", f"{self.label}を実行します。GPU・RAMを使用します", resources=free)
                    return self
                self.update("waiting_memory", f"必要空きRAM {self.limits[0]}GiB / VRAM {self.limits[1]}GiB。現在RAM {free['ramAvailableGiB']}GiB / VRAM {free['vramFreeGiB']}GiB。他アプリやVMは利用者が停止してください", resources=free)
                # A large waiting coder must not block smaller, runnable tasks.
                fcntl.flock(self.fd, fcntl.LOCK_UN)
                locked = False
                time.sleep(2)
        except BaseException as error:
            self.__exit__(type(error), error, error.__traceback__)
            raise

    def __exit__(self, exc_type, exc, tb):
        if self.root is not None:
            try:
                self.update("failed" if exc else "completed", str(exc)[:1000] if exc else "処理とモデル解放が終了しました")
            finally:
                if self.fd:
                    self.fd.close()
                    self.fd = None
        return False


def run():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=REQUIREMENTS)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("command is required")
    stopped = False
    child = None

    def stop(signum, frame):
        nonlocal stopped
        stopped = True
        if child and child.poll() is None:
            child.send_signal(signum)

    for event in (signal.SIGTERM, signal.SIGINT):
        signal.signal(event, stop)
    with GpuLease(args.phase, cancelled=lambda: stopped, progress=lambda msg: print(msg, file=sys.stderr, flush=True)):
        if stopped:
            raise InterruptedError("中止しました")
        child = subprocess.Popen(command)
        try:
            code = child.wait()
        finally:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(10)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
        if code:
            raise subprocess.CalledProcessError(code, command)
    sys.exit(code)


if __name__ == "__main__":
    run()
