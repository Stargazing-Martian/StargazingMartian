import asyncio
import gzip
import math
import os
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import rasterio
from rasterio.transform import from_bounds
from starlette.requests import Request

from ctod.core.terrain.mars import MarsTerrain, MARS_RADIUS
from ctod.server.queries import QueryParameters
from ctod.server.startup import patch_occlusion
from ctod.server.helpers import get_extensions
from ctod.server.handlers.terrain import TerrainHandler


class MarsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        patch_occlusion()
        cls.directory = tempfile.TemporaryDirectory()
        cls.path = str(Path(cls.directory.name) / 'mars.tif')
        circumference = 2 * math.pi * MARS_RADIUS
        transform = from_bounds(0, -circumference/4, circumference, circumference/4, 720, 360)
        # A nonconstant, north/east increasing DEM catches longitude and Y flips.
        cls.data = (np.arange(360)[:, None] * 10 + np.arange(720)[None, :]).astype('float32')
        with rasterio.open(cls.path, 'w', driver='GTiff', width=720, height=360,
                           count=1, dtype='float32', nodata=-9999, transform=transform,
                           crs=f'+proj=eqc +R={MARS_RADIUS} +units=m') as dst:
            dst.write(cls.data, 1)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def setUp(self):
        self.qp = QueryParameters(cog=self.path, body='mars', minZoom=0, maxZoom=8)
        self.terrain = MarsTerrain(self.qp)

    def tearDown(self):
        self.terrain.close()

    def test_native_samples_and_wrap(self):
        lon, lat = np.array([-135, -45, 45, 135]), np.array([-30, 20, 30, -20])
        with rasterio.open(self.path) as src:
            xy = zip(np.deg2rad(lon % 360) * MARS_RADIUS, np.deg2rad(lat) * MARS_RADIUS)
            expected = np.array(list(src.sample(xy)))[:, 0]
        np.testing.assert_array_equal(self.terrain.sample(lon, lat, 8), expected)
        np.testing.assert_array_equal(self.terrain.sample([-180, 180], [10, 10], 8),
                                      self.terrain.sample([180, -180], [10, 10], 8))

    def test_mesh_seams_and_poles(self):
        for left, right in [((3, 7, 3), (3, 8, 3)), ((3, 15, 3), (3, 0, 3))]:
            a, _, an = self.terrain.mesh(*left)
            b, _, bn = self.terrain.mesh(*right)
            ia, ib = a[:, 0] == a[:, 0].max(), b[:, 0] == b[:, 0].min()
            np.testing.assert_allclose(a[ia, 2], b[ib, 2])
            np.testing.assert_allclose(an[ia], bn[ib], atol=1e-12)
        a, _, an = self.terrain.mesh(3, 4, 3)
        b, _, bn = self.terrain.mesh(3, 4, 4)
        ia, ib = a[:, 1] == a[:, 1].max(), b[:, 1] == b[:, 1].min()
        np.testing.assert_allclose(a[ia, 2], b[ib, 2])
        np.testing.assert_allclose(an[ia], bn[ib], atol=1e-12)
        for y, latitude in [(0, -90), (7, 90)]:
            v, _, n = self.terrain.mesh(3, 3, y)
            pole = v[:, 1] == latitude
            self.assertEqual(len(np.unique(v[pole, 2])), 1)
            self.assertTrue(np.isfinite(n).all())
            np.testing.assert_allclose(np.linalg.norm(n, axis=1), 1, atol=1e-12)

    def test_encoded_header_uses_mars_and_root_has_heights(self):
        data = gzip.decompress(self.terrain.tile(8, 200, 100))
        header = struct.unpack('<3d2f4d3d', data[:88])
        self.assertTrue(3.3e6 < np.linalg.norm(header[:3]) < 3.5e6)
        self.assertTrue(np.isfinite(header).all())
        self.assertTrue(.99 < np.linalg.norm(header[-3:]) < 1.1, header[-3:])
        root = struct.unpack('<3d2f4d3d', gzip.decompress(self.terrain.tile(0, 0, 0))[:88])
        self.assertGreater(root[4], root[3])

    def test_cache_and_normal_variants(self):
        with patch.object(self.terrain, 'mesh', wraps=self.terrain.mesh) as mesh:
            a = self.terrain.tile(3, 4, 3, True)
            self.assertEqual(a, self.terrain.tile(3, 4, 3, True))
            b = self.terrain.tile(3, 4, 3, False)
            self.assertNotEqual(a, b)
            self.assertEqual(mesh.call_count, 2)
        self.assertNotEqual(self.qp.cache_identity(True), self.qp.cache_identity(False))
        other = QueryParameters(cog=self.path, defaultGridSize=55)
        self.assertNotEqual(self.qp.cache_identity(), other.cache_identity())

    def test_invalid_tile_and_model(self):
        for tile in [(-1, 0, 0), (9, 0, 0), (1, 4, 0), (1, 0, 2)]:
            with self.assertRaises(ValueError):
                self.terrain.tile(*tile)
        with rasterio.open(self.path) as src:
            with patch('ctod.core.terrain.mars_raster.CRS', return_value=__import__('pyproj').CRS('EPSG:4326')):
                with self.assertRaises(ValueError):
                    self.terrain._validate(src)

    def test_http_encoding_and_extensions(self):
        handler = TerrainHandler(None, None, None)
        request = Request({'type': 'http', 'headers': []})
        self.assertFalse(get_extensions(None, request)['octvertexnormals'])
        data = self.terrain.tile(3, 4, 3)
        response = handler._create_response(request, data)
        self.assertEqual(response.body, gzip.decompress(data))
        request = Request({'type': 'http', 'headers': [(b'accept-encoding', b'gzip'),
                          (b'accept', b'application/vnd.quantized-mesh;extensions=octvertexnormals-watermask')]})
        self.assertTrue(get_extensions(None, request)['octvertexnormals'])
        self.assertEqual(handler._create_response(request, data).headers['content-encoding'], 'gzip')

    def test_async_failure_and_timeout_release_slots(self):
        import threading
        async def run():
            with patch.object(self.terrain, 'tile', side_effect=RuntimeError('bad raster')):
                with self.assertRaises(RuntimeError):
                    await self.terrain.get_tile(1, 0, 0)
            ready = threading.Event()
            with patch.object(self.terrain, 'tile', side_effect=lambda *args: ready.wait(1)):
                with self.assertRaises(asyncio.TimeoutError):
                    await self.terrain.get_tile(1, 0, 0, timeout=.01)
                ready.set()
                await asyncio.sleep(.05)
            self.assertEqual(self.terrain.slots._value, 4)
            self.assertTrue(await self.terrain.get_tile(1, 0, 0))
        asyncio.run(run())


if __name__ == '__main__':
    unittest.main()
