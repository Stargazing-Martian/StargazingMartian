"""Download mission photos from the NASA Image and Video Library.

Usage: python3 scripts/fetch_photos.py   (macOS: uses `sips` to resize)

Writes resized copies to assets/photos/ and a manifest to data/photos.json.
images-assets.nasa.gov sends no CORS headers, so the WebGL panorama viewer
cannot load the originals directly; we host resized copies ourselves.
NASA images are public domain; credits come from each image's metadata.
"""
import json, subprocess, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PHOTO_DIR = ROOT / 'assets' / 'photos'
MANIFEST = ROOT / 'data' / 'photos.json'
CACHE = ROOT / '.cache' / 'photos'

PANO_WIDTH = 6144   # ~17 px per degree: sharp at a 90° field of view
FLAT_WIDTH = 2000
THUMB_WIDTH = 480

# mission -> [(NASA id, 'pano' | 'flat'[, title override])]. 'pano' = full
# 360° cylindrical mosaic; the first photo is shown first in the panel.
PHOTOS = {
    'perseverance': [('PIA24264', 'pano'), ('PIA26369', 'pano'), ('PIA24422', 'pano')],
    'curiosity': [('PIA20332', 'pano'), ('PIA16029', 'pano'), ('PIA16077', 'flat')],
    'opportunity': [('PIA11754', 'pano'), ('PIA16122', 'pano')],
    'spirit': [('PIA11746', 'pano'), ('PIA16440', 'pano')],
    'pathfinder': [('PIA00662', 'pano'), ('PIA01409', 'flat')],
    'viking-1': [('PIA03165', 'flat'), ('PIA00567', 'flat'), ('PIA00563', 'flat')],
    'viking-2': [('PIA09509', 'flat'), ('PIA00573', 'flat'), ('PIA00568', 'flat')],
    'phoenix': [('PIA13804', 'pano')],
    'insight': [('PIA23203', 'flat'), ('PIA22871', 'flat')],
    'schiaparelli': [('PIA21132', 'flat')],
    'deep-space-2': [('KSC-98pc1648', 'flat', 'Deep Space 2 probes on Mars Polar Lander before launch (1998)')],
}


def get_json(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.load(response)


def resize(source, target, width):
    """Shrink to `width` (never enlarge) and save as JPEG."""
    current = int(subprocess.check_output(['sips', '-g', 'pixelWidth', str(source)]).split()[-1])
    args = ['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '78']
    if current > width:
        args += ['--resampleWidth', str(width)]
    subprocess.run(args + [str(source), '--out', str(target)], check=True, capture_output=True)
    out = subprocess.check_output(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', str(target)]).split()
    return int(out[-3]), int(out[-1])


def main():
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for mission, photos in PHOTOS.items():
        manifest[mission] = []
        for nasa_id, kind, *title in photos:
            meta = get_json(f'https://images-assets.nasa.gov/image/{nasa_id}/metadata.json')
            original = CACHE / f'{nasa_id}.jpg'
            if not original.exists():
                print('downloading', nasa_id)
                urllib.request.urlretrieve(
                    f'https://images-assets.nasa.gov/image/{nasa_id}/{nasa_id}~orig.jpg', original)
            width, height = resize(original, PHOTO_DIR / f'{nasa_id}.jpg',
                                   PANO_WIDTH if kind == 'pano' else FLAT_WIDTH)
            resize(original, PHOTO_DIR / f'{nasa_id}-thumb.jpg', THUMB_WIDTH)
            entry = {
                'id': nasa_id,
                'type': kind,
                'title': title[0] if title else meta.get('AVAIL:Title') or nasa_id,
                'credit': meta.get('AVAIL:SecondaryCreator') or meta.get('AVAIL:Photographer') or 'NASA',
                'src': f'assets/photos/{nasa_id}.jpg',
                'thumb': f'assets/photos/{nasa_id}-thumb.jpg',
                'source': f'https://images.nasa.gov/details/{nasa_id}',
            }
            if kind == 'pano':
                # Cylindrical mosaic: 360° wide, height in the same degrees per pixel.
                entry['haov'] = 360
                entry['vaov'] = round(360 * height / width, 1)
            manifest[mission].append(entry)
            print(f'{mission}: {nasa_id} {kind} {width}x{height}')
    MANIFEST.write_text(json.dumps(manifest, indent=1))


if __name__ == '__main__':
    main()
