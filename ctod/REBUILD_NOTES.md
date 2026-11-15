# Mars terrain v3.0.1 — 15 November 2026

## What changed

- `mars_raster.py`: native Mars CRS validation, block-based raster reads,
  a 128 MiB block cache, nearest/bilinear sampling, and continuity across the
  poles and the meridian.
- `mars_mesh.py`: 128×128 cells, 16,641 vertices and 32,768 triangles; heights
  and cross-boundary normals come from the same halo sampling. Empty cells are
  filled from a valid, coarser overview level of the same DEM; if no level has
  data, a clear error is returned.
- `mars.py`: four workers, shared generation for the same tile, and a versioned
  memory/disk cache. A client timeout does not cancel the shared job.
- Compose: a local COG folder can be mounted; a `.env` was prepared for the
  existing `MarsHRSCMOLA_MAP2_COG.tif` on this machine. `.env` and the DEM are
  not committed to Git.
- UI: the real failing tile coordinate is shown, and the warning clears once
  that tile loads successfully. Clicking the surface reads the source DEM height
  in metres. An oblique inspection light brings out slopes.

## Direct generation measurements

Existing 106695×53348 local COG at 200 m/pixel, Python 3.10.
Gzip tile generation includes the real DEM read and quantized-mesh encoding.
These are not browser load times or remote USGS performance figures.

| TMS tile | Generation (s) | Compressed bytes | Min / max height (m) |
| --- | ---: | ---: | ---: |
| 0/0/0 | 0.021 | 127943 | -6179.7 / 19585.2 |
| 0/1/0 | 0.014 | 128788 | -7467.4 / 7495.6 |
| 1/2/1 | 0.040 | 119789 | -6052.1 / 2381.1 |
| 3/4/3 | 0.069 | 119376 | -5110.0 / 5668.9 |
| 8/65/154 | 0.043 | 110445 | 18109.7 / 20378.1 |
| 8/356/184 | 0.055 | 116395 | -3084.4 / -2495.0 |
| 9/131/309 | 0.020 | 107905 | 19076.1 / 19997.9 |

## Check status

- All 22 backend tests passed in a normal environment (0.669 s), including the
  concurrency test that had been pending in a restricted environment.
- Five Node tests passed: two terrain error-monitoring/recovery tests and three
  star-orientation tests. Syntax and `git diff --check` checks passed.
- With the real DEM and a running HTTP server, 239 tiles succeeded with eight
  concurrent requests (3.791 s): the whole globe at z=0–3, z=8 north/south pole
  samples, and Olympus/second-height samples. Every tile had 16,641 vertices.
  This is not a full global z=0–9 coverage sweep.
- In a first overload test, 173 simultaneous requests returned 503 for those
  above the limit of 64 unique jobs. The limit protects memory and the job
  queue; later checks used eight concurrent requests, similar to a browser.
- `docker compose config --quiet` passed. The existing Docker containers were
  not started in this round; the local bind mount inside Docker should be
  confirmed from the log when it is next started.
- On temporary local CTOD (5015) and web (5505) servers, Cesium decoded the real
  tiles; topography colours, the 1×/5× scale and a close Olympus Mons view were
  observed. The final build showed the green "3D terrain active" status.
- In the final close Olympus view, clicking the surface at 16.2094°, -134.4493°
  returned a source DEM height of **15,107 m**, not mixed up with the 5×
  exaggerated geometry. Final image: `/tmp/stargazing-v3-proof/olympus-5x.jpg`.
- The temporary check tab and both check servers were closed afterwards.

## Usage

The Python dependencies did not change; the running project image does not need
a rebuild:

```sh
docker compose up -d
```

Reload `http://localhost:5500` with Ctrl+Shift+R. The `Mars DEM:` line in the
CTOD log should show `/data/MarsHRSCMOLA_MAP2_COG.tif`.

The source DEM's native resolution is 200 m. The imagery is the Viking mosaic;
this backend change does not increase the surface image resolution. Data heights
are preserved; no vertical datum conversion is applied.
