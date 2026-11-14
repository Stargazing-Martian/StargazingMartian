"""Quantized terrain for global, spherical, equatorial Mars DEMs.

Read the native equirectangular raster directly: never relabel Mars as EPSG:4326.
The wire protocol still uses Cesium's geographic 2x1 tile layout, in degrees.
Heights are preserved as supplied; no areoid-to-ellipsoid correction is implied.
"""
import asyncio
import gzip
import json
import math
import os
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import rasterio
from pyproj import CRS
from quantized_mesh_encoder.ecef import to_ecef
from quantized_mesh_encoder.ellipsoid import Ellipsoid

from ctod.core.terrain.quantize import quantize

MARS_RADIUS = 3396190.0
MARS = Ellipsoid(a=MARS_RADIUS, b=MARS_RADIUS)


class MarsTerrain:
    def __init__(self, qp):
        if qp.get_meshing_method() != 'grid':
            raise ValueError('Mars terrain currently supports grid meshing only')
        if qp.get_resampling_method() not in (None, 'nearest'):
            raise ValueError('Mars terrain currently supports nearest sampling only')
        self.qp = qp
        self.path = qp.get_cog()
        self.max_zoom = qp.get_max_zoom()
        self.sizes = json.loads(qp.get_zoom_grid_sizes() or '{}')
        if not 0 <= self.max_zoom <= 24:
            raise ValueError('Mars maxZoom must be between 0 and 24')
        self.readers = {}
        self.cache = OrderedDict()
        self.lock = threading.Lock()
        self.executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix='mars')
        self.slots = asyncio.Semaphore(4)
        self.closed = False
        self._signature = self._source_signature()
        with rasterio.open(self.path) as src:
            self._validate(src)
            self.overviews = [1] + src.overviews(1)
            self.width = src.width
            self.pixel_size = src.transform.a
            self.west = src.bounds.left / MARS_RADIUS * 180 / math.pi

    def _source_signature(self):
        stat = os.stat(self.path)
        return (stat.st_size, stat.st_mtime_ns)

    @staticmethod
    def _validate(src):
        crs = CRS(src.crs)
        operation = crs.coordinate_operation
        if (not crs.is_projected or operation is None
                or 'Equidistant Cylindrical' not in operation.method_name):
            raise ValueError('Mars DEM must use spherical equirectangular projection')
        if not np.allclose([crs.ellipsoid.semi_major_metre,
                            crs.ellipsoid.semi_minor_metre], MARS_RADIUS, rtol=0, atol=.01):
            raise ValueError('Mars DEM must use the 3396190 metre sphere')
        if any(abs(p.value) > 1e-9 for p in operation.params):
            raise ValueError('Mars DEM projection must have zero origin, offsets and standard parallel')
        if crs.axis_info[0].unit_name != 'metre':
            raise ValueError('Mars projected coordinates must be in metres')
        t = src.transform
        if t.a <= 0 or t.e >= 0 or t.b != 0 or t.d != 0 or src.count != 1:
            raise ValueError('Mars DEM must be a north-up single-band raster')
        circumference = 2 * math.pi * MARS_RADIUS
        tolerance = 2 * max(t.a, -t.e)
        if not np.allclose([src.bounds.right - src.bounds.left,
                            src.bounds.top, src.bounds.bottom],
                           [circumference, circumference / 4, -circumference / 4],
                           rtol=0, atol=tolerance):
            raise ValueError('Mars DEM must cover the full globe')
        if min(abs(src.bounds.left), abs(src.bounds.left + circumference / 2)) > tolerance:
            raise ValueError('Mars DEM longitudes must start at 0 or -180 degrees')
        if src.scales != (1.0,) or src.offsets != (0.0,):
            raise ValueError('Apply raster elevation scale/offset before serving Mars terrain')

    def layer(self):
        return {
            'tilejson': '2.1.0', 'name': 'Mars terrain', 'version': '2.0.1',
            'format': 'quantized-mesh-1.0', 'scheme': 'tms',
            'projection': 'EPSG:4326',  # Cesium wire layout, not the source CRS.
            'bounds': [-180, -90, 180, 90],
            'tiles': ['{z}/{x}/{y}.terrain?v={version}'],
            'extensions': ['octvertexnormals'],
            'available': [[{'startX': 0, 'startY': 0,
                            'endX': 2 ** (z + 1) - 1, 'endY': 2 ** z - 1}]
                          for z in range(self.max_zoom + 1)],
            'body': 'mars', 'ellipsoid': [MARS_RADIUS] * 3,
            'heightReference': 'source DEM values; no vertical datum conversion',
            'attribution': 'Mars HRSC / MOLA DEM',
        }

    def validate_tile(self, z, x, y):
        if not (0 <= z <= self.max_zoom and 0 <= x < 2 ** (z + 1)
                and 0 <= y < 2 ** z):
            raise ValueError('Tile outside Mars terrain coverage')

    def _reader(self, z):
        # Use the same overview for every tile of a level, including shared edges.
        desired = max(1, self.width / (2 ** (z + 1) * 256))
        factor = max(f for f in self.overviews if f <= desired)
        key = (threading.get_ident(), factor)
        with self.lock:
            if key not in self.readers:
                options = {} if factor == 1 else {'overview_level': self.overviews.index(factor) - 1}
                self.readers[key] = rasterio.open(self.path, **options)
            return self.readers[key]

    def sample(self, lon, lat, z):
        """Sample identical positions identically on either side of tile seams."""
        src = self._reader(z)
        lon, lat = np.broadcast_arrays(np.asarray(lon, dtype=float), np.asarray(lat, dtype=float))
        # All longitudes converge at a pole; choose one height for that vertex.
        longitude = np.where(np.abs(lat) >= 90, 0, lon)
        longitude = (longitude - self.west) % 360 + self.west
        px = np.deg2rad(longitude) * MARS_RADIUS
        py = np.deg2rad(np.clip(lat, -90, 90)) * MARS_RADIUS
        # Clamp only the half-pixel at the polar edge to avoid nodata padding.
        px = np.clip(px, src.bounds.left + src.transform.a / 2,
                     src.bounds.right - src.transform.a / 2)
        py = np.clip(py, src.bounds.bottom - src.transform.e / 2,
                     src.bounds.top + src.transform.e / 2)
        values = np.ma.asarray(list(src.sample(zip(px.ravel(), py.ravel()), masked=True)))[:, 0]
        heights = values.filled(self.qp.get_no_data()).astype(float).reshape(lon.shape)
        return np.nan_to_num(heights, nan=self.qp.get_no_data())

    def mesh(self, z, x, y, normals=True):
        self.validate_tile(z, x, y)
        n = int(self.sizes.get(str(z), self.qp.get_default_grid_size()))
        # Coarse hemisphere tiles need enough subdivisions for their curvature.
        n = max(16, min(n, 128))
        span = 180 / 2 ** z
        west, south = -180 + x * span, -90 + y * span  # TMS: y grows north.
        lon, lat = np.meshgrid(np.linspace(west, west + span, n + 1),
                               np.linspace(south, south + span, n + 1))
        height = self.sample(lon, lat, z)
        if z < self.qp.get_min_zoom():
            height[:] = self.qp.get_no_data()
        vertices = np.column_stack([lon.ravel(), lat.ravel(), height.ravel()])
        indices = np.arange((n + 1) ** 2).reshape(n + 1, n + 1)
        a, b, c, d = (indices[:-1, :-1].ravel(), indices[:-1, 1:].ravel(),
                      indices[1:, :-1].ravel(), indices[1:, 1:].ravel())
        triangles = np.vstack([np.column_stack([a, b, c]), np.column_stack([c, b, d])])
        vertex_normals = None
        if normals:
            # Central differences use samples across the tile boundary, so lighting
            # remains continuous without a neighbour request/cache dependency.
            delta = span / n
            def positions(dx, dy):
                lo, la = lon + dx, np.clip(lat + dy, -90, 90)
                h = self.sample(lo, la, z) if z >= self.qp.get_min_zoom() else height
                return to_ecef(np.column_stack([lo.ravel(), la.ravel(), h.ravel()]), ellipsoid=MARS)
            vertex_normals = np.cross(positions(delta, 0) - positions(-delta, 0),
                                      positions(0, delta) - positions(0, -delta))
            lengths = np.linalg.norm(vertex_normals, axis=1)
            radial = to_ecef(vertices, ellipsoid=MARS)
            radial /= np.linalg.norm(radial, axis=1)[:, None]
            valid = (lengths > 1e-9) & (np.abs(lat.ravel()) < 90)
            vertex_normals[valid] /= lengths[valid, None]
            vertex_normals[~valid] = radial[~valid]
        return vertices, triangles, vertex_normals

    def tile(self, z, x, y, normals=True):
        if self._source_signature() != self._signature:
            raise RuntimeError('Mars DEM changed; restart CTOD to reopen its readers')
        key = (z, x, y, normals)
        with self.lock:
            if not self.qp.get_skip_cache() and key in self.cache:
                self.cache.move_to_end(key)
                return self.cache[key]
        vertices, triangles, vertex_normals = self.mesh(z, x, y, normals)
        result = gzip.compress(quantize(vertices, triangles, vertex_normals, ellipsoid=MARS))
        if not self.qp.get_skip_cache():
            with self.lock:
                self.cache[key] = result
                self.cache.move_to_end(key)
                while len(self.cache) > 128:
                    self.cache.popitem(last=False)
        return result

    async def get_tile(self, z, x, y, normals=True, timeout=30):
        self.validate_tile(z, x, y)
        if self.closed:
            raise RuntimeError('Mars terrain service is closed')
        await asyncio.wait_for(self.slots.acquire(), timeout=timeout)
        try:
            future = asyncio.get_running_loop().run_in_executor(self.executor, self.tile, z, x, y, normals)
        except BaseException:
            self.slots.release()
            raise
        def done(task):
            self.slots.release()
            if not task.cancelled():
                task.exception()  # Retrieve even after client timeout/disconnect.
        future.add_done_callback(done)
        return await asyncio.wait_for(asyncio.shield(future), timeout=timeout)

    def close(self):
        self.closed = True
        self.executor.shutdown(wait=True, cancel_futures=True)
        for reader in self.readers.values():
            reader.close()
        self.readers.clear()
        self.cache.clear()
