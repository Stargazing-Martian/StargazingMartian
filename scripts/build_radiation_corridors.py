"""Offline radiation-aware corridor variants; no browser pathfinding.
Requires numpy, scipy, scikit-image. Run after exporting static terrain.
"""
import json
import numpy as np
from build_corridors import build_cost, links, least_cost_path, describe, DESTINATIONS, OUT, ROOT, KM_PER_SOL, haversine_km
from build_route_surfaces import densify, sample, TERRAIN


def proxy(height, model):
    columns = model['referenceColumnGcm2'] * np.exp(-height / model['scaleHeightM'])
    xs, ys = model['pathColumnGcm2'], model['tableEffectiveDoseCsvDay']
    if np.any((columns < xs[0]) | (columns > xs[-1])):
        raise ValueError('Out of model domain; no extrapolation allowed')
    return np.interp(columns, xs, ys) / np.interp(model['referenceColumnGcm2'], xs, ys)


def integral(m, cells, field):
    total = 0
    for a, b in zip(cells, cells[1:]):
        length = haversine_km((m['lats'][a[0]], m['lons'][a[1]]), (m['lats'][b[0]], m['lons'][b[1]]))
        total += length * (field[a] + field[b]) / 2
    return float(total)


def main():
    model = json.loads((ROOT / 'data/science/radiation/model.json').read_text())
    m = build_cost()
    field = proxy(m['z'], model)
    weighted = {**m, 'cost': m['cost'] + model['routingWeight'] * field}
    version = json.loads((TERRAIN / 'layer.json').read_text())['version']
    corridors = []
    for i, j in links():
        a, b = DESTINATIONS[i], DESTINATIONS[j]
        variants = {}
        for policy, costs in [('baseline', m), ('radiation', weighted)]:
            cells = least_cost_path(costs, a[2:4], b[2:4])
            info = describe(m, cells)
            # Exact destination coordinates, followed by the actual cost-grid
            # cell centres. Connectors are display/planning segments, not surveys.
            info['points'] = [[a[3], a[2]], *info['points'], [b[3], b[2]]]
            drawing, _ = densify(info['points'], spacing=2000)
            heights = sample(drawing)
            info['render'] = {'terrainVersion': version, 'points': [[*p, round(float(h), 3)] for p, h in zip(drawing, heights)]}
            info['radiationProxyKm'] = round(integral(m, cells, field), 3)
            info['policy'] = policy
            variants[policy] = info
        corridors.append({'id': f'{a[0]}--{b[0]}', 'from': a[0], 'to': b[0], **variants['baseline'],
                          'baselineProxyKm': variants['baseline']['radiationProxyKm'],
                          'baselineLengthKm': variants['baseline']['lengthKm'], 'radiationAware': variants['radiation']})
        print(corridors[-1]['id'], variants['baseline']['lengthKm'], '->', variants['radiation']['lengthKm'], flush=True)
    OUT.write_text(json.dumps({'about': 'Coarse 7.4km expedition scenarios, not verified safe routes. Source vertices are not smoothed.',
        'radiationModel': model['id'], 'sources': {'topography': 'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/',
        'radiation': model['source'], 'temperature': 'https://doi.org/10.17189/kwez-jq47'},
        'kmPerSol': KM_PER_SOL, 'nodes': [{'id': d[0], 'name': d[1], 'lat': d[2], 'lon': d[3], 'kind': d[4], 'summary': d[5]} for d in DESTINATIONS],
        'corridors': corridors}, separators=(',', ':'), allow_nan=False))
    print(OUT.stat().st_size, 'bytes', flush=True)


if __name__ == '__main__':
    main()
