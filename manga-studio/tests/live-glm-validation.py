"""Opt-in GLM inference test. Uses the shared GPU lease and stops its own server.

Requires the pinned, verified IQ4_XS files and a working CUDA runtime. Outputs
synthetic prompts, responses, logs, and resource samples into .test-output/.
Notify the user of GPU/RAM load before running with --run.
"""
import argparse
import ast
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import resource
import runpy
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'manga-studio/python'))
from mangai_gpu import GpuLease, memory

PLAN = runpy.run_path(str(Path(__file__).with_name('glm-validation-plan.py')))
BASE = 'http://127.0.0.1:1243'
MODEL = 'glm-5.3-flash-iq4-validation'


def emit(event, **data):
    print(json.dumps({'event': event, **data}, ensure_ascii=False), flush=True)


def save(path, data):
    staging = path.with_suffix('.partial')
    staging.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    staging.replace(path)


def request(path, payload=None, timeout=120):
    data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)


def a1_status():
    try:
        with urllib.request.urlopen('http://127.0.0.1:1240/health', timeout=2) as response:
            healthy = response.status == 200
        pid = subprocess.check_output(['systemctl', '--user', 'show', 'mang-ai-agent.service', '--property=MainPID', '--value'], text=True, timeout=3).strip()
        return {'healthy': healthy, 'pid': pid}
    except (OSError, subprocess.SubprocessError):
        return {'healthy': False, 'pid': None}


def chat(out, name, messages, **extra):
    body = {
        'model': MODEL, 'messages': messages,
        'stream': True, 'stream_options': {'include_usage': True},
        'return_progress': True, 'cache_prompt': False, 'n_cache_reuse': 0,
        'max_tokens': 512, 'reasoning_effort': 'low', 'reasoning_budget_tokens': 64,
        'temperature': 1.0, 'top_p': 0.95, 'seed': 42, **extra,
    }
    save(out / f'{name}-request.json', body)
    result = {'name': name, 'content': '', 'reasoning': '', 'tool_calls': [], 'firstReasoningSeconds': None, 'firstContentSeconds': None, 'finishReason': None}
    count_payload = {k: v for k, v in body.items() if k not in ('stream', 'stream_options', 'return_progress')}
    result['countedInputTokens'] = request('/v1/chat/completions/input_tokens', count_payload)['input_tokens']
    req = urllib.request.Request(BASE + '/v1/chat/completions', data=json.dumps(body, ensure_ascii=False).encode(), headers={'Content-Type': 'application/json'})
    start = time.monotonic()
    tools = {}
    last_progress = 0
    done = False
    emit('request', name=name, inputTokens=result['countedInputTokens'])
    with urllib.request.urlopen(req, timeout=120) as response:
        for line in response:
            if not line.startswith(b'data: '):
                continue
            raw = line[6:].strip()
            if raw == b'[DONE]':
                done = True
                break
            chunk = json.loads(raw)
            if 'error' in chunk:
                raise RuntimeError(str(chunk['error']))
            elapsed = time.monotonic() - start
            progress = chunk.get('prompt_progress')
            if progress and elapsed - last_progress >= 20:
                emit('prefill', name=name, progress=progress)
                last_progress = elapsed
            for choice in chunk.get('choices', []):
                delta = choice.get('delta', {})
                if delta.get('reasoning_content'):
                    if result['firstReasoningSeconds'] is None:
                        result['firstReasoningSeconds'] = elapsed
                    result['reasoning'] += delta['reasoning_content']
                if delta.get('content'):
                    if result['firstContentSeconds'] is None:
                        result['firstContentSeconds'] = elapsed
                    result['content'] += delta['content']
                for item in delta.get('tool_calls', []):
                    tool = tools.setdefault(item['index'], {'id': '', 'type': 'function', 'function': {'name': '', 'arguments': ''}})
                    if item.get('id'):
                        tool['id'] = item['id']
                    for key in ('name', 'arguments'):
                        tool['function'][key] += item.get('function', {}).get(key, '')
                if choice.get('finish_reason'):
                    result['finishReason'] = choice['finish_reason']
            if chunk.get('usage'):
                result['usage'] = chunk['usage']
            if chunk.get('timings'):
                result['timings'] = chunk['timings']
    result['wallSeconds'] = time.monotonic() - start
    result['streamDone'] = done
    result['tool_calls'] = [tools[k] for k in sorted(tools)]
    result['completed'] = done and result['finishReason'] in ('stop', 'tool_calls')
    save(out / f'{name}-response.json', result)
    emit('response', name=name, wallSeconds=round(result['wallSeconds'], 2), finish=result['finishReason'], timings=result.get('timings'))
    return result


