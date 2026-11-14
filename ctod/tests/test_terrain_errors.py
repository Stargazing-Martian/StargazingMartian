import asyncio
import tempfile
import unittest
from unittest.mock import AsyncMock, Mock, patch

from ctod.core.cog.cog_reader_pool import CogReaderPool
from ctod.core.factory.terrain_factory import TerrainFactory
from ctod.core.terrain.terrain_request import TerrainRequest
from ctod.core.cog.processor.cog_processor_quantized_mesh_grid import CogProcessorQuantizedMeshGrid
from ctod.core.utils import get_tms
from ctod.server.queries import QueryParameters


class TerrainErrorTests(unittest.IsolatedAsyncioTestCase):
    async def test_cog_failure_reaches_waiter_and_clears_open_key(self):
        with tempfile.TemporaryDirectory() as directory:
            factory = TerrainFactory(directory, 'test.db')
            request = Mock(wanted_file_keys=['broken'])
            factory.terrain_requests['request'] = request
            factory.open_requests.add('broken')
            cog = Mock(key='broken', download_tile_async=AsyncMock(side_effect=RuntimeError('bad CRS')))
            with self.assertLogs(level='ERROR'):
                await factory._process_cog_request(cog)
            request.set_exception.assert_called_once()
            self.assertNotIn('broken', factory.open_requests)
            factory.executor.shutdown()

    async def test_generator_exception_finishes_future(self):
        request = TerrainRequest(get_tms(), 'test.tif', 2, 1, 1, 0, None,
                                 CogProcessorQuantizedMeshGrid(QueryParameters()),
                                 Mock(generate=Mock(side_effect=ValueError('bad mesh'))), None)
        self.assertEqual(request.no_data, 0)
        await request.process()
        with self.assertRaisesRegex(ValueError, 'bad mesh'):
            await request.wait()
        self.assertFalse(request.processing)

    async def test_pool_reuses_and_caps_idle_readers(self):
        pool = CogReaderPool(max_readers=1)
        reader = Mock(cog='test.tif')
        pool.return_reader(reader)
        self.assertIs(await pool.get_reader('test.tif', get_tms()), reader)
        pool.return_reader(reader)
        extra = Mock(cog='test.tif')
        pool.return_reader(extra)
        extra.close.assert_called_once()

    async def test_processed_cache_keys_separate_options(self):
        from ctod.core.cog.cog_request import CogRequest
        def request(size, normals):
            processor = CogProcessorQuantizedMeshGrid(QueryParameters(defaultGridSize=size))
            return CogRequest(get_tms(), 'test.tif', 3, 2, 1, processor, None, 0, None, normals)
        self.assertNotEqual(request(10, True).key, request(20, True).key)
        self.assertNotEqual(request(10, True).key, request(10, False).key)
