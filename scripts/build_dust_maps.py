#!/usr/bin/env python3
"""Build a small, reproducible NASA PDS TES map collection. Standard library only.

The selected files are historical examples, not continuous daily coverage.
No interpolation, temporal extrapolation, or missing-value filling is applied.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://atmos.nmsu.edu/PDS/data/PDS4/mgs_tes_atmos_dust-ice/data_IR_Dust_Optical_Depth_Maps/'
PRODUCTS = [
    'MY25/month_02/TES_CDODMAP_IR_MY25_SOY100',
    'MY25/month_08/TES_CDODMAP_IR_MY25_SOY400',
    'MY26/month_11/TES_CDODMAP_IR_MY26_SOY611',
    'MY26/month_12/TES_CDODMAP_IR_MY26_SOY631',
    'MY26/month_12/TES_CDODMAP_IR_MY26_SOY665',
    'MY27/month_01/TES_CDODMAP_IR_MY27_SOY027',
    'MY27/month_01/TES_CDODMAP_IR_MY27_SOY056',
    'MY27/month_02/TES_CDODMAP_IR_MY27_SOY086',
    'MY27/month_03/TES_CDODMAP_IR_MY27_SOY115',
    'MY27/month_03/TES_CDODMAP_IR_MY27_SOY145',
    'MY27/month_04/TES_CDODMAP_IR_MY27_SOY168',
]
FIELDS = ['CDODNUM', 'CDODTW', 'CDODREL', 'CDOD610', 'CDOD610UNC',
          'CDOD610RMSD', 'CDODTOT', 'CDODTOTUNC']
NS = {'p': 'http://pds.nasa.gov/pds4/pds/v1'}


def read_source(product, extension, cache, download):
    path = cache / (product.rsplit('/', 1)[1] + '.' + extension)
    if not path.exists():
        if not download:
            raise FileNotFoundError(f'{path}: rerun with --download')
        with urllib.request.urlopen(BASE + product + '.' + extension, timeout=30) as response:
            data = response.read(2_000_001)
        if len(data) > 2_000_000:
            raise ValueError('Unexpectedly large PDS product')
        path.write_bytes(data)
    return path.read_bytes()


def convert(product, cache, download):
    raw = read_source(product, 'dat', cache, download)
    label = read_source(product, 'xml', cache, download)
    ancillary = read_source(product, 'txt', cache, download)
    tree = ET.fromstring(label)
    def field(path):
        return tree.find(path, NS).text
    area = './p:File_Area_Observational/'
    if int(field(area + 'p:File/p:file_size')) != len(raw):
        raise ValueError(f'{product}: source byte count does not match PDS label')
    lines = raw.decode('ascii').splitlines()
    if lines[0].split() != ['LON', 'LAT'] + FIELDS:
        raise ValueError(f'{product}: unexpected columns')
    records = [list(map(float, row.split())) for row in lines[1:]]
    if len(records) != 3600 or int(field(area + 'p:Table_Character/p:records')) != 3600:
        raise ValueError(f'{product}: expected 60 x 60 records')
    for index, row in enumerate(records):
        if len(row) != 10 or row[:2] != [-180 + 6 * (index % 60), 88.5 - 3 * (index // 60)]:
            raise ValueError(f'{product}: unexpected grid order at {index}')
        missing = row[5] == -999.99
        if any((v in (-999, -999.99)) != missing for v in row[2:]):
            raise ValueError(f'{product}: inconsistent missing-value masks')
        if not missing and (row[2] < 1 or row[3] not in (1, 3, 5, 7)
                            or not 0 <= row[4] <= 1 or row[6] < 0 or row[9] < 0):
            raise ValueError(f'{product}: invalid quality metadata')
    time = ancillary.decode('ascii').splitlines()[1].split()
    start = field('./p:Observation_Area/p:Time_Coordinates/p:start_date_time')
    end = field('./p:Observation_Area/p:Time_Coordinates/p:stop_date_time')
    if time[:2] != [start, end]:
        raise ValueError(f'{product}: inconsistent observation intervals')
    identifier = field('./p:Identification_Area/p:logical_identifier')
    version = field('./p:Identification_Area/p:version_id')
    metadata = {
        'id': identifier.rsplit(':', 1)[-1], 'lidvid': identifier + '::' + version,
        'marsYear': int(time[2]), 'solOfYear': int(time[3]), 'solarLongitude': float(time[4]),
        'observationStart': start, 'observationEnd': end,
        'validCount': sum(row[5] != -999.99 for row in records),
        'sourceUrl': BASE + product + '.dat', 'labelUrl': BASE + product + '.xml',
        'ancillaryUrl': BASE + product + '.txt',
        'sourceSha256': hashlib.sha256(raw).hexdigest(),
        'labelSha256': hashlib.sha256(label).hexdigest(),
    }
    arrays = {name: [None if row[5] == -999.99 else row[i + 2] for row in records]
              for i, name in enumerate(FIELDS)}
    return metadata, {'schemaVersion': 1, **metadata, 'fields': arrays}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true', help='download missing public NASA products')
    parser.add_argument('--cache', type=Path, default=ROOT / '.cache/nasa-tes-dust')
    parser.add_argument('--output', type=Path, default=ROOT / 'data/science/tes-dust')
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        converted = list(pool.map(lambda p: convert(p, args.cache, args.download), PRODUCTS))
    entries = []
    for metadata, product in converted:
        filename = metadata['id'] + '.json'
        encoded = (json.dumps(product, separators=(',', ':'), allow_nan=False) + '\n').encode()
        (args.output / filename).write_bytes(encoded)
        entries.append({**metadata, 'file': filename, 'sha256': hashlib.sha256(encoded).hexdigest()})
    manifest = {
        'schemaVersion': 1, 'name': 'NASA MGS/TES historical atmospheric dust',
        'doi': '10.17189/kwez-jq47',
        'citation': 'Montabone, L., Smith, M., Wolff, M., and Cantor, B. (2023). Mars Global Surveyor (MGS) Thermal Emission Spectrometer (TES) Atmospheric Column Optical Depths for Dust and Water Ice Bundle. NASA Planetary Data System.',
        'documentationUrl': 'https://atmos.nmsu.edu/PDS/data/PDS4/mgs_tes_atmos_dust-ice/document/user_guide_TES_COD.pdf',
        'grid': {'width': 60, 'height': 60, 'longitudeStart': -180, 'latitudeStart': 88.5,
                 'longitudeStep': 6, 'latitudeStep': -3, 'coordinateSystem': 'planetocentric, east-positive'},
        'quantity': {'field': 'CDOD610', 'uncertaintyField': 'CDOD610UNC', 'wavelengthMicrons': 9.3,
                     'referencePressurePa': 610, 'unit': 'dimensionless'},
        'selection': 'Eleven curated examples; not continuous daily coverage. Observation intervals can span seven sols.',
        'defaultProduct': 'my26_soy631', 'products': entries,
    }
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Validated and built {len(entries)} NASA products in {args.output}')


if __name__ == '__main__':
    main()
