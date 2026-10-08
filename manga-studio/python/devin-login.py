"""Bridge the official interactive PKCE login; never log the pasted code/token."""
import fcntl, json, os, pty, re, select, signal, subprocess, sys, termios, time

master, slave = pty.openpty()
def controlling_terminal():
    os.setsid()
    fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
child = subprocess.Popen([sys.argv[1], 'auth', 'login', '--force-manual-token-flow'],
                         stdin=slave, stdout=slave, stderr=slave, preexec_fn=controlling_terminal)
os.close(slave)
def stop(*_):
    if child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)
signal.signal(signal.SIGTERM, lambda *_: (stop(), sys.exit(0)))
buffer = ''
sent = False
deadline = time.monotonic() + 600
try:
    while child.poll() is None and time.monotonic() < deadline:
        ready, _, _ = select.select([master, sys.stdin], [], [], .2)
        if master in ready:
            try:
                chunk = os.read(master, 8192)
            except OSError:
                break
            buffer = (buffer + chunk.decode('utf8', 'replace'))[-16384:]
            match = re.search(r'https://app\.devin\.ai/auth/cli/continue\?[^\s\x1b]+', buffer)
            if match and not sent:
                print(json.dumps({'url': match.group(0)}), flush=True)
                sent = True
        if sys.stdin in ready:
            line = sys.stdin.readline()
            if not line:
                break
            try:
                code = json.loads(line)['code'].strip()
                if not code or len(code) > 16384 or '\n' in code or '\r' in code:
                    raise ValueError()
                os.write(master, (code + '\r').encode())
            except (ValueError, KeyError, TypeError):
                break
    if child.poll() is None:
        # Allow the last exchange to exit after the PTY closes.
        try:
            child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            stop()
    result = child.wait(timeout=3)
    print(json.dumps({'exit': result}), flush=True)
    sys.exit(0 if result == 0 else 1)
finally:
    stop()
    os.close(master)
