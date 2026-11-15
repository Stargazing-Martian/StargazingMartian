# Stargazing Martian

**A layered Mars atlas for planning a Mars-walk.**
Built for the NASA Space Apps Challenge 2026.

**Live site:** <https://stargazing-martian.github.io/StargazingMartian/>

Robots have already walked Mars for us. Stargazing Martian turns their real journeys into a map an
astronaut can plan with. It shows every rover traverse NASA has published, split into science phases
and scored for how hard each part would be on foot. Around them sit orbital science layers (terrain,
topography, dust, temperature, radiation shielding) and a planet-wide network of expedition corridors
between landing sites and science destinations.

---

## Features

- **3D Mars globe** (CesiumJS) with NASA imagery, 3D terrain, and an opening showcase that leads into
  free exploration.
- **11 mission sites** for 12 missions: Viking 1 and 2, Mars Pathfinder (Sojourner), Deep Space 2,
  Spirit, Opportunity, Phoenix, Curiosity, ExoMars Schiaparelli, InSight, and Perseverance (with Ingenuity).
- **Real rover traverses** for Spirit, Opportunity, Curiosity and Perseverance, drawn from NASA data and
  split into named science phases.
- **Walking difficulty per segment**, coloured green, orange or red, with the reasons spelled out.
- **Mission panel** with a summary, stats, a difficulty profile, a segment list that highlights on the
  map in both directions, and segment details.
- **NASA photos and 360° panoramas.** Panoramas open full screen and let you look in every direction.
  Flat photos open as a quick "peek" card.
- **Map modes:** Terrain, Topography, Atmospheric dust, Radiation shielding and Surface temperature,
  each with a preview tile.
- **Expedition corridors.** 45 least-cost corridors across the whole planet, drawn like a road network.
  Hover a corridor to see its difficulty; click it for distance, climb, slope, temperature and sols by rover.
- **Mission and time.** Historical Pancam atmospheric opacity for Spirit and Opportunity, looked up by
  Sol or by approximate UTC day.
- **Relief on demand.** The globe opens at true height (1×). Selecting a site or route switches to 5×
  relief, centred on that site's own ground height.

## How to use it

1. Scroll, or click **Scroll to explore**, to leave the showcase.
2. Click a pin to open the mission card, photos and panoramas.
3. Click **Explore route** to see the route's segments. Hover or click them, in the list or on the map.
4. Grey lines are expedition corridors. Hover one to see its difficulty, or click it for the details.
5. Use **Map mode** (bottom-right) to switch layers. **More options** holds terrain status, height
   scale and the mission/time observations.
6. **About** (top-right) explains the project, its data and its limits.

## How it works

**Rover routes.** NASA traverse files are converted to longitude, latitude and Sol by
`scripts/build_routes.py`. Source vertices are kept as published. The display line is smoothed only
on screen. Routes are split into science phases by Sol range; the boundaries are approximate and come
from mission campaign summaries.

**Walking difficulty** is scored per segment:

- **Curiosity and Perseverance:** the rover logged its own tilt at every stop, so the score uses the
  90th-percentile tilt. Below 9° is easy, 9° to 15° is medium, and 15° or more is hard.
- **Spirit and Opportunity:** these rovers logged no tilt, so the score comes from terrain notes and
  incidents in the mission record, such as Purgatory, Troy and the Endeavour rim. A note can only raise
  a level, never lower it.

**Expedition corridors** (`scripts/build_corridors.py`) are least-cost paths over a cost map. The cost
map is built from:

- NASA MOLA slope and roughness, at about 7.4 km per cell
- TES daytime surface temperature
- a radiation-shielding proxy

Polar caps beyond 80° are treated as impassable.

**Science maps** come from NASA TES dust optical depth and TSURF surface temperature, averaged into
6° × 3° cells. The radiation layer is a Stargazing-derived relative shielding proxy. It uses MOLA heights
and a published GCR transport table. It is not a NASA dose map.

### Limits

These are planning aids, not verified safe routes. Orbital data cannot see boulders, small craters or
cliffs. Rover tilt is only a proxy for ground slope. Corridors are coarse expedition scenarios for a
crewed rover, not walking routes. Science maps are historical regional context, not forecasts.

---

## Run it locally

The site is static: HTML, CSS, ES modules and JSON, with no build step. Serve the repository root over HTTP:

```sh
python3 -m http.server 5173
```

