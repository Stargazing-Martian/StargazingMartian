#!/usr/bin/env python3
"""Bin published NASA TES TSURF retrievals into explicit historical daytime maps.

These are Stargazing-derived regional means, not NASA-issued temperature maps.
No interpolation, extrapolation, atmospheric-temperature substitution or
instrument uncertainty estimate is performed. Standard library only.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://atmos.nmsu.edu/PDS/data/PDS4/mgs_tes_atmos_dust-ice/data_IR_Aerosol_Optical_Depth/'
SELECTIONS = [
    ('surface-2004-01', 'MY26/TES_COD_IR_MY26_Ls330_Ls360', '2004-01-22T13:41:18Z', '2004-01-29T17:10:44Z'),
    ('surface-2004-04', 'MY27/TES_COD_IR_MY27_Ls000_Ls030', '2004-03-29T09:12:32Z', '2004-04-05T10:26:46Z'),
    ('surface-2004-08', 'MY27/TES_COD_IR_MY27_Ls060_Ls090', '2004-07-28T13:57:04Z', '2004-08-04T17:19:22Z'),
]
HEADER = 'SCLK OCK UTC LON LAT L_S LTST IR_CDOD IR_CDOD_UNC IR_CWIOD TSURF SPEC PSURF'.split()
NS = {'p': 'http://pds.nasa.gov/pds4/pds/v1'}
FIELDS = ['MEAN_K', 'MIN_K', 'MAX_K', 'STD_K', 'COUNT', 'LTST_MEAN', 'LTST_MIN',
          'LTST_MAX', 'FIRST_UTC', 'LAST_UTC']


def timestamp(text):
    return int(datetime.fromisoformat(text.replace('Z', '+00:00')).timestamp())


def aggregate(rows, start, end):
    """Unweighted mean of available published retrievals in each nearest cell.

    STD_K is sample spread (n-1), not instrument error or independent-sample SE.
    Adjacent retrievals can be spatially/temporally correlated.
    """
    bins = [None] * 3600
    selected = rejected = 0
    for values in rows:
        if len(values) != 13:
            raise ValueError('Unexpected TES record layout')
        utc = values[2]
        if not start <= utc <= end:
            continue
        lon, lat, ltst, kelvin = (float(values[i]) for i in (3, 4, 6, 10))
        spec = int(values[11])
        if not (all(math.isfinite(v) for v in (lon, lat, ltst, kelvin)) and
                0 <= lon <= 360 and -90 <= lat <= 90 and kelvin > 0 and
                13 <= ltst < 15 and spec in (10, 11, 20, 21)):
            rejected += 1
            continue
        selected += 1
        column = math.floor(((lon + 183) % 360) / 6)
        row = min(59, math.floor((90 - lat) / 3))
        index = row * 60 + column
        time = timestamp(utc)
        b = bins[index]
        if b is None:
            bins[index] = [1, kelvin, 0.0, kelvin, kelvin, ltst, ltst, ltst, time, time]
        else:
            b[0] += 1
            delta = kelvin - b[1]
            b[1] += delta / b[0]
            b[2] += delta * (kelvin - b[1])
            b[3], b[4] = min(b[3], kelvin), max(b[4], kelvin)
            b[5] += (ltst - b[5]) / b[0]
            b[6], b[7] = min(b[6], ltst), max(b[7], ltst)
            b[8], b[9] = min(b[8], time), max(b[9], time)
    fields = {name: [] for name in FIELDS}
    for b in bins:
        values = ([None] * 10 if b is None else
                  [round(b[1], 2), round(b[3], 2), round(b[4], 2),
                   round(math.sqrt(max(0, b[2] / (b[0] - 1))), 2) if b[0] > 1 else None,
                   b[0], round(b[5], 4), round(b[6], 4), round(b[7], 4), b[8], b[9]])
        for name, value in zip(FIELDS, values):
            fields[name].append(value)
    return fields, selected, rejected


def retrieve(url, path, limit, download):
    if not path.exists():
        if not download:
            raise FileNotFoundError(f'{path}: rerun with --download')
        temporary = path.with_suffix(path.suffix + '.part')
        size = 0
        with urllib.request.urlopen(url, timeout=45) as response, temporary.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    raise ValueError('NASA source exceeds expected size')
                output.write(chunk)
        temporary.replace(path)
    return path


def build(selection, cache, download):
    identifier, source, start, end = selection
    stem = source.rsplit('/', 1)[-1]
    label = retrieve(BASE + source + '.xml', cache / (stem + '.xml'), 100_000, download)
    tree = ET.parse(label)
    def text(path):
        return tree.find(path, NS).text
    area = './p:File_Area_Observational/'
    expected_size = int(text(area + 'p:File/p:file_size'))
    if expected_size > 120_000_000:
        raise ValueError('Unexpectedly large TES product')
    source_start = text('./p:Observation_Area/p:Time_Coordinates/p:start_date_time')
    source_end = text('./p:Observation_Area/p:Time_Coordinates/p:stop_date_time')
    if not source_start <= start < end <= source_end:
        raise ValueError('Requested interval is outside source coverage')
    temperature = tree.find('.//p:Field_Character[p:field_number="11"]', NS)
    if temperature.find('p:unit', NS).text != 'Kelvin' or temperature.find('p:name', NS).text != 'Surface temperature':
        raise ValueError('TSURF metadata has changed')
    raw = retrieve(BASE + source + '.dat', cache / (stem + '.dat'), expected_size, download)
    if raw.stat().st_size != expected_size:
        raise ValueError(f'{raw}: source byte count differs from PDS label')
    digest = hashlib.sha256()
    count = 0
    def rows():
        nonlocal count
        with raw.open('rb') as handle:
            header = handle.readline()
            digest.update(header)
            if header.decode('ascii').split() != HEADER:
                raise ValueError('Unexpected TES header')
            for line in handle:
                digest.update(line)
                count += 1
                # UTC is fixed-width in the PDS label. Parse full records only
                # inside the requested period; still count/hash the entire file.
                if start <= line[16:36].decode('ascii') <= end:
                    yield line.decode('ascii').split()
    fields, selected, rejected = aggregate(rows(), start, end)
    if count != int(text(area + 'p:Table_Character/p:records')):
        raise ValueError('TES source row count differs from PDS label')
    valid = sum(value is not None for value in fields['MEAN_K'])
    if not valid:
        raise ValueError('No valid daytime surface observations')
    metadata = {
        'id': identifier, 'selectionStart': start, 'selectionEnd': end,
        'observationStart': datetime.fromtimestamp(min(v for v in fields['FIRST_UTC'] if v is not None),
                                                  timezone.utc).isoformat().replace('+00:00', 'Z'),
        'observationEnd': datetime.fromtimestamp(max(v for v in fields['LAST_UTC'] if v is not None),
                                                timezone.utc).isoformat().replace('+00:00', 'Z'),
        'sourceLidvid': text('./p:Identification_Area/p:logical_identifier') + '::' + text('./p:Identification_Area/p:version_id'),
        'sourceUrl': BASE + source + '.dat', 'labelUrl': BASE + source + '.xml',
        'sourceSha256': digest.hexdigest(), 'labelSha256': hashlib.sha256(label.read_bytes()).hexdigest(),
        'sourceRecords': count, 'selectedRetrievals': selected, 'rejectedInWindow': rejected,
        'validCount': valid, 'localTimeStart': 13, 'localTimeEndExclusive': 15,
        'measurementUncertaintyK': None,
        'derivation': 'Stargazing unweighted spatial-bin mean of published TES TSURF retrievals; no interpolation',
    }
    print(f'{identifier}: {selected} retrievals, {valid}/3600 populated bins', flush=True)
    return metadata, {'schemaVersion': 1, **metadata, 'fields': fields}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--cache', type=Path, default=ROOT / '.cache/nasa-tes-temperature')
    parser.add_argument('--output', type=Path, default=ROOT / 'data/science/tes-temperature')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=3) as pool:
        products = list(pool.map(lambda item: build(item, args.cache, args.download), SELECTIONS))
    entries = []
    for metadata, product in products:
        filename = metadata['id'] + '.json'
        raw = (json.dumps(product, separators=(',', ':'), allow_nan=False) + '\n').encode()
        (args.output / filename).write_bytes(raw)
        entries.append({**metadata, 'file': filename, 'sha256': hashlib.sha256(raw).hexdigest()})
    manifest = {
        'schemaVersion': 1, 'name': 'Historical daytime TES surface temperature — Stargazing derived',
        'doi': '10.17189/kwez-jq47',
        'documentationUrl': 'https://atmos.nmsu.edu/PDS/data/PDS4/mgs_tes_atmos_dust-ice/document/user_guide_TES_COD.pdf',
        'grid': {'width': 60, 'height': 60, 'longitudeStart': -180, 'latitudeStart': 88.5,
                 'longitudeStep': 6, 'latitudeStep': -3, 'coordinateSystem': 'planetocentric, east-positive'},
        'quantity': {'sourceField': 'TSURF', 'field': 'MEAN_K', 'unit': 'Kelvin', 'displayUnit': 'Celsius',
                     'measurementUncertaintyK': None, 'spreadField': 'STD_K'},
        'defaultProduct': entries[0]['id'], 'products': entries,
    }
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Built {len(entries)} temperature maps in {args.output}', flush=True)


if __name__ == '__main__':
    main()
