#!/usr/bin/env python3
"""Export real CTOD meshes for GitHub Pages, with truthful TMS availability.

Global z0–4 and z5–9 around mission pins/routes fit a static Pages site.
No resampling, synthetic heights, reduced mesh density or gzip headers required.
All generated tiles are validated. layer.json is published only after completion.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
MARS_RADIUS = 3396190


def mission_regions(root, padding):
    text = (root / 'src/missions/mission-data.js').read_text()
    matches = re.findall(r"\bid:\s*'([^']+)'[\s\S]*?\blat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)", text)
    if not matches:
        raise ValueError('No mission coordinates found')
    regions = []
    for identifier, lat, lon in matches:
        points = [[float(lon), float(lat)]]
        route = root / 'data/routes' / (identifier + '.json')
        if route.is_file():
            points += json.loads(route.read_text())['points']
        regions.append({'id': identifier, 'bounds': [
            max(-180, min(p[0] for p in points) - padding),
            max(-90, min(p[1] for p in points) - padding),
            min(180, max(p[0] for p in points) + padding),
            min(90, max(p[1] for p in points) + padding)]})
    return regions


def tile_plan(global_zoom, max_zoom, regions):
    if not 0 <= global_zoom <= max_zoom <= 12:
        raise ValueError('Require 0 <= global zoom <= max zoom <= 12')
    plan = []
    for z in range(max_zoom + 1):
        width, height = 2 ** (z + 1), 2 ** z
        if z <= global_zoom:
            plan.append({(x, y) for y in range(height) for x in range(width)})
            continue
        tiles = set()
        for region in regions:
            west, south, east, north = region['bounds']
            if not -180 <= west <= east <= 180 or not -90 <= south <= north <= 90:
                raise ValueError('Invalid region bounds')
            x0 = max(0, min(width - 1, math.floor((west + 180) / 360 * width)))
            x1 = max(0, min(width - 1, math.floor((east + 180) / 360 * width)))
            y0 = max(0, min(height - 1, math.floor((south + 90) / 180 * height)))
            y1 = max(0, min(height - 1, math.floor((north + 90) / 180 * height)))
            tiles.update((x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1))
        plan.append(tiles)
    return plan


def availability(plan):
    # Exact row runs: no absent tile is ever advertised to Cesium.
    result = []
    for tiles in plan:
        rows = {}
        for x, y in tiles:
            rows.setdefault(y, []).append(x)
        rectangles = []
        for y, xs in sorted(rows.items()):
            start = end = sorted(xs)[0]
            for x in sorted(xs)[1:] + [None]:
                if x == end + 1:
                    end = x
                else:
                    rectangles.append({'startX': start, 'endX': end, 'startY': y, 'endY': y})
                    start = end = x
        result.append(rectangles)
    return result


def validate_mesh(data, require_normals=True):
    if len(data) < 100 or data[:2] == b'\x1f\x8b':
        raise ValueError('Expected an uncompressed quantized-mesh tile')
    header = struct.unpack_from('<3d2f7d', data)
    if not all(math.isfinite(v) for v in header) or header[3] > header[4] or header[8] <= 0:
        raise ValueError('Invalid terrain header')
    vertices = struct.unpack_from('<I', data, 88)[0]
    if not 3 <= vertices <= 1_000_000:
        raise ValueError('Invalid terrain vertex count')
    size = 4 if vertices > 65536 else 2
    offset = 92 + vertices * 6
    offset += (-offset) % size
    try:
        triangles = struct.unpack_from('<I', data, offset)[0]
        if triangles < 1:
            raise ValueError('Terrain contains no triangles')
        offset += 4 + triangles * 3 * size
        for _ in range(4):
            count = struct.unpack_from('<I', data, offset)[0]
            offset += 4 + count * size
        normals = False
        while offset < len(data):
            extension, length = struct.unpack_from('<BI', data, offset)
            offset += 5
            if offset + length > len(data):
                raise ValueError('Truncated terrain extension')
            if extension == 1:
                if length != vertices * 2:
                    raise ValueError('Invalid octvertexnormals extension')
                normals = True
            offset += length
        if offset != len(data) or (require_normals and not normals):
            raise ValueError('Terrain is truncated or lacks vertex normals')
    except struct.error as exc:
        raise ValueError('Truncated terrain') from exc
    return vertices


def fetch_tile(source, version, z, x, y):
    # Dataset endpoints negotiate extensions through Accept, not a query flag.
    url = f'{source}/{z}/{x}/{y}.terrain?v={version}'
    request = urllib.request.Request(url, headers={
        'Accept': 'application/vnd.quantized-mesh;extensions=octvertexnormals',
        'Accept-Encoding': 'identity',
    })
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                if response.headers.get('X-Terrain-Version', version) != version:
                    raise ValueError('CTOD version changed during export; rebuild into a new directory')
                data = response.read(4_000_001)
            if len(data) > 4_000_000:
                raise ValueError('Unexpectedly large terrain tile')
            if data[:2] == b'\x1f\x8b':
                data = gzip.decompress(data)
            validate_mesh(data)
            return data
        except (OSError, ValueError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def export(source, output, global_zoom, max_zoom, padding, workers, max_mib):
    source = source.rstrip('/')
    with urllib.request.urlopen(source + '/layer.json', timeout=30) as response:
        metadata = json.load(response)
    if (metadata.get('body') != 'mars' or metadata.get('ellipsoid') != [MARS_RADIUS] * 3 or
            metadata.get('format') != 'quantized-mesh-1.0' or metadata.get('scheme') != 'tms' or
            'octvertexnormals' not in metadata.get('extensions', [])):
        raise ValueError('Expected CTOD Mars terrain with vertex normals')
    regions = mission_regions(ROOT, padding)
    # Also retain detail around the existing terrain-validation probe sites.
    regions += [{'id': 'olympus-probe', 'bounds': [-134.3, 18.15, -133.3, 19.15]},
                {'id': 'validation-probe', 'bounds': [70, 39.5, 71, 40.5]}]
    plan = tile_plan(global_zoom, max_zoom, regions)
    for z, tiles in enumerate(plan):
        rectangles = metadata.get('available', [])[z] if z < len(metadata.get('available', [])) else []
        if any(not any(r['startX'] <= x <= r['endX'] and r['startY'] <= y <= r['endY']
                       for r in rectangles) for x, y in tiles):
            raise ValueError(f'Source does not cover the planned level {z}')
    identity = {'sourceVersion': metadata['version'], 'globalZoom': global_zoom,
                'maxZoom': max_zoom, 'regions': regions, 'normals': True}
    identifier = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:12]
    output.mkdir(parents=True, exist_ok=True)
    plan_file = output / 'export-plan.json'
    if plan_file.exists() and json.loads(plan_file.read_text()) != identity:
        raise ValueError('Output contains another export plan; choose another output directory')
    plan_file.write_text(json.dumps(identity, indent=2) + '\n')
    if (output / 'layer.json').exists():
        raise ValueError('A completed export already exists; use another output directory to rebuild')
    work = [(z, x, y) for z, tiles in enumerate(plan) for x, y in sorted(tiles)]
    print(f'Exporting {len(work)} tiles: global z0–{global_zoom}; mission regions through z{max_zoom}', flush=True)
    files, total = {}, 0

    def download(tile):
        z, x, y = tile
        path = output / str(z) / str(x) / f'{y}.terrain'
        if path.exists():
            raw = path.read_bytes()
            validate_mesh(raw)
        else:
            raw = fetch_tile(source, metadata['version'], z, x, y)
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix('.part')
            temporary.write_bytes(raw)
            temporary.replace(path)
        return path.relative_to(output).as_posix(), len(raw), hashlib.sha256(raw).hexdigest()

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(download, tile) for tile in work]
        try:
            for future in as_completed(futures):
                name, size, digest = future.result()
                total += size
                if total > max_mib * 1024 * 1024:
                    raise ValueError('Static terrain exceeds the requested size budget')
                files[name] = {'bytes': size, 'sha256': digest}
                if len(files) % 50 == 0:
                    print(f'{len(files)}/{len(work)} tiles, {total / 1024**2:.1f} MiB', flush=True)
        except BaseException:
            for future in futures:
                future.cancel()
            raise
    # Recheck source identity before advertising this package as complete.
    with urllib.request.urlopen(source + '/layer.json', timeout=30) as response:
        if json.load(response)['version'] != metadata['version']:
            raise ValueError('CTOD version changed during export')
    index = {'schemaVersion': 1, **identity, 'tileCount': len(files), 'totalBytes': total,
             'sourceMetadataSha256': hashlib.sha256(json.dumps(metadata, sort_keys=True).encode()).hexdigest(),
             'files': dict(sorted(files.items()))}
    (output / 'export.json').write_text(json.dumps(index, separators=(',', ':')) + '\n')
    layer = {**metadata, 'version': metadata['version'] + '-pages-' + identifier,
             'available': availability(plan), 'minzoom': 0, 'maxzoom': max_zoom,
             'tiles': ['{z}/{x}/{y}.terrain?v={version}'],
             'staticCoverage': {'globalMaxZoom': global_zoom, 'regionalMaxZoom': max_zoom,
                                'regions': regions, 'meshDensityUnchanged': True}}
    (output / 'layer.json').write_text(json.dumps(layer, separators=(',', ':')) + '\n')
    print(f'Complete: {len(files)} tiles; {total / 1024**2:.1f} MiB; {output}', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', default='http://localhost:5000/tiles/mars')
    parser.add_argument('--output', type=Path, default=ROOT / 'data/terrain/mars')
    parser.add_argument('--global-zoom', type=int, default=4)
    parser.add_argument('--max-zoom', type=int, default=9)
    parser.add_argument('--padding', type=float, default=0.5)
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=4)
    parser.add_argument('--max-mib', type=int, default=700)
    args = parser.parse_args()
    if not 0 < args.padding <= 5 or args.max_mib <= 0:
        parser.error('padding must be >0 and <=5 degrees; max-mib must be positive')
    export(args.source, args.output, args.global_zoom, args.max_zoom, args.padding, args.workers, args.max_mib)
