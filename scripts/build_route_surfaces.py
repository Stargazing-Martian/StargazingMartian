"""Cache exact triangle heights from published meshes, outside the browser.

Requires numpy/scipy. No DEM resampling, horizontal smoothing or zero filling.
Original route vertices remain in points; render.points only inserts geodesic
vertices between them (<=50 m spacing) and caches mesh heights for display.
"""
import hashlib
import json
import math
from pathlib import Path
import struct
import bisect
from build_routes import simplify
from functools import lru_cache
import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
TERRAIN = ROOT / 'data/terrain/mars'
R = 3396190


@lru_cache(maxsize=16)
def mesh(key):
    raw = (TERRAIN / key).read_bytes()
    n = struct.unpack_from('<I', raw, 88)[0]
    q = np.frombuffer(raw, dtype='<u2', count=n * 3, offset=92).reshape(3, n).astype(np.int64)
    q = np.cumsum((q >> 1) ^ -(q & 1), axis=1).T
    offset = 92 + n * 6
    size = 2 if n <= 65536 else 4
    offset += -offset % size
    count = struct.unpack_from('<I', raw, offset)[0]
    codes = np.frombuffer(raw, dtype='<u2' if size == 2 else '<u4', count=count * 3, offset=offset + 4)
    highest = np.cumsum(codes == 0) - (codes == 0)
    # Match Cesium's unsigned destination array, including modular wrapping.
    indices = ((highest - codes.astype(np.int64)) % (1 << (size * 8))).reshape(-1, 3)
    xy = q[indices, :2].astype(float)
    lo, hi = struct.unpack_from('<2f', raw, 24)
    heights = lo + q[:, 2] / 32767 * (hi - lo)
    return xy, heights[indices], cKDTree(xy.mean(axis=1))


def sample(points):
    metadata = json.loads((TERRAIN / 'export.json').read_text())
    groups, result = {}, np.full(len(points), np.nan)
    for i, (lon, lat, *_) in enumerate(points):
        for z in range(metadata['maxZoom'], -1, -1):
            w, h = 2 ** (z + 1), 2 ** z
            fx, fy = ((lon + 180) % 360) / 360 * w, (lat + 90) / 180 * h
            x, y = min(w - 1, int(fx)), min(h - 1, int(fy))
            key = f'{z}/{x}/{y}.terrain'
            if key in metadata['files']:
                groups.setdefault(key, []).append((i, (fx - x) * 32767, (fy - y) * 32767))
                break
    for key, entries in groups.items():
        triangles, heights, tree = mesh(key)
        coords = np.array(entries)[:, 1:]
        _, near = tree.query(coords, k=12)
        t = triangles[near]
        a, b, c = t[:, :, 0], t[:, :, 1], t[:, :, 2]
        v, e, f = coords[:, None, :] - a, b - a, c - a
        det = e[:, :, 0] * f[:, :, 1] - e[:, :, 1] * f[:, :, 0]
        u = (v[:, :, 0] * f[:, :, 1] - v[:, :, 1] * f[:, :, 0]) / det
        w = (e[:, :, 0] * v[:, :, 1] - e[:, :, 1] * v[:, :, 0]) / det
        valid = (u >= -1e-8) & (w >= -1e-8) & (u + w <= 1 + 1e-8)
        if not valid.any(axis=1).all():
            raise ValueError(f'No enclosing mesh triangle in {key}')
        j = valid.argmax(axis=1)
        row = np.arange(len(entries))
        z = heights[near[row, j]]
        value = z[:, 0] * (1 - u[row, j] - w[row, j]) + z[:, 1] * u[row, j] + z[:, 2] * w[row, j]
        result[np.array(entries)[:, 0].astype(int)] = value
    if not np.isfinite(result).all():
        raise ValueError('Missing terrain heights; refusing zero-height substitution')
    return result


def densify(points, spacing=50):
    out, anchors = [], []
    for i, point in enumerate(points):
        if i:
            a, b = np.radians(points[i - 1][:2]), np.radians(point[:2])
            def xyz(p):
                return np.array([math.cos(p[1])*math.cos(p[0]), math.cos(p[1])*math.sin(p[0]), math.sin(p[1])])
            va, vb = xyz(a), xyz(b)
            angle = math.acos(float(np.clip(va @ vb, -1, 1)))
            count = math.ceil(angle * R / spacing)
            for k in range(1, count):
                f = k / count
                v = (math.sin((1-f)*angle)*va + math.sin(f*angle)*vb) / math.sin(angle)
                out.append([math.degrees(math.atan2(v[1], v[0])), math.degrees(math.atan2(v[2], math.hypot(v[0], v[1])))])
        anchors.append(len(out))
        out.append(point[:2])
    return out, anchors


def main():
    version = json.loads((TERRAIN / 'layer.json').read_text())['version']
    for file in sorted((ROOT / 'data/routes').glob('*.json')):
        data = json.loads(file.read_text())
        # Subpixel display cleanup prevents enormous miter spikes at nearly
        # coincident telemetry points. Retained vertices never move. The full
        # source geometry remains unchanged in data.points; 0.25m is far below
        # the imagery/DEM resolution, not a lower-resolution dataset.
        indexed = [[p[0], p[1], i] for i, p in enumerate(data['points'])]
        keep = {p[2] for p in simplify(indexed, .25)}
        keep.update(s[k] for s in data['segments'] for k in ['from', 'to'])
        keep = sorted(keep)
        points, kept_anchors = densify([data['points'][i] for i in keep])
        anchors = [kept_anchors[max(0, bisect.bisect_right(keep, i) - 1)] for i in range(len(data['points']))]
        heights = sample(points)
        data['render'] = {'terrainVersion': version, 'method': 'Display only: retained source vertices, <=0.25m deviation, phase endpoints preserved, geodesic inserts <=50m. Full source geometry unchanged. Exact mesh triangle heights.',
                          'anchors': anchors, 'points': [[*p, round(float(h), 4)] for p, h in zip(points, heights)]}
        data['sourceGeometrySha256'] = hashlib.sha256(json.dumps(data['points'], separators=(',', ':')).encode()).hexdigest()
        file.write_text(json.dumps(data, separators=(',', ':')))
        print(file.name, len(points), 'vertices', file.stat().st_size, 'bytes', flush=True)


if __name__ == '__main__':
    main()
