# Static Mars terrain for the Pages site

`mars/` contains **1,021 real CTOD quantized-mesh tiles**, including vertex
normals, exported without reducing the service's 128-cell mesh density. No
synthetic flat terrain or placeholder heights are included. The package is
approximately **322 MiB**, and is served from the same Pages origin as the UI:

`https://stargazing-martian.github.io/StargazingMartian/data/terrain/mars/layer.json`

GitHub Pages serves the generated files. Python, FastAPI and Docker do not run
on Pages and are not needed by visitors or a static local preview. The checked-in
`site-config.js` selects this relative path on every host; it does not use a
previous browser's localhost terrain setting.

## Coverage and scientific limits

- All of Mars: levels 0–4 (682 tiles).
- Mission landing regions and the complete checked-in rover route bounds, with
  0.5-degree margins: levels 5–9. The original terrain validation sites are also
  covered to level 9. These geographic margins define export coverage only;
  they are not observation positions or environmental-data footprints.
- High-detail coverage is enumerated by `staticCoverage.regions`; exact TMS
  availability is in `layer.json`. Cesium uses coarser ancestors outside those
  areas, without requesting nonexistent tiles. This is **not global z9 coverage**.
- `sourceResolutionMeters:200` describes the input HRSC/MOLA raster, not the
  spacing of the global overview mesh. Mesh density, Mars radius (3,396,190 m),
  heights, normals and the CTOD pipeline version are retained unchanged.
- The UI offers only 1× true height and 5× visual exaggeration (the default). Topography colours and their
  legend use source DEM metres. Scientific temperature/dust overlays temporarily
  own colours and restore the topography preference on exit.
- Route lines retain ground classification at 1×. At 5×, visible routes are
  sampled once from the actual terrain provider and drawn at exaggerated DEM
  heights with a 5–8 m visual lift for casing/fill/hover. This avoids Cesium's
  ground-classification clipping and coplanar flicker on exaggerated Mars
  terrain. Sampling does not change route longitude/latitude, source heights,
  difficulty metrics or scientific observations; scale switches reuse samples.
- HRSC / MOLA source attribution and height-reference limits remain in
  `layer.json`. No areoid correction or extra source detail is invented.

The regional package stays below the [1 GB published-site limit](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
Global level 9 would require 699,050 tiles and does not fit this hosting model
at the existing mesh density. Increasing coverage or resolution requires a
new export and a size review, or an externally hosted dynamic service.

## Rebuild

Start the existing CTOD service only while generating an updated package, then
run from the repository root:

```sh
python3 scripts/export_pages_terrain.py --output /tmp/mars-terrain-next
```

Defaults: local source `http://localhost:5000/tiles/mars`, global level 4,
regional level 9, four concurrent requests, 700 MiB package budget. The builder
records source version and planned regions before downloading, validates each
uncompressed mesh and its normals, checks that the source version stays the
same, and writes `layer.json` **only when all planned tiles succeed**. An
interrupted export can resume in its incomplete directory. A completed or
differently configured export must use a new directory.

After validating a replacement package, replace `mars/` with it and commit all
tiles and metadata together. `export.json` records per-file SHA-256 and byte
counts; `export-plan.json` records coverage and source version. Transport gzip
is removed during export so Pages needs no custom `Content-Encoding` headers.

For a dynamic Azure deployment instead, set `terrainUrl` in `site-config.js`
to that service's HTTPS `/tiles/mars` URL. The science-data paths stay relative
to the site and require no changes. The external service must allow the Pages
origin through CORS; the included same-origin static package does not need CORS.
