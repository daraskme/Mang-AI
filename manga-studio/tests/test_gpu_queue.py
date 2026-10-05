import json
import multiprocessing as mp
from pathlib import Path
import shutil
import sys
import tempfile
import time
import unittest

STUDIO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(STUDIO / "python"))
from mangai_gpu import GpuLease, database


def free():
    return {"ramAvailableGiB": 100, "vramFreeGiB": 85, "vramTotalGiB": 96}


def worker(root, events, hold):
    with GpuLease("krea", root=root, measure=free):
        events.put("entered")
        hold.wait(5)
    events.put("exited")


class QueueTests(unittest.TestCase):
    def setUp(self):
        base = STUDIO / ".test-output"
        base.mkdir(exist_ok=True)
        self.root = Path(tempfile.mkdtemp(prefix="gpu-", dir=base))

    def tearDown(self):
        shutil.rmtree(self.root)

    def test_cross_process_exclusion_and_release_after_exception(self):
        ctx = mp.get_context("spawn")
        events, hold = ctx.Queue(), ctx.Event()
        process = ctx.Process(target=worker, args=(str(self.root), events, hold))
        with GpuLease("gemma", root=self.root, measure=free):
            process.start()
            time.sleep(0.3)
            self.assertTrue(events.empty())
        self.assertEqual(events.get(timeout=5), "entered")
        hold.set()
        self.assertEqual(events.get(timeout=5), "exited")
        process.join(5)
        self.assertEqual(process.exitcode, 0)
        with self.assertRaisesRegex(ValueError, "test failure"):
            with GpuLease("gemma", root=self.root, measure=free):
                raise ValueError("test failure")
        with GpuLease("krea", root=self.root, measure=free):
            pass
        with database(self.root) as db:
            rows = [json.loads(row[0]) for row in db.execute("SELECT body FROM requests")]
        self.assertEqual(sum(r["state"] == "failed" for r in rows), 1)
        self.assertTrue(all(r["phase"] != "agent" for r in rows))

    def test_insufficient_memory_never_starts_and_records_reason(self):
        messages = []
        with self.assertRaises(TimeoutError):
            with GpuLease("coder", root=self.root, measure=lambda: {**free(), "ramAvailableGiB": 40}, timeout=0.1, progress=messages.append):
                self.fail("Insufficient RAM must not admit coder")
        self.assertTrue(any("88GiB" in msg and "40GiB" in msg for msg in messages))
        with GpuLease("krea", root=self.root, measure=free):
            pass

    def test_cancel_wait_does_not_allocate(self):
        with self.assertRaises(InterruptedError):
            with GpuLease("krea", root=self.root, cancelled=lambda: True, measure=lambda: self.fail("must not measure")):
                self.fail("must not enter")


if __name__ == "__main__":
    unittest.main()
