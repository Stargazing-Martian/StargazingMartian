"""Build data/routes/<mission>.json from NASA rover traverse files.

Usage: python3 scripts/build_routes.py [raw_dir]

Downloads each source into raw_dir (default: ./.cache/raw-routes) if it is
missing, converts it to [lon, lat, sol] points (east-positive degrees, sol may
be null), thins it with Douglas-Peucker and writes compact JSON.
"""
import csv, json, math, sys, urllib.request
from pathlib import Path

MARS_RADIUS = 3396190.0
TOLERANCE_M = 3.0  # max deviation kept when thinning the line
OUT = Path(__file__).resolve().parent.parent / 'data' / 'routes'

SOURCES = {
    'perseverance': 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json',
    'curiosity': 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json',
    'spirit': 'https://an.rsl.wustl.edu/mera/AN/meri/MER/traverse/MERA_traverse.csv',
    'opportunity': 'https://an.rsl.wustl.edu/mera/AN/meri/MER/traverse/MERB_traverse_5130.csv',
}


def fetch(url, raw_dir):
    path = raw_dir / url.rsplit('/', 1)[1]
    if not path.exists():
        print('downloading', url)
        urllib.request.urlretrieve(url, path)
    return path


def from_mmgis(path):
    """MMGIS GeoJSON: LineString per drive (M20, has sol) or MultiLineString (MSL)."""
    points = []
    for feature in json.loads(path.read_text())['features']:
        sol = (feature.get('properties') or {}).get('sol')
        geometry = feature['geometry']
        lines = [geometry['coordinates']] if geometry['type'] == 'LineString' else geometry['coordinates']
        for line in lines:
            for lon, lat, *_ in line:
                points.append([lon, lat, sol])
    return points


def from_mer(path, to_lonlat):
    """MER Analyst's Notebook CSV: CORRECTED_X/Y in metres, START_SOL per row."""
    points = []
    with path.open() as f:
        for row in csv.DictReader(f):
            lon, lat = to_lonlat(float(row['CORRECTED_X']), float(row['CORRECTED_Y']))
            points.append([lon, lat, int(row['START_SOL'])])
    return points


def spirit_lonlat(x, y):
    # Equirectangular metres centred on 175.5°E (Gusev map projection).
    return 175.5 + math.degrees(x / MARS_RADIUS), math.degrees(y / MARS_RADIUS)


def opportunity_lonlat(x, y):
    # Metres east/north of the Eagle crater landing site.
    lat0, lon0 = -1.9462, 354.4734
    lat = lat0 + math.degrees(y / MARS_RADIUS)
    lon = lon0 + math.degrees(x / (MARS_RADIUS * math.cos(math.radians(lat0))))
    return lon, lat


def to_metres(points):
    lat0 = math.radians(points[0][1])
    k = math.pi / 180 * MARS_RADIUS
    return [(p[0] * k * math.cos(lat0), p[1] * k) for p in points]


def simplify(points, tolerance):
    """Douglas-Peucker (iterative) on a local metric projection."""
    xy = to_metres(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        (ax, ay), (bx, by) = xy[start], xy[end]
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy)
        worst, worst_i = 0.0, None
        for i in range(start + 1, end):
            px, py = xy[i]
            d = (abs(dy * px - dx * py + bx * ay - by * ax) / length) if length else math.hypot(px - ax, py - ay)
            if d > worst:
                worst, worst_i = d, i
        if worst_i is not None and worst > tolerance:
            keep[worst_i] = True
            stack += [(start, worst_i), (worst_i, end)]
    return [p for p, k in zip(points, keep) if k]


def length_km(points):
    xy = to_metres(points)
    return sum(math.dist(a, b) for a, b in zip(xy, xy[1:])) / 1000


def main():
    raw_dir = Path(sys.argv[1] if len(sys.argv) > 1 else '.cache/raw-routes')
    raw_dir.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    readers = {
        'perseverance': from_mmgis,
        'curiosity': from_mmgis,
        'spirit': lambda p: from_mer(p, spirit_lonlat),
        'opportunity': lambda p: from_mer(p, opportunity_lonlat),
    }
    for mission, url in SOURCES.items():
        points = readers[mission](fetch(url, raw_dir))
        # Drop consecutive duplicates, normalise longitude to -180..180.
        cleaned = []
        for lon, lat, sol in points:
            lon = (lon + 180) % 360 - 180
            if not cleaned or (cleaned[-1][0], cleaned[-1][1]) != (lon, lat):
                cleaned.append([round(lon, 6), round(lat, 6), sol])
        thinned = simplify(cleaned, TOLERANCE_M)
        data = {'mission': mission, 'source': url, 'lengthKm': round(length_km(cleaned), 2),
                'points': thinned}
        (OUT / f'{mission}.json').write_text(json.dumps(data, separators=(',', ':')))
        print(f'{mission}: {len(cleaned)} -> {len(thinned)} points, {data["lengthKm"]} km')


if __name__ == '__main__':
    main()
