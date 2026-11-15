"""Build data/routes/<mission>.json from NASA rover traverse files.

Usage: python3 scripts/build_routes.py [raw_dir]

Downloads each source into raw_dir (default: ./.cache/raw-routes) if it is
missing, converts it to [lon, lat, sol] points (east-positive degrees, sol may
be null), smooths it, thins it with Douglas-Peucker and writes compact JSON.
"""
import csv, json, math, sys, urllib.request
from pathlib import Path

MARS_RADIUS = 3396190.0
TOLERANCE_M = 1.5  # max deviation kept when thinning the smoothed line
STEP_M = 10.0      # resampling interval before smoothing
SIGMA_M = 60.0     # smoothing strength (Gaussian sigma, metres)
OUT = Path(__file__).resolve().parent.parent / 'data' / 'routes'

SOURCES = {
    'perseverance': 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json',
    'curiosity': 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_traverse.json',
    'spirit': 'https://an.rsl.wustl.edu/mera/AN/meri/MER/traverse/MERA_traverse.csv',
    'opportunity': 'https://an.rsl.wustl.edu/mera/AN/meri/MER/traverse/MERB_traverse_5130.csv',
}
# MSL_traverse.json has no sol; each drive's end point matches a waypoint.
MSL_WAYPOINTS = 'https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json'
# Rover attitude (tilt) at every drive end: used as a terrain-slope proxy.
WAYPOINTS = {
    'perseverance': 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json',
    'curiosity': MSL_WAYPOINTS,
}

# Difficulty for an astronaut on foot: 'easy' | 'medium' | 'hard'.
# Where the rover logged its tilt, the 90th-percentile tilt of the segment
# sets the level. Spirit and Opportunity logged no tilt, so their level comes
# from terrain notes and incidents in the mission record. A note can only
# raise a level, never lower it.
TILT_MEDIUM = 9.0   # degrees, p90 tilt
TILT_HARD = 15.0
NOTES = {
    'curiosity': {
        'Rapid Transit to Mount Sharp': ('medium', 'Sharp, embedded rocks punctured Curiosity\'s wheels here, and the Hidden Valley sand trap forced a detour.'),
    },
    'opportunity': {
        'Eagle and Endurance Craters': ('medium', 'Steep inner slopes of Endurance crater.'),
        'Meridiani Plains and Purgatory': ('medium', 'Flat plains, but a loose sand ripple ("Purgatory") trapped Opportunity for five weeks.'),
        'Victoria Crater': ('medium', 'Opportunity drove down into Victoria crater and back out along its slopes.'),
        'Trek to Endeavour': ('easy', 'Long, flat plains crossing between sand ripples.'),
        'Endeavour Rim': ('hard', 'Steep crater-rim slopes; Opportunity\'s steepest drives were here.'),
    },
    'spirit': {
        'Gusev Plains and Bonneville': ('easy', 'Flat, rocky plains around Bonneville crater.'),
        'Columbia Hills': ('medium', 'Long climb up Husband Hill over rocky slopes.'),
        'Home Plate and Troy': ('hard', 'Spirit broke through a crust into soft sand at Troy and never got out.'),
    },
}
LEVELS = ['easy', 'medium', 'hard']