Then open <http://localhost:5173>. Opening the files as `file://` will not work.

The 3D terrain is a static tile package in `data/terrain/mars/`. It is served with the site, so no
backend is needed. `site-config.js` points to it.

### Tests

```sh
node --test tests/
```

### Rebuilding the data

The scripts in `scripts/` regenerate everything in `data/` and `assets/`. Some of them need NumPy and
scikit-image:

```sh
python3 -m venv .cache/venv
.cache/venv/bin/pip install numpy scikit-image
.cache/venv/bin/python scripts/build_corridors.py
```

| Script | Output |
|---|---|
| `build_routes.py` | `data/routes/*.json`: traverses, segments, difficulty |
| `build_route_surfaces.py` | terrain-aligned display geometry for the routes |
| `build_corridors.py`, `build_radiation_corridors.py` | `data/network/corridors.json` |
| `build_dust_maps.py`, `build_temperature_maps.py` | `data/science/tes-*` |
| `build_mer_weather.py` | Pancam opacity observations |
| `build_map_previews.py` | `assets/previews/*.png` (map-mode tiles) |
| `fetch_photos.py` | `assets/photos/`, `data/photos.json` (uses macOS `sips`) |
| `export_pages_terrain.py` | the static terrain package in `data/terrain/mars/` |

### Terrain backend (optional)

The terrain package was produced with **CTOD**, a Cesium terrain server, from the USGS HRSC/MOLA blended
DEM (about 200 m per pixel). You only need CTOD to regenerate terrain or to work on the backend:

```sh
docker compose up -d --build
```

This starts CTOD on port 5000 and the site on <http://localhost:5500>. To use the live server instead of
the static package, set `terrainUrl: null` in `site-config.js`. For a remote CTOD, the page's origin must
be allowed through `CTOD_CORS_ALLOW_ORIGINS`. Package coverage: the whole planet to level 4, and mission
regions to level 9. See [data/terrain/README.md](data/terrain/README.md).

---

## Data and resources

### NASA data

- [NASA MMGIS rover traverses and waypoints: Perseverance, Curiosity, Ingenuity](https://mars.nasa.gov/maps/)
- [PDS MER Analyst's Notebook traverses: Spirit, Opportunity](https://an.rsl.wustl.edu/mera/AN/pages/mer/mer_traverse.htm)
- [MGS MOLA MEGDR global topography](https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/)
- [MGS TES dust optical depth and surface temperature (NASA PDS)](https://doi.org/10.17189/kwez-jq47)
- [MER Pancam atmospheric opacity](https://pds-geosciences.wustl.edu/mer/mer1_mer2-m-pancam-5-atmos-opacity-v1/merao_1xxx/)
- [NASA Mars Trek imagery: Viking, MRO CTX](https://trek.nasa.gov/mars/)
- [NASA Image and Video Library: photos and panoramas](https://images.nasa.gov/)
- [NASA/JSC co-authored HZETRN study (radiation proxy)](https://doi.org/10.1029/2009SW000564)
- [NASA Mars fact sheet (atmosphere assumptions)](https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html)

### Other data and tools

- [USGS HRSC/MOLA blended DEM](https://astrogeology.usgs.gov/search/map/Mars/Topography/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2): HRSC data under CC BY-SA 3.0 IGO
- [CesiumJS](https://cesium.com/platform/cesiumjs/), [CTOD](https://github.com/sogelink-research/ctod), [Pannellum](https://pannellum.org/)
- [NumPy](https://numpy.org/), [scikit-image](https://scikit-image.org/)
- [Instrument Sans](https://fonts.google.com/specimen/Instrument+Sans), [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) (Google Fonts)
- Star background: Tycho/Hipparcos-derived sky map; see [assets/skybox/README.md](assets/skybox/README.md)

NASA images are public domain. Each photo is credited in the viewer and links to its source.
The NASA Space Apps logo is used unaltered, following the
[Space Apps brand guidelines](https://www.spaceappschallenge.org/brand/).

## Use of AI

Much of the code and some of the text in this project were written with an AI assistant (Anthropic's
Claude), directed and reviewed by the team. No AI-generated images, video or audio are used. Every
photo is NASA's own.

## Team

- **Batın Sarı**: Backend
- **Yunus Emre Zorlu**: Product Design

## License

[MIT](LICENSE) © 2026 Stargazing Martian
