"""Real HTTP/subprocess lifecycle, simulated model and free memory. No GPU."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from contextlib import contextmanager
import http.client
import json
import os
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
        if 'MANGAI_GPU_LEASE_FD' in os.environ:
            inherited = os.fstat(int(os.environ['MANGAI_GPU_LEASE_FD']))
            expected = (Path(os.environ['MANGAI_GPU_STATE']) / 'heavy.lock').stat()
            if (inherited.st_dev, inherited.st_ino) != (expected.st_dev, expected.st_ino):
                self.send_error(500)
                return
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{}')

    def do_POST(self):
        value = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if value.get('delay'):
            time.sleep(30)
        self.send_response(200)
        self.end_headers()
        if value.get('stream_delay'):
            self.wfile.write(b'data: {"first":true}\n\n')
            self.wfile.flush()
            time.sleep(30)
        self.wfile.write(json.dumps({'choices': [{'message': {'content': 'saved'}}], 'pid': os.getpid()}).encode())

    def log_message(self, *args):
        pass


class BrokerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (STUDIO / '.test-output').mkdir(exist_ok=True)

    def test_response_saved_before_release_and_disconnect_releases_lease(self):
        with tempfile.TemporaryDirectory(dir=STUDIO / '.test-output') as folder:
            root = Path(folder)
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                port = probe.getsockname()[1]
            models = {'simulated': {'phase': 'gemma', 'port': port, 'label': 'test', 'command': [sys.executable, __file__, '--backend', str(port)]}}
            server = model_broker.BrokerServer(('127.0.0.1', 0), models, root=root, poll_seconds=.05)
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

    @contextmanager
    def broker(self, keep=10):
        with tempfile.TemporaryDirectory(dir=STUDIO / '.test-output') as folder:
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                port = probe.getsockname()[1]
            models = {'simulated': {'phase': 'coder', 'port': port, 'label': 'test',
                'keepAliveSeconds': keep, 'startupTimeout': 2,
                'command': [sys.executable, __file__, '--backend', str(port)]}}
            def lease(*args, **kwargs):
                return GpuLease(*args, **kwargs, measure=lambda: {'ramAvailableGiB': 100, 'vramFreeGiB': 90})
            with patch.object(model_broker, 'GpuLease', lease):
                server = model_broker.BrokerServer(('127.0.0.1', 0), models, root=folder, poll_seconds=.05)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    yield server, Path(folder)
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join(5)

    def post(self, server, value=None, path='/v1/chat/completions', session='coding'):
        client = http.client.HTTPConnection(*server.server_address, timeout=8)
        client.request('POST', path, json.dumps({'model': 'simulated', **(value or {})}),
                       {'Content-Type': 'application/json', 'X-MangAI-Session': session})
        response = client.getresponse()
        result = response.status, json.loads(response.read())
        client.close()
        return result

    def wait_stopped(self, server):
        deadline = time.monotonic() + 5
        while server.manager.state()['state'] != 'stopped' and time.monotonic() < deadline:
            time.sleep(.05)
        self.assertEqual(server.manager.state()['state'], 'stopped')

    def test_tool_round_trips_reuse_process_and_persist_responses(self):
        with self.broker() as (server, root):
            status, first = self.post(server, {'messages': [{'role': 'user', 'content': 'code'}]})
            self.assertEqual(status, 200)
            status, second = self.post(server, {'messages': [{'role': 'tool', 'content': 'tests failed'}]})
            self.assertEqual(status, 200)
            self.assertEqual(first['pid'], second['pid'])
            self.assertEqual(server.manager.state()['state'], 'ready')
            records = [json.loads(p.read_text()) for p in (root / 'responses').glob('*.json')]
            self.assertEqual(len(records), 2)
            self.assertEqual({r['backendPid'] for r in records}, {first['pid']})
            self.assertEqual({r['sessionId'] for r in records}, {'coding'})
            status, result = self.post(server, path='/v1/models/unload', session='someone-else')
            self.assertEqual(status, 409)
            status, result = self.post(server, path='/v1/models/unload')
            self.assertEqual(status, 200)
            self.assertTrue(result['unloaded'])
            self.wait_stopped(server)

    def test_idle_timeout_unloads_backend(self):
        with self.broker(keep=.15) as (server, root):
            self.assertEqual(self.post(server)[0], 200)
            self.wait_stopped(server)
            with database(root) as db:
                states = [json.loads(row[0])['state'] for row in db.execute('SELECT body FROM requests')]
            self.assertEqual(states, ['completed'])

    def test_waiting_image_job_releases_warm_coder(self):
        with self.broker() as (server, root):
            self.post(server)
            with GpuLease('krea', 'image', root=root, timeout=5,
                          measure=lambda: {'ramAvailableGiB': 100, 'vramFreeGiB': 90}):
                self.wait_stopped(server)
                with socket.socket() as probe:
                    self.assertNotEqual(probe.connect_ex(('127.0.0.1', server.models['simulated']['port'])), 0)

    def test_backend_crash_is_reaped_and_next_call_restarts(self):
        with self.broker() as (server, root):
            _, first = self.post(server)
            server.manager.active['child'].kill()
            self.wait_stopped(server)
            status, second = self.post(server)
            self.assertEqual(status, 200)
            self.assertNotEqual(first['pid'], second['pid'])

    def test_failed_start_releases_lease_and_allows_retry(self):
        with self.broker() as (server, root):
            command = server.models['simulated']['command']
            server.models['simulated']['command'] = [sys.executable, '-c', 'raise SystemExit(3)']
            self.assertEqual(self.post(server)[0], 503)
            self.wait_stopped(server)
            server.models['simulated']['command'] = command
            self.assertEqual(self.post(server)[0], 200)

    def test_stream_disconnect_stops_owned_model(self):
        with self.broker() as (server, root):
            client = http.client.HTTPConnection(*server.server_address, timeout=5)
            client.request('POST', '/v1/chat/completions', json.dumps({'model': 'simulated', 'stream_delay': True}))
            response = client.getresponse()
            self.assertEqual(response.status, 200)
            self.assertTrue(response.read1(100))
            response.close()
            client.close()
            self.wait_stopped(server)
            self.assertFalse(list((root / 'responses').glob('*.json')))

    def test_busy_unload_rejected_and_shutdown_interrupts_request(self):
        with self.broker() as (server, root):
            client = http.client.HTTPConnection(*server.server_address, timeout=5)
            client.request('POST', '/v1/chat/completions', json.dumps({'model': 'simulated', 'stream_delay': True}))
            response = client.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(self.post(server, path='/v1/models/unload')[0], 409)
            server.manager.close()
            self.wait_stopped(server)
            response.close()
            client.close()

    def test_resident_request_does_not_stop_warm_worker(self):
        with self.broker() as (server, root):
            _, first = self.post(server)
            # A resident service uses no heavy lease; use a distinct simulated API.
            resident = ThreadingHTTPServer(('127.0.0.1', 0), SimulatedModel)
            thread = threading.Thread(target=resident.serve_forever, daemon=True)
            thread.start()
            server.models['resident'] = {'resident': True, 'port': resident.server_address[1]}
            try:
                self.assertEqual(self.post(server, {'model': 'resident'})[0], 200)
                self.assertEqual(server.manager.active['child'].pid, first['pid'])
            finally:
                resident.shutdown()
                resident.server_close()
                thread.join(3)

    def test_external_launcher_inherits_the_same_gpu_lease(self):
        with self.broker() as (server, root):
            server.models['simulated']['externalLease'] = True
            self.assertEqual(self.post(server)[0], 200)
            with database(root) as db:
                active = [json.loads(row[0]) for row in db.execute('SELECT body FROM requests')]
            self.assertEqual(len(active), 1)
            self.assertEqual(active[0]['state'], 'running')

    def test_cancel_queued_request_does_not_cancel_active_generation(self):
        with self.broker() as (server, root):
            first = http.client.HTTPConnection(*server.server_address, timeout=5)
            first.request('POST', '/v1/chat/completions', json.dumps({'model': 'simulated', 'stream_delay': True}))
            response = first.getresponse()
            self.assertTrue(response.read1(100))
            pid = server.manager.active['child'].pid
            second = http.client.HTTPConnection(*server.server_address, timeout=5)
            second.request('POST', '/v1/chat/completions', json.dumps({'model': 'simulated'}))
            time.sleep(.2)
            second.close()
            time.sleep(.2)
            self.assertEqual(server.manager.active['child'].pid, pid)
            self.assertIsNone(server.manager.active['child'].poll())
            response.close()
            first.close()
            self.wait_stopped(server)


if __name__ == '__main__':
    if '--backend' in sys.argv:
        ThreadingHTTPServer(('127.0.0.1', int(sys.argv[-1])), SimulatedModel).serve_forever()
    else:
        unittest.main()
