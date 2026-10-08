"""Mang-AI shared GPU lease around ComfyUI prompts, including native GUI jobs."""
import functools
import gc
import os
import sys
from pathlib import Path

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

if os.environ.get("MANGAI_GPU_STATE"):
    if os.environ.get("MANGAI_GPU_RUNNER"):
        sys.path.insert(0, str(Path(os.environ["MANGAI_GPU_RUNNER"]).parent))
    import execution
    import comfy.model_management as models
    from mangai_gpu import GpuLease

    original = execution.PromptExecutor.execute

    @functools.wraps(original)
    def leased_execute(self, prompt, prompt_id, *args, **kwargs):
        # Reset a previous prompt's cancellation before entering the queue.
        models.interrupt_current_processing(False)
        self.status_messages = []
        self.history_result = {"outputs": {}, "meta": {}}
        self.success = False
        extra = args[0] if args else kwargs.get("extra_data", {})
        self.server.client_id = extra.get("client_id")
        try:
            with GpuLease("longvideo", f"H3 LongVideos {prompt_id}", cancelled=models.processing_interrupted):
                try:
                    result = original(self, prompt, prompt_id, *args, **kwargs)
                    if not self.success:
                        raise RuntimeError("H3 LongVideosの実行に失敗しました。生成履歴を確認してください")
                    return result
                finally:
                    # reset() also clears failure status/messages needed by task_done().
                    # Replace only the model-bearing caches, preserving history.
                    self.caches = execution.CacheSet(cache_type=self.cache_type, cache_args=self.cache_args)
                    models.unload_all_models()
                    gc.collect()
                    models.soft_empty_cache()
        except Exception as error:
            self.success = False
            # Queue cancellation/error must not escape and kill Comfy's worker.
            if not any(event in {"execution_error", "execution_interrupted"} for event, _ in self.status_messages):
                interrupted = isinstance(error, InterruptedError) or models.processing_interrupted()
                self.add_message("execution_interrupted" if interrupted else "execution_error", {
                    "prompt_id": prompt_id, "node_id": None, "node_type": "Mang-AI GPU queue",
                    "executed": [], "exception_message": str(error), "exception_type": type(error).__name__,
                    "traceback": [], "current_inputs": {}, "current_outputs": [],
                }, broadcast=True)

    execution.PromptExecutor.execute = leased_execute
