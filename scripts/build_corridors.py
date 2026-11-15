"""Build Mars-wide expedition corridors: data/network/corridors.json

Usage: .cache/venv/bin/python scripts/build_corridors.py
(needs numpy + scikit-image; the MOLA DEM is downloaded to .cache/mola)

Least-cost paths between destinations over a cost map built from
  * MOLA MEGDR 16 px/deg topography, averaged to 8 px/deg (~7.4 km cells):
    slope and local roughness,
  * TES daytime surface temperature (Stargazing 6° x 3° averages in
    data/science/tes-temperature): cold penalty,
  * polar caps beyond 80° latitude: impassable.
These are planning corridors for a multi-sol crewed rover expedition, not
walking routes: 7 km cells cannot see boulders, small craters or cliffs.
"""
import json, math, urllib.request
from pathlib import Path

import numpy as np
from skimage.graph import MCP_Geometric

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.cache' / 'mola'
OUT = ROOT / 'data' / 'network' / 'corridors.json'
MOLA_URL = 'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img'
R = 3396190.0
PPD = 8                        # working resolution, pixels per degree
CELL_M = math.pi / 180 * R / PPD

# Rover expedition pace used for the day estimate (km per sol of driving).
KM_PER_SOL = 20
NEIGHBOURS = 3                 # each destination links to its 3 nearest
MAX_LINK_KM = 3200

# Destinations: mission sites (from the app) plus science destinations.
# Coordinates are approximate centres, planetocentric, east-positive.
DESTINATIONS = [
    # id, name, lat, lon, kind, why
    ('viking-1', 'Viking 1', 22.27, -47.95, 'mission', 'First US landing site; flat plains of Chryse Planitia.'),
    ('viking-2', 'Viking 2', 47.64, 134.29, 'mission', 'Northern plains of Utopia Planitia; seasonal frost.'),
    ('pathfinder', 'Mars Pathfinder', 19.13, -33.22, 'mission', 'Ancient flood plain at the mouth of Ares Vallis.'),
    ('spirit', 'Spirit', -14.57, 175.47, 'mission', 'Gusev crater; hot-spring silica at Home Plate.'),
    ('opportunity', 'Opportunity', -1.95, -5.53, 'mission', 'Meridiani Planum; hematite and water-formed rocks.'),
    ('phoenix', 'Phoenix', 68.22, -125.75, 'mission', 'Arctic plains with water ice centimetres below the surface.'),
    ('curiosity', 'Curiosity', -4.59, 137.44, 'mission', 'Gale crater; ancient lake and the layers of Mount Sharp.'),
    ('insight', 'InSight', 4.50, 135.62, 'mission', 'Flat Elysium Planitia; seismic station.'),
    ('perseverance', 'Perseverance', 18.44, 77.45, 'mission', 'Jezero crater river delta; sample cache.'),
    ('olympus-mons', 'Olympus Mons', 18.65, -133.8, 'destination', 'Tallest volcano in the Solar System, about 22 km high.'),
    ('arsia-mons', 'Tharsis Montes', -8.3, -120.1, 'destination', 'Arsia Mons, southernmost of the three Tharsis volcanoes.'),
    ('melas-chasma', 'Valles Marineris', -10.0, -73.0, 'destination', 'Melas Chasma, in the middle of the largest canyon system.'),
    ('mawrth-vallis', 'Mawrth Vallis', 24.0, -19.0, 'destination', 'Layered clay minerals formed in water.'),
    ('aram-chaos', 'Aram Chaos', 2.6, -21.5, 'destination', 'Collapsed terrain with hematite and sulfates.'),
    ('holden', 'Holden crater', -26.4, -34.0, 'destination', 'Crater with ancient lake and flood deposits.'),
    ('argyre', 'Argyre Planitia', -49.7, -43.4, 'destination', 'Floor of the Argyre impact basin.'),
    ('hellas', 'Hellas Planitia', -42.4, 70.5, 'destination', 'Deepest basin on Mars; highest air pressure at the surface.'),
    ('arcadia', 'Arcadia Planitia', 40.0, -163.0, 'destination', 'Mid-latitude plains with shallow buried ice.'),
    ('deuteronilus', 'Deuteronilus Mensae', 44.0, 22.0, 'destination', 'Mesas wrapped in debris-covered glaciers.'),
    ('hebrus-valles', 'Hebrus Valles', 20.0, 126.0, 'destination', 'Channels and possible caves on the Elysium plains.'),
    ('elysium-mons', 'Elysium Mons', 25.0, 147.2, 'destination', 'Second large volcanic province of Mars.'),
    ('columbus', 'Columbus crater', -29.0, -166.0, 'destination', 'Crater with layered sulfate and clay deposits.'),
    ('nili-fossae', 'Syrtis Major', 8.4, 69.5, 'destination', 'Volcanic plains of Syrtis Major Planum.'),
    ('terra-cimmeria', 'Terra Cimmeria', -35.0, 145.0, 'destination', 'Heavily cratered southern highlands.'),
]