def check_code(text):
    match = re.search(r'```(?:python)?\s*\n(.*?)```', text, re.S)
    code = match[1] if match else text.strip()
    tree = ast.parse(code)
    allowed = (ast.Module, ast.FunctionDef, ast.arguments, ast.arg, ast.Return, ast.If,
               ast.Raise, ast.Expr, ast.Constant, ast.Call, ast.Name, ast.Load,
               ast.Compare, ast.Gt, ast.GtE, ast.Lt, ast.LtE, ast.Eq, ast.NotEq,
               ast.IfExp, ast.BoolOp, ast.And, ast.Or, ast.UnaryOp, ast.USub)
    if any(not isinstance(node, allowed) for node in ast.walk(tree)):
        return {'passed': False, 'reason': 'Code outside the deliberately restricted pure-function test grammar'}
    if len(tree.body) != 1 or not isinstance(tree.body[0], ast.FunctionDef) or tree.body[0].name != 'clamp':
        return {'passed': False, 'reason': 'Expected one clamp function'}
    fn = tree.body[0]
    if fn.decorator_list or fn.args.defaults or fn.args.kw_defaults:
        return {'passed': False, 'reason': 'Expected an undecorated function without defaults'}
    annotations = [fn.returns, *(a.annotation for a in fn.args.args)]
    if any(a is not None and (not isinstance(a, ast.Name) or a.id not in ('int', 'float', 'bool')) for a in annotations):
        return {'passed': False, 'reason': 'Unsupported annotation in restricted test'}
    annotation_free = not any(a is not None for a in annotations)
    fn.returns = None
    for argument in fn.args.args:
        argument.annotation = None
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and (not isinstance(node.func, ast.Name) or node.func.id not in ('min', 'max', 'ValueError')):
            return {'passed': False, 'reason': 'Unexpected call'}
    scope = {'__builtins__': {'min': min, 'max': max, 'ValueError': ValueError}}
    exec(compile(tree, '<synthetic-clamp-test>', 'exec'), scope)
    cases = [(5, 2, 9, 5), (-1, 2, 9, 2), (12, 2, 9, 9), (2, 2, 9, 2), (9, 2, 9, 9), (0.5, 0.0, 1.0, 0.5)]
    results = [scope['clamp'](v, lo, hi) == expected for v, lo, hi, expected in cases]
    try:
        scope['clamp'](5, 9, 2)
        results.append(False)
    except ValueError:
        results.append(True)
    return {'passed': all(results), 'casesPassed': sum(results), 'casesTotal': len(results), 'followedNoAnnotationsInstruction': annotation_free}


