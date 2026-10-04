"""Test the bridge protocol without importing torch or downloading weights."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class BridgeTest(unittest.TestCase):
    def test_official_pipeline_and_sampling_calls(self):
        output = ROOT / ".test-output"
        output.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=output) as temp:
            repo = Path(temp)
            (repo / "inference.py").write_text(
                "def _pipeline(checkpoint):\n"
                "    assert checkpoint == 'oss_turbo'\n"
                "    return 'dit', 'ae', 'encoder'\n", encoding="utf-8"
            )
            (repo / "sampling.py").write_text(
                "from pathlib import Path\n"
                "class Image:\n"
                "    def save(self, path): Path(path).write_bytes(b'PNG fixture')\n"
                "def sample(dit, ae, encoder, prompts, **kw):\n"
                "    assert (dit, ae, encoder) == ('dit', 'ae', 'encoder')\n"
                "    assert kw['steps'] == 8 and kw['guidance'] == 0\n"
                "    assert kw['width'] == 1024 and kw['height'] == 768\n"
                "    assert kw['seed'] == 7\n"
                "    assert prompts == ['A station. No text.']\n"
                "    return [Image()]\n", encoding="utf-8"
            )
            request = {
                "repo": temp, "checkpoint": "oss_turbo", "steps": 8,
                "cfg": 0, "mu": 1.15,
                "panels": [{"id": "p1-c1", "prompt": "A station. No text.",
                            "width": 1024, "height": 768, "seed": 7,
                            "output": str(repo / "panel.png")}],
            }
            result = subprocess.run(
                [sys.executable, str(ROOT / "python/render_krea.py")],
                input=json.dumps(request), text=True, capture_output=True,
                env={**os.environ, "OSS_TURBO": str(repo / "weights")},
                check=True,
            )
            self.assertEqual(json.loads(result.stdout)["panel"], "p1-c1")
            self.assertEqual((repo / "panel.png").read_bytes(), b"PNG fixture")
            self.assertFalse((repo / "panel.partial.png").exists())


if __name__ == "__main__":
    unittest.main()
