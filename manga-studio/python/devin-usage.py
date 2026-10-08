"""Read only Devin CLI quota, using its observed Connect/protobuf wire format.

Verified with Devin CLI 3000.10.48 (2026-10-09). Unknown billing/fields fail
closed to unavailable. No response containing identity/credentials is printed.
"""
import json, pathlib, sys, time, tomllib, urllib.request, urllib.error

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

def read_usage(path):
    credentials = tomllib.loads(pathlib.Path(path).read_text())
    if credentials.get('api_server_url', 'https://server.codeium.com').rstrip('/') != 'https://server.codeium.com':
        raise ValueError('Unsupported server')
    key = credentials.get('windsurf_api_key')
    if not isinstance(key, str) or not key:
        raise ValueError('Missing credential')
    metadata = b''.join(field(n, value) for n, value in [(1, 'Mang-AI'), (2, '0.1.0'), (3, key), (4, 'ja'), (5, 'linux'), (7, '0.1.0'), (12, 'Mang-AI')])
    request = urllib.request.Request(ENDPOINT, data=field(1, metadata), headers={
        'Content-Type': 'application/proto', 'Connect-Protocol-Version': '1'}, method='POST')
    with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
        data = response.read(1048577)
        if len(data) > 1048576:
            raise ValueError('Response too large')
    return parse_quota(data)

if __name__ == '__main__':
    try:
        print(json.dumps(read_usage(sys.argv[1]), ensure_ascii=False))
    except urllib.error.HTTPError as error:
        print(json.dumps({'error': 'Devinの利用枠を取得できませんでした', 'status': error.code}))
        sys.exit(1)
    except Exception:
        print(json.dumps({'error': 'Devinの利用枠を取得できませんでした'}))
        sys.exit(1)