def load_dem():
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / 'megt90n000eb.img'
    if not path.exists():
        print('downloading MOLA MEGDR 16 ppd (33 MB)')
        urllib.request.urlretrieve(MOLA_URL, path)
    z16 = np.fromfile(path, dtype='>i2').reshape(2880, 5760).astype(np.float32)
    # 16 -> 8 px/deg; rows run 90N -> 90S, columns 0E -> 360E.
    return z16.reshape(1440, 2, 2880, 2).mean(axis=(1, 3))


def load_temperature():
    """Mean and minimum daytime surface temperature (K) on the 60x60 grid."""
    files = sorted((ROOT / 'data' / 'science' / 'tes-temperature').glob('surface-*.json'))
    stack = []
    for f in files:
        values = json.loads(f.read_text())['fields']['MEAN_K']
        stack.append([np.nan if v is None else v for v in values])
    stack = np.array(stack, dtype=np.float64).reshape(len(files), 60, 60)
    mean = np.nanmean(stack, axis=0)
    low = np.nanmin(stack, axis=0)
    for grid in (mean, low):  # fill gaps with the latitude band's mean
        for r in range(60):
            row = grid[r]
            row[np.isnan(row)] = np.nanmean(row) if np.isfinite(row).any() else np.nan
        grid[np.isnan(grid)] = np.nanmin(grid)
    return mean, low


