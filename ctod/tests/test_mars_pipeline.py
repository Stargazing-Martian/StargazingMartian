"""Regression coverage for block reads, dense meshes, cache and shared requests."""
import asyncio
import gzip
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import rasterio
from rasterio.transform import from_bounds

from ctod.core.terrain.mars import MarsTerrain, MARS_RADIUS
from ctod.server.queries import QueryParameters
from ctod.server.startup import patch_occlusion


class PipelineTests(unittest.TestCase):
    def setUp(self):
        patch_occlusion()
        self.directory = tempfile.TemporaryDirectory()
        self.path = str(Path(self.directory.name) / 'mars.tif')
        self.data = (1000 + np.arange(360)[:, None] * 10 + np.arange(720)[None, :]).astype('float32')
        with rasterio.open(self.path, 'w', driver='GTiff', width=720, height=360,
                           count=1, dtype='float32', nodata=-9999,
                           transform=from_bounds(-180, -90, 180, 90, 720, 360),
                           crs=f'+proj=longlat +R={MARS_RADIUS}', tiled=True,
                           blockxsize=128, blockysize=128) as dst:
            dst.write(self.data, 1)
        self.qp = QueryParameters(cog=self.path, body='mars', minZoom=0, maxZoom=9,
                                  defaultGridSize=128, resamplingMethod='bilinear', zoomGridSizes='{}')
        self.terrain = MarsTerrain(self.qp)

    def tearDown(self):
        self.terrain.close()
        self.directory.cleanup()

    def test_bilinear_geographic_heights_and_wrap(self):
        rows, cols = np.array([50.2, 180.75]), np.array([200.3, 401.5])
        lon, lat = -180 + (cols + .5) * .5, 90 - (rows + .5) * .5
        np.testing.assert_allclose(self.terrain.sample(lon, lat, 9), 1000 + rows * 10 + cols)
        np.testing.assert_array_equal(self.terrain.sample([-180, 180, 540], [10]*3, 9),
                                      np.repeat(self.terrain.sample(-180, 10, 9), 3))
        for left, right in [((3, 7, 3), (3, 8, 3)), ((3, 15, 3), (3, 0, 3))]:
            a, _, an = self.terrain.mesh(*left)
            b, _, bn = self.terrain.mesh(*right)
            ia, ib = a[:, 0] == a[:, 0].max(), b[:, 0] == b[:, 0].min()
            np.testing.assert_allclose(a[ia, 2], b[ib, 2])
            np.testing.assert_allclose(an[ia], bn[ib], atol=1e-12)

    def test_root_density_and_single_halo_sample(self):
        with patch.object(self.terrain.raster, 'sample', wraps=self.terrain.raster.sample) as sampler:
            vertices, triangles, normals = self.terrain.mesh(0, 0, 0)
        self.assertEqual(sampler.call_count, 1)
        self.assertEqual(len(vertices), 129**2)
        self.assertEqual(len(triangles), 2 * 128**2)
        np.testing.assert_allclose(np.linalg.norm(normals, axis=1), 1, atol=1e-12)
        self.assertLessEqual(triangles.max(), len(vertices)-1)

    def test_missing_data_never_becomes_a_mesh_spike(self):
        self.terrain.close()
        with rasterio.open(self.path, 'r+') as dst:
            data = self.data.copy()
            data[50:52, 100:102] = -9999
            dst.write(data, 1)
        self.terrain = MarsTerrain(self.qp)
        with self.assertRaisesRegex(RuntimeError, 'missing elevations'):
            self.terrain.sample(-180 + 101 * .5, 90 - 51 * .5, 9)

    def test_disk_cache_survives_restart_and_changes_identity(self):
        with tempfile.TemporaryDirectory() as cache:
            first = MarsTerrain(self.qp, cache)
            try:
                expected, version = first.tile(3, 4, 3), first.version
            finally:
                first.close()
            second = MarsTerrain(self.qp, cache)
            try:
                self.assertEqual(second.version, version)
                with patch.object(second, 'mesh', side_effect=AssertionError('cache miss')):
                    self.assertEqual(second.tile(3, 4, 3), expected)
                self.assertTrue(gzip.decompress(expected))
            finally:
                second.close()
            different = QueryParameters(cog=self.path, body='mars', defaultGridSize=64,
                                         resamplingMethod='nearest')
            third = MarsTerrain(different, cache)
            try:
                self.assertNotEqual(third.version, version)
            finally:
                third.close()

    def test_voids_use_valid_overviews_instead_of_spikes(self):
        self.terrain.close()
        with rasterio.open(self.path, 'r+') as dst:
            data = self.data.copy()
            data[50:52, 100:102] = -9999
            dst.write(data, 1)
            dst.build_overviews([2, 4], rasterio.enums.Resampling.average)
        self.terrain = MarsTerrain(self.qp)
        height = self.terrain.sample(-180 + 101 * .5, 90 - 51 * .5, 9)
        self.assertTrue(np.isfinite(height))
        self.assertGreater(height, 1500)
        self.assertLess(height, 1700)

    def test_duplicate_requests_share_work_and_timeout_keeps_worker(self):
        started, release = threading.Event(), threading.Event()
        def work(*args):
            started.set()
            release.wait(2)
            return b'terrain'
        async def run():
            with patch.object(self.terrain, 'tile', side_effect=work) as tile:
                first = asyncio.create_task(self.terrain.get_tile(3, 4, 3, timeout=.02))
                for _ in range(100):
                    if started.is_set():
                        break
                    await asyncio.sleep(.001)
                self.assertTrue(started.is_set())
                second = asyncio.create_task(self.terrain.get_tile(3, 4, 3))
                with self.assertRaises(asyncio.TimeoutError):
                    await first
                self.assertEqual(self.terrain.slots._value, 3)
                release.set()
                self.assertEqual(await second, b'terrain')
                self.assertEqual(tile.call_count, 1)
                await asyncio.sleep(0)
                self.assertEqual(self.terrain.slots._value, 4)
                self.assertFalse(self.terrain.pending)
        try:
            asyncio.run(run())
        finally:
            release.set()

    def test_block_cache_is_bounded(self):
        self.terrain.raster.block_cache_bytes = 128 * 128 * 4 * 2
        lon, lat = np.meshgrid(np.linspace(-100, 100, 64), np.linspace(-60, 60, 64))
        heights = self.terrain.sample(lon, lat, 9)
        self.assertTrue(np.isfinite(heights).all())
        self.assertLessEqual(self.terrain.raster.block_bytes, self.terrain.raster.block_cache_bytes)


if __name__ == '__main__':
    unittest.main()
