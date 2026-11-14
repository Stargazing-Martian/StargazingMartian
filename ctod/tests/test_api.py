import asyncio
import importlib
import json
import unittest
from unittest.mock import patch
import test_mars


class ApiTests(unittest.TestCase):
    setUpClass = classmethod(test_mars.MarsTests.setUpClass.__func__)
    tearDownClass = classmethod(test_mars.MarsTests.tearDownClass.__func__)
    setUp = test_mars.MarsTests.setUp
    tearDown = test_mars.MarsTests.tearDown
    # Use fixture only; inherited core cases are tested by MarsTests already.
    async def request(self, path, accept=b'application/vnd.quantized-mesh;extensions=octvertexnormals'):
        messages = []
        async def send(message): messages.append(message)
        async def receive(): return {'type': 'http.request', 'body': b''}
        scope = {'type': 'http', 'method': 'GET', 'path': path, 'query_string': b'',
                 'headers': [(b'origin', b'http://localhost:5000'), (b'accept', accept)],
                 'http_version': '1.1', 'scheme': 'http',
                 'server': ('localhost', 5001), 'client': ('127.0.0.1', 0)}
        await asyncio.wait_for(self.api.app(scope, receive, send), timeout=5)
        return messages

    def test_api_responses(self):
        with patch('sys.argv', ['ctod']):
            self.api = importlib.import_module('ctod.server.fastapi')
        original = self.api.globals.copy()
        self.api.globals.update({'dataset_config': type('Config', (), {'get_dataset': lambda _, name: self.qp if name == 'mars' else None})(),
                                 'mars_terrain': {'mars': self.terrain}, 'terrain_factory': None,
                                 'cog_reader_pool': None, 'tile_cache_path': None})
        async def run():
            messages = await self.request('/tiles/mars/layer.json')
            self.assertEqual(messages[0]['status'], 200)
            self.assertIn((b'access-control-allow-origin', b'http://localhost:5000'), messages[0]['headers'])
            metadata = json.loads(messages[1]['body'])
            self.assertEqual(metadata['body'], 'mars')
            self.assertEqual((await self.request('/tiles/mars/2/1/1.terrain'))[0]['status'], 200)
            self.assertEqual((await self.request('/tiles/mars/9/0/0.terrain'))[0]['status'], 404)
            self.assertEqual((await self.request('/tiles/missing/layer.json'))[0]['status'], 404)
            with patch.object(self.terrain, 'tile', side_effect=RuntimeError('bad raster')):
                with self.assertLogs(level='ERROR'):
                    self.assertEqual((await self.request('/tiles/mars/2/1/1.terrain'))[0]['status'], 503)
            with patch.object(self.terrain, 'get_tile', side_effect=asyncio.TimeoutError):
                self.assertEqual((await self.request('/tiles/mars/2/1/1.terrain'))[0]['status'], 504)
        try:
            asyncio.run(run())
        finally:
            self.api.globals.clear(); self.api.globals.update(original)