def temperature_on_grid(tgrid, lats, lons):
    rows = np.clip(((90 - lats) // 3).astype(int), 0, 59)
    lon180 = (lons + 180) % 360 - 180
    cols = (((lon180 + 183) % 360) // 6).astype(int)
    return tgrid[rows[:, None], cols[None, :]]


def build_cost():
    z = load_dem()
    h, w = z.shape
    lats = 90 - (np.arange(h) + 0.5) / PPD
    lons = (np.arange(w) + 0.5) / PPD
    coslat = np.cos(np.radians(lats))[:, None]
    dzdy = np.gradient(z, axis=0) / CELL_M
    dzdx = (np.roll(z, -1, axis=1) - np.roll(z, 1, axis=1)) / 2 / (CELL_M * np.maximum(coslat, 0.05))
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    # Roughness: spread of heights in the 3x3 neighbourhood (metres).
    stack = [np.roll(np.roll(z, dy, axis=0), dx, axis=1) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]
    rough = np.std(stack, axis=0)
    tmean, tlow = load_temperature()
    temp = temperature_on_grid(tmean, lats, lons)
    temp_low = temperature_on_grid(tlow, lats, lons)

    cost = (1
            + (slope / 4.0) ** 2          # 4° -> +1, 8° -> +4
            + rough / 400.0               # 400 m of local relief -> +1
            + np.maximum(0, 230 - temp) / 15.0)  # colder than -43 °C costs more
    cost[slope > 20] = 1e4                # walls of canyons, volcano scarps
    cost[np.abs(lats) > 80] = 1e5         # polar caps
    # Cells shrink towards the poles; MCP walks in cell steps, so scale by
    # the average cell size to keep paths roughly length-true.
    cost *= np.sqrt((1 + coslat ** 2) / 2)
    return dict(z=z, slope=slope, rough=rough, temp=temp, temp_low=temp_low, cost=cost, lats=lats, lons=lons)


def cell_of(lat, lon):
    return int((90 - lat) * PPD), int((lon % 360) * PPD)


def haversine_km(a, b):
    (lat1, lon1), (lat2, lon2) = a, b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R / 1000 * math.asin(math.sqrt(h))


def links():
    """Each destination to its nearest neighbours, plus a spanning tree."""
    n = len(DESTINATIONS)
    dist = [[haversine_km(DESTINATIONS[i][2:4], DESTINATIONS[j][2:4]) for j in range(n)] for i in range(n)]
    pairs = set()
    for i in range(n):
        for j in sorted(range(n), key=lambda j: dist[i][j])[1:NEIGHBOURS + 1]:
            if dist[i][j] <= MAX_LINK_KM:
                pairs.add(tuple(sorted((i, j))))
    # Prim's spanning tree so every destination is reachable.
    inside, edges = {0}, []
    while len(inside) < n:
        i, j = min(((i, j) for i in inside for j in range(n) if j not in inside), key=lambda e: dist[e[0]][e[1]])
        inside.add(j)
        pairs.add(tuple(sorted((i, j))))
    return sorted(pairs)


def least_cost_path(m, a, b):
    """Path between two destinations; the map is rolled so the pair sits
    mid-map and the path can cross the 0/360° seam."""
    h, w = m['cost'].shape
    (ra, ca), (rb, cb) = cell_of(*a), cell_of(*b)
    shift = w // 2 - ca
    cost = np.roll(m['cost'], shift, axis=1)
    mcp = MCP_Geometric(cost, fully_connected=True)
    mcp.find_costs([(ra, (ca + shift) % w)], [(rb, (cb + shift) % w)])
    path = mcp.traceback((rb, (cb + shift) % w))
    return [(r, (c - shift) % w) for r, c in path]


def simplify(points, tolerance_deg=0.08):
    """Douglas-Peucker in degrees (fine for display at planet scale)."""
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        s, e = stack.pop()
        (ax, ay), (bx, by) = points[s], points[e]
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy)
        worst, wi = 0, None
        for i in range(s + 1, e):
            px, py = points[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / length if length else math.hypot(px - ax, py - ay)
            if d > worst:
                worst, wi = d, i
        if wi is not None and worst > tolerance_deg:
            keep[wi] = True
            stack += [(s, wi), (wi, e)]
    return [p for p, k in zip(points, keep) if k]


def smooth(points, radius=6):
    """Moving average along the path: grid paths step in 45° moves and look
    like stairs. Endpoints stay on their destinations."""
    out = []
    n = len(points)
    for i in range(n):
        r = min(radius, i, n - 1 - i)
        window = points[i - r:i + r + 1]
        out.append((sum(p[0] for p in window) / len(window), sum(p[1] for p in window) / len(window)))
    return out


def describe(m, cells):
    rows = np.array([r for r, _ in cells])
    cols = np.array([c for _, c in cells])
    lats = m['lats'][rows]
    lons = m['lons'][cols]
    lonlat = [((lon + 180) % 360 - 180, lat) for lat, lon in zip(lats, lons)]
    # Unwrap longitudes so a seam crossing does not jump 360°.
    unwrapped = [lonlat[0]]
    for lon, lat in lonlat[1:]:
        prev = unwrapped[-1][0]
        lon += 360 * round((prev - lon) / 360)
        unwrapped.append((lon, lat))
    length = sum(haversine_km((a[1], a[0]), (b[1], b[0])) for a, b in zip(lonlat, lonlat[1:]))
    z = m['z'][rows, cols]
    slope = m['slope'][rows, cols]
    climb = float(np.sum(np.maximum(0, np.diff(z))))
    descent = float(np.sum(np.maximum(0, -np.diff(z))))
    p90 = float(np.percentile(slope, 90))
    tmin = float(np.min(m['temp_low'][rows, cols])) - 273.15
    tmean = float(np.mean(m['temp'][rows, cols])) - 273.15
    maxlat = float(np.max(np.abs(lats)))

    # Slopes averaged over 7 km cells are far gentler than the ground an
    # astronaut meets, so thresholds are set for this scale: a 7 km cell at
    # 10° is a canyon wall or volcano scarp.
    climb_per_km = climb / max(length, 1)
    checks = [  # (medium if, hard if, reason)
        (p90 >= 1.0, p90 >= 2.0, 'Sustained slopes along much of the corridor.'),
        (slope.max() >= 6, slope.max() >= 10, 'Crosses a steep scarp or canyon wall.'),
        (climb_per_km >= 5, climb_per_km >= 9, f'Hilly: {climb_per_km:.0f} m of climb per km.'),
        (tmin <= -40, tmin <= -60, f'Cold: daytime surface down to {tmin:.0f} °C.'),
    ]
    level, reasons = 'easy', []
    for medium, hard, why in checks:
        if hard:
            level = 'hard'
        elif medium and level == 'easy':
            level = 'medium'
        if medium or hard:
            reasons.append(why)
    if not reasons:
        reasons.append('Gentle, mostly flat plains with mild daytime temperatures.')
    reasons.append(f'Slope at 7 km scale: {p90:.1f}° on 90% of the corridor (max {float(slope.max()):.1f}°).')
    reasons.append(f'{climb / 1000:.1f} km of total climb and {descent / 1000:.1f} km of descent.')
    reasons.append(f'Daytime surface temperature along the way: mean {tmean:.0f} °C, coldest {tmin:.0f} °C.')
    if maxlat > 55:
        reasons.append(f'Reaches {maxlat:.0f}° latitude: long, cold polar winters.')
    points = [[round(lon, 3), round(lat, 3)] for lon, lat in simplify(smooth(unwrapped), 0.04)]
    return {
        'points': points, 'lengthKm': round(length), 'climbM': round(climb), 'descentM': round(descent),
        'slopeP90': round(p90, 1), 'slopeMax': round(float(slope.max()), 1),
        'tempMeanC': round(tmean), 'tempMinC': round(tmin),
        'sols': math.ceil(length / KM_PER_SOL), 'difficulty': level, 'reasons': reasons,
    }


def main():
    m = build_cost()
    corridors = []
    for i, j in links():
        a, b = DESTINATIONS[i], DESTINATIONS[j]
        cells = least_cost_path(m, a[2:4], b[2:4])
        info = describe(m, cells)
        corridors.append({'id': f'{a[0]}--{b[0]}', 'from': a[0], 'to': b[0], **info})
        print(f"{a[1]} -> {b[1]}: {info['lengthKm']} km, {info['difficulty']}, {len(info['points'])} pts")
    nodes = [{'id': d[0], 'name': d[1], 'lat': d[2], 'lon': d[3], 'kind': d[4], 'summary': d[5]}
             for d in DESTINATIONS]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        'about': 'Least-cost expedition corridors on MOLA 8 px/deg topography (~7.4 km cells) '
                 'with TES daytime surface temperature. Planning corridors, not verified routes.',
        'sources': {
            'topography': 'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/',
            'temperature': 'https://doi.org/10.17189/kwez-jq47',
        },
        'kmPerSol': KM_PER_SOL, 'nodes': nodes, 'corridors': corridors,
    }, separators=(',', ':')))
    print(f'{len(corridors)} corridors -> {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)')


if __name__ == '__main__':
    main()