def long_messages(rows, marker):
    expected = {key: f'{marker}-{suffix}' for key, suffix in [('東棟', 'A7'), ('西棟', 'B4'), ('南棟', 'C9')]}
    positions = dict(zip((rows // 10, rows // 2, rows * 9 // 10), expected.items()))
    lines = []
    for i in range(rows):
        lines.append(f'Record {i:06d}: archive item {i*17%997:03d}; reviewed, ordinary maintenance, no access-code update.')
        if i in positions:
            key, value = positions[i]
            lines.append(f'【確定記録】{key}の入館コードは「{value}」。')
    text = '以下は架空の記録です。最後の質問に資料の記載だけで答えてください。\n' + '\n'.join(lines)
    text += '\n質問：東棟・西棟・南棟の入館コードを、キーをその棟名としたJSONオブジェクトだけで返してください。'
    return [{'role': 'user', 'content': text}], expected


def long_test(out, target):
    marker = uuid.uuid4().hex[:8]
    rows = max(30, target // 30)
    for _ in range(6):
        messages, expected = long_messages(rows, marker)
        n = request('/v1/chat/completions/input_tokens', {'model': MODEL, 'messages': messages, 'reasoning_effort': 'low'})['input_tokens']
        if abs(n - target) < 64:
            break
        rows = max(30, round(rows * target / n))
    save(out / 'long-expected.json', {'expected': expected, 'targetInputTokens': target, 'countedInputTokens': n})
    result = chat(out, 'long', messages)
    try:
        text = result['content'].strip()
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text)
        correct = json.loads(text) == expected
    except (ValueError, TypeError):
        correct = False
    timings = result.get('timings', {})
    no_reuse = timings.get('cache_n') == 0 and timings.get('prompt_n') == result.get('usage', {}).get('prompt_tokens')
    return {'passed': result['completed'] and correct and no_reuse, 'retrievalCorrect': correct, 'cacheReuseDisabledConfirmed': no_reuse, 'response': result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--ctx', type=int, choices=[8192, 32768, 65536], default=8192)
    parser.add_argument('--long-target', type=int, default=0)
    parser.add_argument('--only-long', action='store_true')
    parser.add_argument('--cache-k', choices=['f16', 'q8_0'], default='f16')
    parser.add_argument('--cpu-experts', type=int, choices=[24, 26, 28], default=26)
    parser.add_argument('--load-mode', choices=['auto', 'none'], default='auto')
    parser.add_argument('--max-seconds', type=int, default=2400)
    args = parser.parse_args()
    if not args.run:
        parser.error('Actual inference requires --run after notifying the user of GPU/RAM load')
    if args.long_target and not 1000 <= args.long_target <= args.ctx - 1024:
        parser.error('long-target must leave at least 1024 context tokens for the answer')
    if args.only_long and not args.long_target:
        parser.error('only-long requires long-target')
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    preflight = PLAN['preflight']()
    if not preflight['readyForManualValidation']:
        raise RuntimeError(json.dumps(preflight['blockers']))
    out = ROOT / 'manga-studio/.test-output' / f'glm-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:6]}'
    out.mkdir(parents=True)
    save(out / 'preflight.json', preflight)
    cmd = PLAN['command']()
    for flag, value in [('--ctx-size', args.ctx), ('--cache-type-k', args.cache_k), ('--n-cpu-moe', args.cpu_experts)]:
        cmd[cmd.index(flag)+1] = str(value)
    cmd += ['--load-mode', args.load_mode]
    report = {'settings': vars(args), 'command': cmd, 'a1Before': a1_status(), 'checks': {}, 'inferencePassed': False}
    save(out / 'report.json', report)
    emit('start', directory=str(out), context=args.ctx, cacheK=args.cache_k)
    child = None
    finished = threading.Event()
    failure = []
    samples = []
    started = time.monotonic()

    def stop_child():
        if child and child.poll() is None:
            child.terminate()

    def interrupt(signum, frame):
        failure.append(f'interrupted:{signum}')
        stop_child()
        raise InterruptedError('Validation interrupted')

    def monitor():
        failures = 0
        while not finished.wait(2):
            try:
                sample = {'elapsedSeconds': round(time.monotonic()-started, 2), **memory()}
                fields = dict(line.split(':', 1) for line in Path(f'/proc/{child.pid}/status').read_text().splitlines() if ':' in line)
                sample['processRssGiB'] = int(fields.get('VmRSS', '0 kB').split()[0]) / 1024**2
                sample['a1'] = a1_status()
                samples.append(sample)
                if sample['ramAvailableGiB'] < 6 or sample['vramFreeGiB'] < 1 or not sample['a1']['healthy']:
                    failure.append('Resource floor or resident A1 health check failed')
                    stop_child()
                    return
                if sample['elapsedSeconds'] > args.max_seconds:
                    failure.append('Validation wall-clock limit exceeded')
                    stop_child()
                    return
                failures = 0
            except (OSError, ValueError, subprocess.SubprocessError):
                if child.poll() is not None:
                    return
                failures += 1
                if failures >= 3:
                    failure.append('Resource monitoring failed repeatedly')
                    stop_child()
                    return

    signal.signal(signal.SIGTERM, interrupt)
    signal.signal(signal.SIGINT, interrupt)
    try:
        with GpuLease('coder', f'GLM Flash validation {args.ctx}', root=ROOT/'work/gpu', limits=(88, 80), timeout=60, progress=lambda message: emit('gpu', message=message)):
            with (out / 'server.log').open('w') as log:
                child = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT)
                # Prefer this disposable test process if the system reaches OOM.
                try:
                    Path(f'/proc/{child.pid}/oom_score_adj').write_text('500')
                except OSError:
                    pass
                watcher = threading.Thread(target=monitor, daemon=True)
                watcher.start()
                try:
                    boot = time.monotonic()
                    while True:
                        if child.poll() is not None:
                            raise RuntimeError(f'Server exited during load: {child.returncode}')
                        if time.monotonic()-boot > 900:
                            raise TimeoutError('Model load exceeded 900 seconds')
                        try:
                            if request('/health', timeout=2).get('status') == 'ok':
                                break
                        except OSError:
                            pass
                        time.sleep(1)
                    report['loadSeconds'] = time.monotonic()-boot
                    emit('ready', loadSeconds=round(report['loadSeconds'], 2))
                    if not args.only_long:
                        ja = chat(out, 'japanese', [{'role':'user', 'content':'これは疎通試験です。「日本語の応答を確認しました。」の一文だけ返してください。'}])
                        report['checks']['japanese'] = {'passed': ja['completed'] and ja['content'].strip() == '日本語の応答を確認しました。', 'response': ja}
                        code = chat(out, 'code', [{'role':'user', 'content':'Python関数 clamp(value, lower, upper) を書いてください。lower > upper なら ValueError、そうでなければ value を閉区間[lower, upper]に収めて返す。整数と小数に対応。型注釈、import、テスト、説明は不要。関数1個だけをコードブロックで返してください。'}], max_tokens=1024)
                        try:
                            checked = check_code(code['content'])
                        except Exception as error:
                            checked = {'passed': False, 'reason': str(error)}
                        report['checks']['code'] = {**checked, 'passed': code['completed'] and checked['passed'], 'response': code}
                        tool_spec = [{'type':'function','function':{'name':'report_test_value','description':'Record a synthetic validation value.','parameters':{'type':'object','properties':{'value':{'type':'string'}},'required':['value'],'additionalProperties':False}}}]
                        tool = chat(out, 'tool', [{'role':'user','content':'report_test_valueを呼び出してvalueに「Mang-AI-検証-42」を指定してください。'}], tools=tool_spec, tool_choice='required', parallel_tool_calls=False)
                        calls = tool['tool_calls']
                        valid = tool['completed'] and tool['finishReason'] == 'tool_calls' and len(calls) == 1
                        if valid:
                            valid = calls[0]['function']['name'] == 'report_test_value' and json.loads(calls[0]['function']['arguments']) == {'value':'Mang-AI-検証-42'}
                        report['checks']['tool'] = {'passed': valid, 'response': tool}
                    if args.long_target:
                        report['checks']['long'] = long_test(out, args.long_target)
                    if failure:
                        raise RuntimeError('; '.join(failure))
                    report['inferencePassed'] = all(item['passed'] for item in report['checks'].values())
                finally:
                    stop_child()
                    if child.poll() is None:
                        try:
                            child.wait(15)
                        except subprocess.TimeoutExpired:
                            child.kill()
                            child.wait(10)
                    finished.set()
                    watcher.join(5)
    except Exception as error:
        report['error'] = str(error)
        emit('failed', error=str(error))
    finally:
        finished.set()
        report['a1After'] = a1_status()
        report['a1PidUnchanged'] = report['a1Before']['pid'] not in (None, '0', '') and report['a1Before']['pid'] == report['a1After']['pid']
        report['resourceFailures'] = failure
        report['samplesCount'] = len(samples)
        if samples:
            report['resources'] = {'minimumRamAvailableGiB': min(x['ramAvailableGiB'] for x in samples), 'minimumVramFreeGiB': min(x['vramFreeGiB'] for x in samples), 'peakProcessRssGiB': max(x['processRssGiB'] for x in samples)}
        report['afterMemory'] = memory()
        report['passed'] = report['inferencePassed'] and report['a1After']['healthy'] and report['a1PidUnchanged'] and not failure and 'error' not in report
        save(out / 'resources.json', samples)
        save(out / 'report.json', report)
        emit('complete', passed=report['passed'], report=str(out/'report.json'), resources=report.get('resources'), checks={k:v['passed'] for k,v in report['checks'].items()})
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
