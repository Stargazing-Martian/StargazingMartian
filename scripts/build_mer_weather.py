#!/usr/bin/env python3
"""Package NASA MER Pancam 440 nm opacity without inventing missing observations.

Rebuild dependency only: spiceypy==8.4.0. The deployed app needs no new service.
Run with --download once; subsequent builds work from the ignored source cache.
"""
import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import re
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://pds-geosciences.wustl.edu/mer/mer1_mer2-m-pancam-5-atmos-opacity-v1/merao_1xxx/data/'
SCLK = 'https://naif.jpl.nasa.gov/pub/naif/MER/kernels/sclk/'
LSK = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls'
MISSIONS = [('spirit', '2tau440_2209_20110214a', 'mer2.tsc', -254, 4391),
            ('opportunity', '1tau440_5106_20181207a', 'mer1.tsc', -253, 8697)]
FIELDS = ['productId', 'sol', 'localTimeSol', 'solarLongitude', 'opacity', 'relativeError', 'utc']
NS = {'p': 'http://pds.nasa.gov/pds4/pds/v1'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def parse_row(row, prefix):
    if len(row) != 8 or not re.fullmatch(prefix + r'P\d{9}[A-Z0-9#]{16}', row[0].strip()):
        raise ValueError('Unexpected Pancam record identity/layout')
    identifier = row[0].strip()
    ls, distance, local, airmass, flux, opacity, error = map(float, row[1:])
    if not all(math.isfinite(v) for v in (ls, distance, local, airmass, flux, opacity, error)):
        raise ValueError('Non-finite Pancam value')
    if any(v == -1 for v in (flux, opacity, error)):
        return None  # NASA's explicit non-measurement sentinel; zero remains valid.
    if local <= 0 or opacity < 0 or error < 0 or flux < 0 or airmass <= 0:
        raise ValueError('Invalid Pancam measurement')
    return [identifier, math.ceil(local), local, ls, opacity, error]


def retrieve(url, cache, download):
    path = cache / url.rsplit('/', 1)[-1]
    if not path.exists():
        if not download:
            raise FileNotFoundError(f'{path}; rerun with --download')
        with urllib.request.urlopen(url, timeout=45) as response:
            raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError('Unexpected source size')
        path.write_bytes(raw)
    return path


def convert_clock(spice, identifier, spacecraft, start, stop):
    # Product names retain integer SCLK seconds, not image subsecond timing.
    et = spice.scs2e(spacecraft, '1/' + identifier[2:11] + '.000')
    if not start <= et <= stop:
        return None  # Never extrapolate beyond the kernel's declared applicability.
    return spice.et2utc(et, 'ISOC', 0) + 'Z'


def build(cache, output, download):
    import spiceypy as spice
    cache.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    leap = retrieve(LSK, cache, download)
    manifest = {'schemaVersion': 1, 'quantity': 'Pancam atmospheric opacity', 'wavelengthNm': 440,
                'fields': FIELDS, 'products': []}
    for mission, stem, kernel_name, spacecraft, expected in MISSIONS:
        table = retrieve(BASE + stem + '.tab', cache, download)
        label = retrieve(BASE + stem + '.xml', cache, download)
        kernel = retrieve(SCLK + kernel_name, cache, download)
        tree = ET.parse(label)
        lid = tree.findtext('./p:Identification_Area/p:logical_identifier', namespaces=NS)
        version = tree.findtext('./p:Identification_Area/p:version_id', namespaces=NS)
        count = int(tree.findtext('.//p:Table_Delimited/p:records', namespaces=NS))
        if count != expected or lid != 'urn:nasa:pds:mer_pancam_derived_opacity:data:' + stem:
            raise ValueError('Unexpected NASA label identity/count')
        text = table.read_text('ascii')
        if '440-nm' not in text.splitlines()[0] or f'N_ENTRIES = {expected}' not in text:
            raise ValueError('Wrong wavelength or record count')
        rows = list(csv.reader(io.StringIO('\n'.join(text.splitlines()[9:]))))
        if len(rows) != expected:
            raise ValueError('Truncated NASA table')
        kernel_text = kernel.read_text('ascii')
        start, stop = [re.search('APPLICABLE-' + key + r'-TIME=([^;]+);', kernel_text)[1]
                       for key in ('START', 'STOP')]
        spice.kclear()
        spice.furnsh(str(leap))
        spice.furnsh(str(kernel))
        bounds = (spice.str2et(start), spice.str2et(stop))
        observations, rejected = [], 0
        for row in rows:
            record = parse_row(row, stem[0])
            if record is None:
                rejected += 1
                continue
            observations.append(record + [convert_clock(spice, record[0], spacecraft, *bounds)])
        observations.sort(key=lambda r: (r[1], r[2], r[0]))
        missing_utc = sum(row[-1] is None for row in observations)
        metadata = {
            'schemaVersion': 1, 'id': mission, 'wavelengthNm': 440, 'fields': FIELDS,
            'lidvid': lid + '::' + version, 'sourceUrl': BASE + stem + '.tab',
            'labelUrl': BASE + stem + '.xml', 'sourceSha256': digest(table), 'labelSha256': digest(label),
            'sourceRecords': expected, 'excludedNonMeasurements': rejected,
            'validRecords': len(observations), 'utcUnavailableRecords': missing_utc,
            'firstSol': min(r[1] for r in observations), 'lastSol': max(r[1] for r in observations),
            'solConvention': 'ceil(NASA local_time); noon of Sol 2 is 1.5',
            'position': None,
            'timeConversion': {
                'method': 'SPICE scs2e / et2utc; integer product-ID SCLK, partition 1, fraction 0',
                'precision': 'Approximate clock-derived UTC; subsecond timing absent. Archive endpoints differ by 1–6 s.',
                'spiceypyVersion': spice.__version__, 'spacecraft': spacecraft,
                'sclkUrl': SCLK + kernel_name, 'sclkSha256': digest(kernel),
                'leapSecondsUrl': LSK, 'leapSecondsSha256': digest(leap),
                'applicableStart': spice.et2utc(bounds[0], 'ISOC', 3) + 'Z',
                'applicableStop': spice.et2utc(bounds[1], 'ISOC', 3) + 'Z',
            },
            'absoluteCalibrationErrorAtAirmass1': 0.03,
        }
        raw = (json.dumps({**metadata, 'observations': observations}, separators=(',', ':'), allow_nan=False) + '\n').encode()
        filename = mission + '.json'
        (output / filename).write_bytes(raw)
        manifest['products'].append({**metadata, 'file': filename, 'sha256': hashlib.sha256(raw).hexdigest()})
        print(f'{mission}: {len(observations)} valid, {rejected} non-measurements, {missing_utc} without applicable UTC; {len(raw)} bytes')
    spice.kclear()
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--cache', type=Path, default=ROOT / '.cache/nasa-mer-weather')
    parser.add_argument('--output', type=Path, default=ROOT / 'data/science/mer-weather')
    args = parser.parse_args()
    build(args.cache, args.output, args.download)
