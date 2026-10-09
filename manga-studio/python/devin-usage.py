"""Read only Devin CLI quota, using its observed Connect/protobuf wire format.

Verified with Devin CLI 3000.10.48 (2026-10-09). Unknown billing/fields fail
closed to unavailable. No response containing identity/credentials is printed.
"""
import http.server, json, os, pathlib, re, signal, subprocess, sys, tempfile, threading, time, tomllib, urllib.request, urllib.error

ENDPOINT = 'https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus'

def varint(n):
    out = bytearray()
    while n > 127:
        out.append((n & 127) | 128)
        n >>= 7
    out.append(n)
    return bytes(out)

def field(n, value):
    value = value.encode() if isinstance(value, str) else value
    return varint(n * 8 + 2) + varint(len(value)) + value

def fields(data):
    result, position = {}, 0
    def read():
        nonlocal position
        value = shift = 0
        while position < len(data) and shift < 70:
            byte = data[position]
            position += 1
            value |= (byte & 127) << shift
            if not byte & 128:
                return value
            shift += 7
        raise ValueError('Invalid protobuf')
    while position < len(data):
        tag = read()
        number, wire = tag >> 3, tag & 7
        if number < 1:
            raise ValueError('Invalid field')
        if wire == 0:
            value = read()
        elif wire in (1, 2, 5):
            length = read() if wire == 2 else 8 if wire == 1 else 4
            value = data[position:position + length]
            position += length
            if len(value) != length:
                raise ValueError('Truncated field')
        else:
            raise ValueError('Unsupported wire')
        result[number] = value
    return result

def parse_quota(payload, now=None):
    root = fields(payload)
    user, info = fields(root.get(1, b'')), fields(root.get(2, b''))
    plan = fields(user.get(13, b''))
    name = info.get(2, b'').decode('utf8', 'replace')[:80]
    quota = {'updatedAt': now if now is not None else int(time.time() * 1000), 'windows': []}
    # PlanInfo.billing_strategy = QUOTA(2); hide_daily_quota is field 36.
    if info.get(35) != 2:
        quota['unavailable'] = True
        return {'plan': name, 'quota': quota}
    for kind, percent_field, reset_field, minutes, label in [('daily', 14, 17, 1440, '日次'), ('weekly', 15, 18, 10080, '週次')]:
        if kind == 'daily' and info.get(36, 0):
            continue
        reset = plan.get(reset_field)
        if not isinstance(reset, int) or reset <= 0:
            reset = None
        # Proto3 omits a zero scalar. Infer zero only with a valid reset field.
        remaining = plan.get(percent_field, 0 if reset else None)
        if not isinstance(remaining, int) or not 0 <= remaining <= 100:
            remaining = None
        quota['windows'].append({'id': kind, 'label': label, 'minutes': minutes,
                                 'remainingPercent': remaining, 'resetsAt': reset})
    return {'plan': name, 'quota': quota}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def read_usage(path, cli=None):
    if cli is None:
        installed = pathlib.Path.home()/'.local/bin/devin'
        cli = str(installed) if installed.exists() else 'devin'
    path = pathlib.Path(path).resolve()
    original = path.read_text()
    credentials = tomllib.loads(original)
    if credentials.get('api_server_url', 'https://server.codeium.com').rstrip('/') != 'https://server.codeium.com':
        raise ValueError('Unsupported server')
    key = credentials.get('windsurf_api_key')
    if not isinstance(key, str) or not key:
        raise ValueError('Missing credential')
    # The CLI adds a short-lived identity proof (metadata field 31 and an
    # Authorization header). Sending only the stored API key makes individual
    # accounts look like multi-user clients. Let the official CLI produce and
    # refresh that proof; do not reverse-engineer or persist it ourselves.
    results = []
    opener = urllib.request.build_opener(NoRedirect)
    class QuotaOnly(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def do_POST(self):
            self.connection.settimeout(15)
            if self.path != '/exa.seat_management_pb.SeatManagementService/GetUserStatus':
                self.send_error(404)
                return
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 1048576:
                    raise ValueError('Invalid request size')
                body = self.rfile.read(size)
                headers = {k: v for k, v in self.headers.items()
                           if k.lower() in {'authorization', 'content-type', 'connect-protocol-version', 'accept'}}
                request = urllib.request.Request(ENDPOINT, data=body, headers=headers, method='POST')
                try:
                    with opener.open(request, timeout=12) as response:
                        status, payload = response.status, response.read(1048577)
                except urllib.error.HTTPError as error:
                    status, payload = error.code, error.read(1048577)
                if len(payload) > 1048576:
                    raise ValueError('Response too large')
                results.append((status, payload))
                self.send_response(status)
                self.send_header('Content-Type', 'application/proto' if status == 200 else 'application/json')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except Exception:
                # No request/response/credential contents in stderr.
                try:
                    self.send_error(502)
                except OSError:
                    pass
    server = http.server.HTTPServer(('127.0.0.1', 0), QuotaOnly)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        # A private disposable profile prevents changing the account's CLI
        # server setting or competing with its active coding sessions.
        with tempfile.TemporaryDirectory(prefix='.quota-', dir=path.parent) as scratch:
            scratch = pathlib.Path(scratch)
            target = scratch/'data/devin/credentials.toml'
            target.parent.mkdir(parents=True, mode=0o700)
            line = f'api_server_url = "http://127.0.0.1:{server.server_port}"'
            if re.search(r'^api_server_url\s*=', original, re.M):
                private = re.sub(r'^api_server_url\s*=.*$', line, original, flags=re.M)
            else:
                private = original+'\n'+line+'\n'
            with open(target, 'w', opener=lambda p, f: os.open(p, f, 0o600)) as file:
                file.write(private)
            env = {k: v for k, v in os.environ.items()
                   if not k.startswith(('CODEX_', 'OPENAI_', 'DEVIN_', 'WINDSURF_', 'COGNITION_', 'ANTHROPIC_'))}
            env.update(XDG_DATA_HOME=str(scratch/'data'), XDG_CONFIG_HOME=str(scratch/'config'), XDG_CACHE_HOME=str(scratch/'cache'))
            child = subprocess.Popen([cli, 'auth', 'status'], cwd=scratch, env=env,
                                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                child.wait(timeout=35)
            finally:
                if child.poll() is None:
                    child.terminate()
                    try:
                        child.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait()
    finally:
        server.shutdown()
        server.server_close()
    success = [payload for status, payload in results if status == 200]
    if success:
        return parse_quota(success[-1])
    if results:
        raise urllib.error.HTTPError(ENDPOINT, results[-1][0], 'Quota unavailable', None, None)
    raise ValueError('Native CLI did not return quota')

if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    try:
        print(json.dumps(read_usage(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None), ensure_ascii=False))
    except urllib.error.HTTPError as error:
        print(json.dumps({'error': 'Devinの利用枠を取得できませんでした', 'status': error.code}))
        sys.exit(1)
    except Exception:
        print(json.dumps({'error': 'Devinの利用枠を取得できませんでした'}))
        sys.exit(1)