# Science phases: (first sol, name). Sol boundaries are approximate, taken
# from mission campaign summaries; a phase runs until the next one starts.
PHASES = {
    'perseverance': [
        (0, 'Crater Floor'),
        (415, 'Delta Front'),
        (707, 'Upper Fan'),
        (910, 'Margin Unit'),
        (1240, 'Crater Rim'),
    ],
    'curiosity': [
        (0, 'Bradbury Landing to Yellowknife Bay'),
        (330, 'Rapid Transit to Mount Sharp'),
        (750, 'Pahrump Hills and Murray Formation'),
        (1300, 'Bagnold Dunes to Vera Rubin Ridge'),
        (2300, 'Glen Torridon'),
        (3070, 'Sulfate Unit and Gediz Vallis'),
    ],
    'opportunity': [
        (0, 'Eagle and Endurance Craters'),
        (315, 'Meridiani Plains and Purgatory'),
        (950, 'Victoria Crater'),
        (1630, 'Trek to Endeavour'),
        (2681, 'Endeavour Rim'),
    ],
    'spirit': [
        (0, 'Gusev Plains and Bonneville'),
        (156, 'Columbia Hills'),
        (700, 'Home Plate and Troy'),
    ],
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


def from_msl(path, waypoints_path):
    """Curiosity: give every drive the sol of the waypoint at its end point."""
    waypoints = [(f['properties']['lon'], f['properties']['lat'], f['properties']['sol'])
                 for f in json.loads(waypoints_path.read_text())['features']]
    points = []
    for feature in json.loads(path.read_text())['features']:
        geometry = feature['geometry']
        lines = [geometry['coordinates']] if geometry['type'] == 'LineString' else geometry['coordinates']
        lon, lat = lines[-1][-1][:2]
        sol = min(waypoints, key=lambda w: (w[0] - lon) ** 2 + (w[1] - lat) ** 2)[2]
        for line in lines:
            for lon, lat, *_ in line:
                points.append([lon, lat, sol])
    return points


def split_phases(points, phases, full):
    """Index ranges per phase into points. Neighbouring segments share their
    boundary point so the drawn line stays continuous. Lengths are measured
    on the full-resolution line, as smoothing shortens it."""
    starts = []
    for first_sol, name in phases:
        index = next((i for i, p in enumerate(points) if p[2] >= first_sol), None)
        if index is not None and (not starts or index > starts[-1][0]):
            starts.append((index, name))
    segments = []
    for k, (start, name) in enumerate(starts):
        end = starts[k + 1][0] if k + 1 < len(starts) else len(points) - 1
        first = next(i for i, p in enumerate(full) if p[2] >= points[start][2])
        last = (next(i for i, p in enumerate(full) if p[2] >= points[end][2])
                if k + 1 < len(starts) else len(full) - 1)
        segments.append({'name': name, 'from': start, 'to': end,
                         # The first phase starts at landing (sol 0); the data's
                         # first logged drive can be much later.
                         'sols': [0 if k == 0 else points[start][2], points[end][2]],
                         'lengthKm': round(length_km(full[first:last + 1]), 2)})
    return segments


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


def smooth(points, step_m, sigma_m):
    """Resample every step_m metres, then Gaussian-smooth the positions.

    Rover drives are logged as many short, slightly zig-zagging legs; on the
    map that reads as a jagged line. Sol is carried from the nearest
    preceding original point. The first and last points stay fixed.
    """
    xy = to_metres(points)
    samples, carry, step = [], 0.0, step_m
    for (a, b), p in zip(zip(xy, xy[1:]), points):
        seg = math.dist(a, b)
        while carry <= seg:
            t = carry / seg if seg else 0
            samples.append((a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), p[2]))
            carry += step
        carry -= seg
    samples.append((*xy[-1], points[-1][2]))

    radius = int(3 * sigma_m / step_m)
    weights = [math.exp(-0.5 * (i * step_m / sigma_m) ** 2) for i in range(-radius, radius + 1)]
    out = []
    for i in range(len(samples)):
        # Shrink the window near the ends so the endpoints do not move.
        r = min(radius, i, len(samples) - 1 - i)
        sx = sy = sw = 0.0
        for j in range(-r, r + 1):
            w = weights[j + radius]
            sx += w * samples[i + j][0]
            sy += w * samples[i + j][1]
            sw += w
        out.append((sx / sw, sy / sw, samples[i][2]))

    lat0 = math.radians(points[0][1])
    k = math.pi / 180 * MARS_RADIUS
    return [[round(x / (k * math.cos(lat0)), 6), round(y / k, 6), sol] for x, y, sol in out]


def length_km(points):
    xy = to_metres(points)
    return sum(math.dist(a, b) for a, b in zip(xy, xy[1:])) / 1000


def score_segments(mission, segments, waypoints):
    """Adds difficulty, its basis, reasons and metrics to each segment."""
    starts = [seg['sols'][0] for seg in segments] + [math.inf]
    for k, seg in enumerate(segments):
        level, reasons, seg['basis'] = 'easy', [], 'mission-record'
        if waypoints:
            inside = [w for w in waypoints if starts[k] <= w['sol'] < starts[k + 1] and w.get('tilt') is not None]
            tilts = sorted(w['tilt'] for w in inside)
            elevations = [w['elev_geoid'] for w in inside]
            p90 = tilts[int(len(tilts) * 0.9)]
            climb = sum(max(0, b - a) for a, b in zip(elevations, elevations[1:]))
            seg['metrics'] = {'tiltP90': round(p90, 1), 'tiltMax': round(tilts[-1], 1), 'climbM': round(climb)}
            seg['basis'] = 'rover-tilt'
            level = 'hard' if p90 >= TILT_HARD else 'medium' if p90 >= TILT_MEDIUM else 'easy'
            reasons.append(f'Rover tilt: {p90:.1f}° on 90% of stops (max {tilts[-1]:.1f}°); {climb:.0f} m of total climb.')
        note = NOTES.get(mission, {}).get(seg['name'])
        if note:
            level = max(level, note[0], key=LEVELS.index)
            reasons.append(note[1])
        seg['difficulty'] = level
        seg['reasons'] = reasons


def main():
    raw_dir = Path(sys.argv[1] if len(sys.argv) > 1 else '.cache/raw-routes')
    raw_dir.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    readers = {
        'perseverance': from_mmgis,
        'curiosity': lambda p: from_msl(p, fetch(MSL_WAYPOINTS, raw_dir)),
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
        # Sols only ever go forward along a traverse.
        latest = 0
        for p in cleaned:
            latest = p[2] = max(latest, p[2] or 0)
        thinned = simplify(smooth(cleaned, STEP_M, SIGMA_M), TOLERANCE_M)
        data = {'mission': mission, 'source': url, 'lengthKm': round(length_km(cleaned), 2),
                'segments': split_phases(thinned, PHASES[mission], cleaned), 'points': thinned}
        waypoints = WAYPOINTS.get(mission) and [
            f['properties'] for f in json.loads(fetch(WAYPOINTS[mission], raw_dir).read_text())['features']]
        score_segments(mission, data['segments'], waypoints)
        (OUT / f'{mission}.json').write_text(json.dumps(data, separators=(',', ':')))
        print(f'{mission}: {len(cleaned)} -> {len(thinned)} points, {data["lengthKm"]} km')
        for segment in data['segments']:
            print(f"  {segment['name']}: sol {segment['sols'][0]}-{segment['sols'][1]}, "
                  f"{segment['lengthKm']} km, {segment['difficulty']} ({segment['basis']})")


if __name__ == '__main__':
    main()
