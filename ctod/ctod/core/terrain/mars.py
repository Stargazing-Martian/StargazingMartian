"""Mars terrain service: block raster reads, dense meshes, persistent tile cache.

Coordinates stay in the source Mars CRS. The wire layout is Cesium's geographic
2x1 TMS grid; ECEF, normals and mesh headers all use the same Mars sphere.
"""
import asyncio
import gzip
import hashlib
import json
import logging
import os
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import NamedTemporaryFile

from ctod.core.terrain.mars_raster import MarsRaster, MARS_RADIUS
from ctod.core.terrain.mars_mesh import build_mesh, MARS
from ctod.core.terrain.quantize import quantize

# Bump whenever sampling, mesh topology or encoding changes.
PIPELINE_VERSION = '3.0.1'


class MarsTerrain:
    def __init__(self, qp, cache_path=None):
        if qp.get_meshing_method() != 'grid':
            raise ValueError('Mars terrain supports grid meshing')
        self.qp = qp
        self.max_zoom = qp.get_max_zoom()
        if not 0 <= self.max_zoom <= 24:
            raise ValueError('Mars maxZoom must be between 0 and 24')
        # Uniform density avoids sparse coarse meshes and uneven neighbours.
        self.cells = max(64, min(int(qp.defaultGridSize or 128), 128))
        self.sizes = json.loads(qp.zoomGridSizes or '{}')
        for level, count in self.sizes.items():
            if not 64 <= int(count) <= 128:
                raise ValueError(f'Mars grid size at level {level} must be between 64 and 128')
        local = os.environ.get('CTOD_MARS_DEM', '')
        path = local if local and Path(local).is_file() else qp.get_cog()
        self.raster = MarsRaster(path, qp.get_resampling_method() or 'nearest')
        self.path = self.raster.path
        identity = json.dumps([PIPELINE_VERSION, self.raster.signature, self.cells, self.sizes,
                               qp.get_min_zoom(), self.raster.resampling], sort_keys=True)
        self.version = PIPELINE_VERSION + '-' + hashlib.sha256(identity.encode()).hexdigest()[:12]
        self.cache_path = Path(cache_path) / 'mars' / self.version if cache_path else None
        self.cache = OrderedDict()
        self.lock = threading.Lock()
        self.executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix='mars')
        self.slots = asyncio.Semaphore(4)
        self.pending = {}
        self.closed = False
        logging.info('Mars DEM: %s; %.1f m/pixel; grid %s; version %s',
                     path, self.raster.resolution_m, self.cells, self.version)

    # Kept for users of the previous validation API.
    _validate = staticmethod(MarsRaster._validate)

    def layer(self):
        return {
            'tilejson': '2.1.0', 'name': 'Mars HRSC / MOLA terrain', 'version': self.version,
            'format': 'quantized-mesh-1.0', 'scheme': 'tms', 'projection': 'EPSG:4326',
            'bounds': [-180, -90, 180, 90],
            'tiles': ['{z}/{x}/{y}.terrain?v={version}'],
            'extensions': ['octvertexnormals'],
            'available': [[{'startX': 0, 'startY': 0,
                            'endX': 2**(z + 1) - 1, 'endY': 2**z - 1}]
                          for z in range(self.max_zoom + 1)],
            'body': 'mars', 'ellipsoid': [MARS_RADIUS] * 3,
            'heightReference': 'source DEM values; no vertical datum conversion',
            'attribution': 'Mars HRSC / MOLA DEM (USGS / ESA / DLR / FU Berlin / NASA)',
            'sourceResolutionMeters': self.raster.resolution_m,
            'gridCells': self.cells,
            'voidHandling': 'valid coarser DEM overviews; remaining voids are errors',
        }

    def validate_tile(self, z, x, y):
        if not (0 <= z <= self.max_zoom and 0 <= x < 2**(z + 1) and 0 <= y < 2**z):
            raise ValueError('Tile outside Mars terrain coverage')

    def sample(self, lon, lat, z):
        return self.raster.sample(lon, lat, z, self._cells(z))

    def _cells(self, z):
        return int(self.sizes.get(str(z), self.cells))

    def mesh(self, z, x, y, normals=True):
        self.validate_tile(z, x, y)
        return build_mesh(self.raster, z, x, y, self._cells(z), normals,
                          flat=z < self.qp.get_min_zoom())

    def _remember(self, key, data):
        with self.lock:
            self.cache[key] = data
            self.cache.move_to_end(key)
            while len(self.cache) > 128:
                self.cache.popitem(last=False)

    def tile(self, z, x, y, normals=True):
        self.validate_tile(z, x, y)
        if self.raster.source_signature() != self.raster.signature:
            raise RuntimeError('Mars DEM changed; restart CTOD to reopen its readers')
        key = (z, x, y, normals)
        use_cache = not self.qp.get_skip_cache()
        disk = self.cache_path / f'{z}/{x}/{y}-{int(normals)}.terrain' if self.cache_path else None
        if use_cache:
            with self.lock:
                cached = self.cache.get(key)
                if cached is not None:
                    self.cache.move_to_end(key)
                    return cached
            if disk and disk.is_file():
                data = disk.read_bytes()
                self._remember(key, data)
                return data
        start = time.monotonic()
        vertices, triangles, vertex_normals = self.mesh(z, x, y, normals)
        data = gzip.compress(quantize(vertices, triangles, vertex_normals, ellipsoid=MARS), compresslevel=3)
        if use_cache:
            self._remember(key, data)
            if disk:
                try:
                    disk.parent.mkdir(parents=True, exist_ok=True)
                    with NamedTemporaryFile(dir=disk.parent, delete=False) as stream:
                        temporary = Path(stream.name)
                        stream.write(data)
                    os.replace(temporary, disk)
                except OSError:
                    logging.warning('Cannot persist Mars tile %s', disk, exc_info=True)
        logging.info('Mars tile %s/%s/%s: %s vertices, %.2fs, %s bytes',
                     z, x, y, len(vertices), time.monotonic() - start, len(data))
        return data

    async def _generate(self, key):
        async with self.slots:
            return await asyncio.get_running_loop().run_in_executor(self.executor, self.tile, *key)

    async def get_tile(self, z, x, y, normals=True, timeout=120):
        self.validate_tile(z, x, y)
        if self.closed:
            raise RuntimeError('Mars terrain service is closed')
        key = (z, x, y, normals)
        task = self.pending.get(key)
        if task is None:
            if len(self.pending) >= 64:
                raise RuntimeError('Mars terrain request queue is full; retry shortly')
            task = asyncio.create_task(self._generate(key))
            self.pending[key] = task

            def done(completed):
                self.pending.pop(key, None)
                if not completed.cancelled():
                    completed.exception()
            task.add_done_callback(done)
        # A client timeout must not cancel shared work or release its worker early.
        return await asyncio.wait_for(asyncio.shield(task), timeout=timeout)

    def close(self):
        self.closed = True
        self.executor.shutdown(wait=True, cancel_futures=True)
        self.raster.close()
        self.cache.clear()
