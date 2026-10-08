import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

STUDIO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('glm_config', STUDIO / 'scripts/configure-glm-coder.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class GlmConfigTests(unittest.TestCase):
    def test_selecting_glm_preserves_a1_and_other_model_settings(self):
        with tempfile.TemporaryDirectory(dir=STUDIO) as folder:
            root = Path(folder)
            engine = root / 'upstream/Strata-GLM'
            paths = [engine / 'build/strata', engine / '.venv/bin/python', engine / 'tools/run_glm.py',
                root / 'models/llm/glm-5.3-flash-orcarouter/Q4_K_M/pack-maya-q4/tokenizer/chat_template.jinja']
            for path in paths:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.touch()
            broker_path = root / 'work/runtime/model-broker.json'
            broker_path.parent.mkdir(parents=True)
            old = {'models': {'a1': {'resident': True, 'port': 1240}, 'qwen': {'command': ['existing']}}}
            broker_path.write_text(json.dumps(old))
            studio_path = root / 'manga-studio/studio.config.json'
            studio_path.parent.mkdir(parents=True)
            studio_path.write_text(json.dumps({'agent': {'custom': True}, 'coder': {'timeoutMs': 12345}, 'art': {'custom': 'keep'}}))
            overlay_path = root / 'manga-studio/local.patch.yml'
            overlay_path.write_text(json.dumps([{'id': 'llm-pi-ai', 'config': {'providers': {
                'manga-agent': {'model': 'a1'}, 'manga-coder': {'apiKeyEnv': 'EXISTING', 'models': []}}}}]))
            changes = module.build_changes(root)
            self.assertEqual(json.loads(broker_path.read_text()), old, 'dry plan must not write')
            self.assertEqual(changes[studio_path]['agent'], {'custom': True})
            self.assertEqual(changes[studio_path]['art'], {'custom': 'keep'})
            self.assertEqual(changes[studio_path]['coder']['timeoutMs'], 12345)
            self.assertEqual(changes[broker_path]['models']['qwen'], old['models']['qwen'])
            glm = changes[broker_path]['models'][module.MODEL_ID]
            self.assertTrue(glm['externalLease'])
            self.assertIn('--external-gpu-lease', glm['command'])
            self.assertEqual(glm['keepAliveSeconds'], 600)
            self.assertNotIn('--trace-experts', glm['command'])
            long = module.build_changes(root, context=262144)
            long_command = long[broker_path]['models'][module.MODEL_ID]['command']
            self.assertEqual(long_command[long_command.index('--context') + 1], '262144')
            self.assertEqual(long_command[long_command.index('--ram-headroom-gib') + 1], '16')
            self.assertEqual(long[studio_path]['coder']['contextWindow'], 262144)
            self.assertEqual(long[broker_path]['models']['a1'], old['models']['a1'])
            self.assertNotIn('--lookahead-layers', glm['command'])
            self.assertNotIn('--cpu-plan', glm['command'])
            split = module.build_changes(root, cpu_plan='012234556')
            split_command = split[broker_path]['models'][module.MODEL_ID]['command']
            self.assertEqual(split_command[split_command.index('--cpu-plan') + 1], '012234556')
            for bad_plan in ('01223455', '003234556', '01223455x', '０12234556', 12345678):
                with self.assertRaises(ValueError):
                    module.build_changes(root, cpu_plan=bad_plan)
            ahead = module.build_changes(root, lookahead_layers=2)
            ahead_command = ahead[broker_path]['models'][module.MODEL_ID]['command']
            self.assertEqual(ahead_command[ahead_command.index('--lookahead-layers') + 1], '2')
            self.assertEqual(ahead[broker_path]['models']['a1'], old['models']['a1'])
            for bad in (-1, 5, True, 1.5, '2'):
                with self.assertRaises(ValueError):
                    module.build_changes(root, lookahead_layers=bad)
            traced = module.build_changes(root, trace_experts=True)
            self.assertIn('--trace-experts', traced[broker_path]['models'][module.MODEL_ID]['command'])
            module.apply_changes(changes)
            self.assertEqual(json.loads(studio_path.read_text())['coder']['model'], module.MODEL_ID)
            self.assertEqual(len(list(studio_path.parent.glob('studio.config.json.before-glm-*'))), 1)
            providers = json.loads(overlay_path.read_text())[0]['config']['providers']
            self.assertEqual(providers['manga-agent'], {'model': 'a1'})
            self.assertEqual(providers['manga-coder']['apiKeyEnv'], 'EXISTING')


if __name__ == '__main__':
    unittest.main()
