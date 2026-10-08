"""Register the prepared Orca GLM worker; preserve other models and A1 settings.

Dry run by default. --apply saves timestamped backups and updates configs; it
does not start models, restart services, download weights, or modify user units.
"""
import argparse
import copy
from datetime import datetime, timezone
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODEL_ID = 'glm-5.3-flash-orcarouter-q4-mangai'
DISPLAY_NAME = 'GLM 5.3 Flash Orca Q4 · コーディング'


def build_changes(root, context=131072, thinking_budget=0, keep_alive=600, trace_experts=False, lookahead_layers=0, cpu_plan=None):
    if context not in (32768, 65536, 131072, 262144):
        raise ValueError('unsupported context')
    if not 0 <= thinking_budget < context or not 0 <= keep_alive <= 3600:
        raise ValueError('invalid reasoning cap or keep-alive')
    if isinstance(lookahead_layers, bool) or not isinstance(lookahead_layers, int) or not 0 <= lookahead_layers <= 4:
        raise ValueError('lookahead layers must be an integer in 0..4')
    if cpu_plan is not None and (not isinstance(cpu_plan, str) or len(cpu_plan) != 9 or
            any(char not in '012345678' or int(char) > index for index, char in enumerate(cpu_plan))):
        raise ValueError('CPU plan requires 9 ASCII digits; digit f must be in 0..f')
    engine = root / 'upstream/Strata-GLM'
    pack = root / 'models/llm/glm-5.3-flash-orcarouter/Q4_K_M/pack-maya-q4'
    for path in (engine / 'build/strata', engine / '.venv/bin/python', engine / 'tools/run_glm.py', pack / 'tokenizer/chat_template.jinja'):
        if not path.is_file():
            raise ValueError(f'prepared GLM file is missing: {path}')
    broker_path = root / 'work/runtime/model-broker.json'
    studio_path = root / 'manga-studio/studio.config.json'
    broker = json.loads(broker_path.read_text())
    studio = json.loads(studio_path.read_text())
    broker['models'][MODEL_ID] = {
        'phase': 'coder', 'port': 1243, 'label': DISPLAY_NAME,
        'cwd': str(engine), 'minimumFreeGiB': [94, 80],
        'keepAliveSeconds': keep_alive, 'startupTimeout': 1800, 'requestTimeout': 3600,
        'externalLease': True,
        'command': [str(engine / '.venv/bin/python'), str(engine / 'tools/run_glm.py'),
            '--pack', str(pack), '--context', str(context), '--model-name', MODEL_ID,
            '--vram-cap-gib', '90', '--ram-headroom-gib', '16' if context == 262144 else '12',
            '--prefill-mb', '8192', '--prefill-chunk', '16384',
            '--cpu-threads', '8', '--cpu-spin-us', '1000', '--cpu-affinity', '0-15',
            '--uniform-expert-slots', '--mangai-root', str(root), '--external-gpu-lease',
            '--thinking-budget', str(thinking_budget), '--run'],
    }
    if cpu_plan is not None:
        broker['models'][MODEL_ID]['command'].extend(['--cpu-plan', cpu_plan])
    if lookahead_layers:
        broker['models'][MODEL_ID]['command'].extend(['--lookahead-layers', str(lookahead_layers)])
    if trace_experts:
        broker['models'][MODEL_ID]['command'].append('--trace-experts')
    studio['coder'] = {**studio.get('coder', {}), 'baseURL': 'http://127.0.0.1:1234/v1',
        'model': MODEL_ID, 'displayName': DISPLAY_NAME, 'contextWindow': context,
        'maxTokens': min(16384, context // 4)}
    changes = {broker_path: broker, studio_path: studio}
    generated = root / 'work/runtime/studio.config.json'
    if generated.exists():
        value = json.loads(generated.read_text())
        value['coder'] = copy.deepcopy(studio['coder'])
        changes[generated] = value
    overlay_path = root / 'manga-studio/local.patch.yml'
    if overlay_path.exists():
        overlay = json.loads(overlay_path.read_text())  # configure.mjs emits JSON-compatible YAML
        entry = next(item for item in overlay if item.get('id') == 'llm-pi-ai')
        coder = entry['config']['providers']['manga-coder']
        coder.update(displayName=DISPLAY_NAME, baseURL=studio['coder']['baseURL'], models=[{
            'id': MODEL_ID, 'name': DISPLAY_NAME, 'contextWindow': context,
            'maxTokens': studio['coder']['maxTokens'], 'input': ['text']}])
        changes[overlay_path] = overlay
    return changes


def apply_changes(changes):
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    originals = {path: path.read_bytes() for path in changes}
    # Prepare every backup and replacement before modifying any live file.
    temporary = {}
    replaced = []
    try:
        for path, value in changes.items():
            with path.with_name(path.name + '.before-glm-' + stamp).open('xb') as backup:
                backup.write(originals[path])
            target = path.with_name(path.name + '.glm-' + stamp)
            with target.open('x') as output:
                output.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
            os.chmod(target, path.stat().st_mode & 0o777)
            temporary[path] = target
        for path in changes:
            if path.read_bytes() != originals[path]:
                raise RuntimeError(f'configuration changed while preparing: {path}')
        for path, target in temporary.items():
            os.replace(target, path)
            replaced.append(path)
    except BaseException:
        for path in replaced:
            path.write_bytes(originals[path])
        raise
    finally:
        for target in temporary.values():
            target.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--context', type=int, default=131072)
    parser.add_argument('--thinking-budget', type=int, default=0)
    parser.add_argument('--keep-alive', type=int, default=600)
    parser.add_argument('--trace-experts', action='store_true', help='Record expert placement for a measurement run')
    parser.add_argument('--cpu-plan', help='optional measured CPU expert counts for RAM-tier miss counts 0..8')
    parser.add_argument('--lookahead-layers', type=int, choices=range(5), default=0, help='SSD-to-RAM lookahead depth; 0 disables')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    changes = build_changes(args.root.resolve(), args.context, args.thinking_budget, args.keep_alive, args.trace_experts, args.lookahead_layers, args.cpu_plan)
    if args.apply:
        apply_changes(changes)
    print(json.dumps({'applied': args.apply, 'model': MODEL_ID, 'context': args.context,
        'thinkingBudget': args.thinking_budget, 'keepAliveSeconds': args.keep_alive, 'traceExperts': args.trace_experts, 'lookaheadLayers': args.lookahead_layers, 'cpuPlan': args.cpu_plan,
        'files': [str(path) for path in changes], 'note': 'No services restarted; A1 unchanged.'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
