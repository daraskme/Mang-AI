"""Real HTTP/subprocess lifecycle, simulated model and free memory. No GPU."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import http.client
import json
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

STUDIO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(STUDIO / "python"))
import model_broker
from mangai_gpu import GpuLease, database


class SimulatedModel(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{}')

    def do_POST(self):
        value = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if value.get('delay'):
            time.sleep(30)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"choices":[{"message":{"content":"saved"}}]}')

    def log_message(self, *args):
        pass


class BrokerTests(unittest.TestCase):
    def test_response_saved_before_release_and_disconnect_releases_lease(self):
        with tempfile.TemporaryDirectory(dir=STUDIO / '.test-output') as folder:
            root = Path(folder)
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                port = probe.getsockname()[1]
            server = ThreadingHTTPServer(('127.0.0.1', 0), model_broker.Handler)
            server.models = {'simulated': {'phase': 'gemma', 'port': port, 'label': 'test', 'command': [sys.executable, __file__, '--backend', str(port)]}}
            def lease(*args, **kwargs):
                return GpuLease(*args, **kwargs, measure=lambda: {'ramAvailableGiB': 100, 'vramFreeGiB': 90})
            with patch.dict('os.environ', {'MANGAI_GPU_STATE': folder}), patch.object(model_broker, 'GpuLease', lease):
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    client = http.client.HTTPConnection(*server.server_address, timeout=8)
                    client.request('POST', '/v1/chat/completions', json.dumps({'model': 'simulated'}), {'Content-Type': 'application/json'})
                    response = client.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertIn(b'saved', response.read())
                    client.close()
                    self.assertEqual(len(list((root / 'responses').glob('*.json'))), 1)
                    client = http.client.HTTPConnection(*server.server_address, timeout=8)
                    client.request('POST', '/v1/chat/completions', json.dumps({'model': 'simulated', 'delay': True}), {'Content-Type': 'application/json'})
                    time.sleep(1)
                    client.close()
                    deadline = time.monotonic() + 8
                    while time.monotonic() < deadline:
                        with database(root) as db:
                            rows = [json.loads(row[0]) for row in db.execute('SELECT body FROM requests')]
                        if len(rows) == 2 and all(r['state'] in ('completed', 'failed') for r in rows):
                            break
                        time.sleep(.1)
                    self.assertEqual(len(rows), 2)
                    self.assertTrue(all(r['state'] in ('completed', 'failed') for r in rows), rows)
                    with socket.socket() as check:
                        self.assertNotEqual(check.connect_ex(('127.0.0.1', port)), 0, 'backend must exit before releasing GPU lease')
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join(5)


if __name__ == '__main__':
    if '--backend' in sys.argv:
        ThreadingHTTPServer(('127.0.0.1', int(sys.argv[-1])), SimulatedModel).serve_forever()
    else:
        unittest.main()
