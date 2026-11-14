"""Read native Mars rasters in blocks, with deterministic global pixel sampling."""
import math
import os
import threading
from collections import OrderedDict

import numpy as np
import rasterio
from pyproj import CRS
from rasterio.windows import Window

MARS_RADIUS = 3396190.0


class MarsRaster:
    def __init__(self, path, resampling='bilinear', block_cache_bytes=128 * 1024**2):
        self.path = f'/vsicurl/{path}' if path.startswith(('http://', 'https://')) else path
        self.resampling = resampling
        if resampling not in ('nearest', 'bilinear'):
            raise ValueError('Mars resampling must be nearest or bilinear')
        self.readers = {}
        self.blocks = OrderedDict()
        self.block_bytes = 0
        self.block_cache_bytes = block_cache_bytes
        self.lock = threading.Lock()
        with rasterio.open(self.path) as src:
            self.geographic = self._validate(src)
            self.width = src.width
            self.overviews = [1] + src.overviews(1)
            self.west = src.bounds.left if self.geographic else math.degrees(src.bounds.left / MARS_RADIUS)
            self.resolution_m = src.transform.a * (math.pi * MARS_RADIUS / 180 if self.geographic else 1)
        self.signature = self.source_signature()

    def source_signature(self):
        if self.path.startswith('/vsi'):
            return (self.path,)
        stat = os.stat(self.path)
        return (self.path, stat.st_size, stat.st_mtime_ns)

    def _reader(self, z, cells):
        # Same overview and global pixel centres for every neighbour at this level.
        desired = max(1, self.width / (2 ** (z + 1) * cells))
        factor = max(value for value in self.overviews if value <= desired)
        return self._open_reader(factor), factor

    def _open_reader(self, factor):
        key = (threading.get_ident(), factor)
        with self.lock:
            reader = self.readers.get(key)
        if reader is None:
            options = {} if factor == 1 else {'overview_level': self.overviews.index(factor) - 1}
            reader = rasterio.open(self.path, **options)
            with self.lock:
                self.readers[key] = reader
        return reader

    def _pixels(self, src, factor, rows, cols):
        """One read per touched raster block, instead of one read per vertex."""
        rows = np.clip(rows, 0, src.height - 1)
        cols = cols % src.width
        bh, bw = src.block_shapes[0]
        # Strip TIFFs can have enormous blocks. Bound our own windows as well.
        bh, bw = min(bh, 512), min(bw, 512)
        across = (src.width + bw - 1) // bw
        ids = (rows // bh) * across + cols // bw
        result = np.empty(rows.shape, dtype=np.float64)
        for block_id in np.unique(ids):
            block_row, block_col = divmod(int(block_id), across)
            key = (factor, block_row, block_col)
            with self.lock:
                data = self.blocks.get(key)
                if data is not None:
                    self.blocks.move_to_end(key)
            if data is None:
                window = Window(block_col * bw, block_row * bh,
                                min(bw, src.width - block_col * bw),
                                min(bh, src.height - block_row * bh))
                data = src.read(1, window=window, masked=True, out_dtype='float32').filled(np.nan)
                with self.lock:
                    old = self.blocks.pop(key, None)
                    if old is not None:
                        self.block_bytes -= old.nbytes
                    self.blocks[key] = data
                    self.block_bytes += data.nbytes
                    while self.block_bytes > self.block_cache_bytes and len(self.blocks) > 1:
                        _, removed = self.blocks.popitem(last=False)
                        self.block_bytes -= removed.nbytes
            selected = ids == block_id
            result[selected] = data[rows[selected] - block_row * bh,
                                    cols[selected] - block_col * bw]
        return result

    def sample(self, lon, lat, z, cells=128):
        src, factor = self._reader(z, cells)
        lon, lat = np.broadcast_arrays(np.asarray(lon, dtype=float), np.asarray(lat, dtype=float))
        lat = np.clip(lat, -90, 90)
        # A pole has a single height regardless of the tile's longitude.
        longitude = (np.where(np.abs(lat) == 90, 0, lon) - self.west) % 360 + self.west
        values = self._sample_reader(src, factor, longitude, lat)
        # Real COGs can have voids in their full-resolution band. Use a valid
        # coarser overview at exactly the same location, consistently across tiles.
        # Do not fabricate zero elevations or interpolate across unrelated tiles.
        for fallback in self.overviews:
            if fallback <= factor or np.isfinite(values).all():
                continue
            missing = ~np.isfinite(values)
            values[missing] = self._sample_reader(self._open_reader(fallback), fallback,
                                                  longitude[missing], lat[missing])
        if not np.isfinite(values).all():
            raise RuntimeError('Mars DEM contains missing elevations in the requested tile')
        return values

    def _sample_reader(self, src, factor, longitude, lat):
        x = longitude if self.geographic else np.deg2rad(longitude) * MARS_RADIUS
        y = lat if self.geographic else np.deg2rad(lat) * MARS_RADIUS
        inverse = ~src.transform
        col = inverse.a * x + inverse.b * y + inverse.c
        row = inverse.d * x + inverse.e * y + inverse.f
        if self.resampling == 'nearest':
            values = self._pixels(src, factor, np.floor(row).astype('int64'), np.floor(col).astype('int64'))
        else:
            col, row = col - .5, row - .5
            c0, r0 = np.floor(col).astype('int64'), np.floor(row).astype('int64')
            dx, dy = col - c0, row - r0
            values = np.zeros(longitude.shape)
            weights = np.zeros(longitude.shape)
            for dr, dc, weight in [(0, 0, (1-dx)*(1-dy)), (0, 1, dx*(1-dy)),
                                   (1, 0, (1-dx)*dy), (1, 1, dx*dy)]:
                data = self._pixels(src, factor, r0 + dr, c0 + dc)
                valid = np.isfinite(data)
                values += np.where(valid, data, 0) * weight
                weights += valid * weight
            values = np.divide(values, weights, out=np.full_like(values, np.nan), where=weights > 0)
        return values

    def close(self):
        for reader in self.readers.values():
            reader.close()
        self.readers.clear()
        self.blocks.clear()
        self.block_bytes = 0
    @staticmethod
    def _validate(src):
        crs = CRS(src.crs)
        source_crs = crs.source_crs if crs.is_bound else crs
        if source_crs is None:
            raise ValueError('Mars DEM has no usable source CRS')
        if not np.allclose([source_crs.ellipsoid.semi_major_metre,
                            source_crs.ellipsoid.semi_minor_metre], MARS_RADIUS, rtol=0, atol=.01):
            raise ValueError('Mars DEM must use the 3396190 metre sphere')
        geographic = source_crs.is_geographic
        if geographic:
            if any(axis.unit_name != 'degree' for axis in source_crs.axis_info):
                raise ValueError('Mars geographic DEM coordinates must use degrees')
            expected_extent = [360, 90, -90]
            tolerance = 2 * max(src.transform.a, -src.transform.e)
        else:
            operation = source_crs.coordinate_operation
            if (not source_crs.is_projected or operation is None
                    or 'Equidistant Cylindrical' not in operation.method_name):
                raise ValueError('Mars DEM must use spherical equirectangular or geographic coordinates')
            if any(abs(p.value) > 1e-9 for p in operation.params):
                raise ValueError('Mars DEM projection must have zero origin, offsets and standard parallel')
            if any(axis.unit_name != 'metre' for axis in source_crs.axis_info):
                raise ValueError('Mars projected coordinates must be in metres')
            circumference = 2 * math.pi * MARS_RADIUS
            expected_extent = [circumference, circumference / 4, -circumference / 4]
            tolerance = 2 * max(src.transform.a, -src.transform.e)
        t = src.transform
        if t.a <= 0 or t.e >= 0 or t.b != 0 or t.d != 0 or src.count != 1:
            raise ValueError('Mars DEM must be a north-up single-band raster')
        if not np.allclose([src.bounds.right - src.bounds.left,
                            src.bounds.top, src.bounds.bottom],
                           expected_extent,
                           rtol=0, atol=tolerance):
            raise ValueError('Mars DEM must cover the full globe')
        west_options = (0, -180) if geographic else (0, -math.pi * MARS_RADIUS)
        if min(abs(src.bounds.left - west) for west in west_options) > tolerance:
            raise ValueError('Mars DEM longitudes must start at 0 or -180 degrees')
        if src.scales != (1.0,) or src.offsets != (0.0,):
            raise ValueError('Apply raster elevation scale/offset before serving Mars terrain')
        return geographic

