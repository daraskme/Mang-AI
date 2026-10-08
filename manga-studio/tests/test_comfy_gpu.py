"""CPU-only contract check against the ComfyUI adapter; never imports torch."""
import os
from pathlib import Path
import runpy
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch


class AdapterTest(unittest.TestCase):
    def run_prompt(self, failure=None, queue_error=None):
        state = {"interrupted": False, "released": False, "ledger_error": None}

        class Executor:
            cache_type = "classic"
            cache_args = {}
            server = SimpleNamespace(client_id=None)

            def add_message(self, event, data, broadcast):
                self.status_messages.append((event, data))

            def execute(self, prompt, prompt_id, extra):
                self.success = not failure
                self.status_messages = [("execution_error" if failure else "execution_success", {"prompt_id": prompt_id})]
                self.history_result = {"outputs": {"3": "retained"}}
                self.caches = "loaded"

        class Lease:
            def __init__(self, *args, **kwargs):
                pass

            def __enter__(self):
                if queue_error:
                    raise queue_error

            def __exit__(self, kind, error, tb):
                state["ledger_error"] = error

        models = SimpleNamespace(processing_interrupted=lambda: state["interrupted"], interrupt_current_processing=lambda v: state.update(interrupted=v), unload_all_models=lambda: state.update(released=True), soft_empty_cache=lambda: None)
        modules = {"execution": SimpleNamespace(PromptExecutor=Executor, CacheSet=lambda **kwargs: "empty"), "comfy": SimpleNamespace(model_management=models), "comfy.model_management": models, "mangai_gpu": SimpleNamespace(GpuLease=Lease)}
        with patch.dict(sys.modules, modules), patch.dict(os.environ, {"MANGAI_GPU_STATE": "enabled"}):
            runpy.run_path(str(Path(__file__).resolve().parents[1] / 'integrations/comfy-gpu-lease/__init__.py'))
            worker = Executor()
            worker.execute({}, 'test', {"client_id": "browser"})
        return worker, state

    def test_success_preserves_outputs_and_messages(self):
        worker, state = self.run_prompt()
        self.assertTrue(worker.success)
        self.assertEqual(worker.history_result['outputs']['3'], 'retained')
        self.assertEqual(worker.status_messages[0][0], 'execution_success')
        self.assertEqual(worker.caches, 'empty')
        self.assertTrue(state['released'])

    def test_generation_failure_not_reset_to_success(self):
        worker, state = self.run_prompt(failure=True)
        self.assertFalse(worker.success)
        self.assertTrue(state['released'])
        self.assertIsInstance(state['ledger_error'], RuntimeError)
        self.assertEqual(len(worker.status_messages), 1)

    def test_queue_cancellation_does_not_escape_worker(self):
        worker, state = self.run_prompt(queue_error=InterruptedError('cancel'))
        self.assertFalse(worker.success)
        self.assertEqual(worker.status_messages[0][0], 'execution_interrupted')
        self.assertEqual(worker.history_result, {'outputs': {}, 'meta': {}})
        self.assertFalse(state['released'])


if __name__ == '__main__':
    unittest.main()
