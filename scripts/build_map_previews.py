"""Small preview images for the map-mode picker: assets/previews/*.png

Usage: .cache/venv/bin/python scripts/build_map_previews.py
(needs numpy; the MOLA DEM is cached in .cache/mola by build_corridors.py)

  terrain.png      MOLA MEGDR topography, hillshaded, in Mars tones
  topography.png   MOLA heights in the globe's elevation colour ramp
  radiation.png    the GCR shielding proxy (data/science/radiation/model.json)
                   from MOLA heights, in the radiation map's colours
  dust.png         TES dust optical depth (same colour scale as the map)
  temperature.png  TES daytime surface temperature (same colour scale)
"""
import json, struct, zlib
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'previews'
W, H = 360, 180  # 1 px per degree, equirectangular, -180..180 east

DUST_STOPS = [(0, (0, 34, 78)), (.25, (67, 78, 108)), (.5, (124, 123, 120)),
              (.75, (188, 173, 108)), (1, (255, 233, 69))]
TEMPERATURE_STOPS = [(0, (20, 20, 70)), (.25, (53, 86, 160)), (.5, (79, 170, 183)),
                     (.75, (245, 164, 63)), (1, (255, 65, 28))]
DUST_FILE = 'my25_soy400.json'         # 2001 global dust storm season
TEMPERATURE_FILE = 'surface-2004-04.json'


def write_png(path, rgb):
    h, w, _ = rgb.shape
    raw = b''.join(b'\x00' + rgb[y].astype(np.uint8).tobytes() for y in range(h))
    chunk = lambda tag, data: (struct.pack('>I', len(data)) + tag + data
                               + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
                     + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def ramp(values, stops):
    out = np.zeros(values.shape + (3,))
    for (a, ca), (b, cb) in zip(stops, stops[1:]):
        t = np.clip((values - a) / (b - a), 0, 1)[..., None]
        inside = ((values >= a) & (values <= b))[..., None]
        out = np.where(inside, np.array(ca) + (np.array(cb) - np.array(ca)) * t, out)
    return out


def blur(a, passes=3):
    for _ in range(passes):
        a = (np.roll(a, 1, 1) + a + np.roll(a, -1, 1)) / 3
        a = (np.roll(a, 1, 0) + a + np.roll(a, -1, 0)) / 3
    return a


def grid_to_image(values):
    """TES 6° x 3° grid (row 0 = 88.5°N; column c centred on -180 + 6c) -> 360x180."""
    grid = np.array([np.nan if v is None else v for v in values], dtype=float).reshape(60, 60)
    lats = 89.5 - np.arange(H)
    lons = -179.5 + np.arange(W)
    rows = np.clip(((90 - lats) // 3).astype(int), 0, 59)
    cols = ((((lons + 183) % 360) // 6).astype(int)) % 60
    return grid[rows[:, None], cols[None, :]]


TOPO_STOPS = [(0, (0x17, 0x2b, 0x70)), (.2, (0x39, 0x8d, 0xb0)), (.35, (0x83, 0xb5, 0xa2)),
              (.5, (0xd4, 0xc1, 0x7d)), (.7, (0xb9, 0x74, 0x44)), (.85, (0x97, 0x48, 0x39)),
              (1, (0xff, 0xf0, 0xdc))]


def mola():
    z = np.fromfile(ROOT / '.cache' / 'mola' / 'megt90n000eb.img', dtype='>i2').astype(float)
    z = z.reshape(2880, 5760).reshape(H, 16, 2 * W, 8).mean(axis=(1, 3))   # 2 px/deg wide
    z = z.reshape(H, W, 2).mean(axis=2)                                      # 1 px/deg
    return np.roll(z, W // 2, axis=1)                                        # 0..360 -> -180..180


def hillshade(z):
    gy, gx = np.gradient(z)
    return np.clip(0.75 + (gx * -0.6 + gy * 0.6) / 900, 0.35, 1.25)       # light from upper left


def topography():
    # Same ramp and range (-8 to +22 km) as the globe's topographic mode.
    z = mola()
    return np.clip(ramp((z + 8000) / 30000, TOPO_STOPS) * (0.55 + 0.45 * hillshade(z)[..., None]), 0, 255)


def radiation():
    # Same formula and colours as src/science/radiation-data.js.
    model = json.loads((ROOT / 'data' / 'science' / 'radiation' / 'model.json').read_text())
    z = mola()
    column = model['referenceColumnGcm2'] * np.exp(-z / model['scaleHeightM'])
    xs, ys = model['pathColumnGcm2'], model['tableEffectiveDoseCsvDay']
    ratio = np.interp(column, xs, ys) / np.interp(model['referenceColumnGcm2'], xs, ys)
    t = np.clip((ratio - .85) / .45, 0, 1)[..., None]
    colour = np.concatenate([40 + 210 * t, 190 - 125 * t, 185 - 135 * t], axis=2)
    return np.clip(colour * (0.6 + 0.4 * hillshade(z)[..., None]), 0, 255)


def terrain():
    z = mola()
    gy, gx = np.gradient(z)
    shade = np.clip(0.75 + (gx * -0.6 + gy * 0.6) / 900, 0.35, 1.25)       # light from upper left
    t = np.clip((z - z.min()) / (np.percentile(z, 99) - z.min()), 0, 1)
    low, high = np.array([70, 38, 26]), np.array([214, 150, 104])
    return np.clip((low + (high - low) * t[..., None]) * shade[..., None], 0, 255)


def science(file, field, stops, normalise):
    product = json.loads((ROOT / 'data' / 'science' / file).read_text())
    values = grid_to_image(product['fields'][field])
    # Previews are small icons: fill data gaps from their neighbours instead
    # of the grey 'no data' colour the map itself uses.
    missing = np.isnan(values)
    filled = np.where(missing, np.nanmean(values), values)
    for _ in range(40):
        filled = np.where(missing, blur(filled, 2), values)
    return ramp(np.clip(normalise(blur(filled)), 0, 1), stops)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    write_png(OUT / 'terrain.png', terrain())
    write_png(OUT / 'topography.png', topography())
    write_png(OUT / 'radiation.png', radiation())
    write_png(OUT / 'dust.png', science(f'tes-dust/{DUST_FILE}', 'CDOD610', DUST_STOPS, lambda v: v / 3))
    write_png(OUT / 'temperature.png', science(f'tes-temperature/{TEMPERATURE_FILE}', 'MEAN_K',
                                               TEMPERATURE_STOPS, lambda k: (k - 273.15 + 130) / 170))
    for f in sorted(OUT.glob('*.png')):
        print(f.relative_to(ROOT), f.stat().st_size // 1024, 'KB')


if __name__ == '__main__':
    main()
