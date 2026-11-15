# NASA TES historical atmospheric dust mode

Source: Montabone, L., Smith, M., Wolff, M., and Cantor, B. (2023).
*Mars Global Surveyor (MGS) Thermal Emission Spectrometer (TES) Atmospheric
Column Optical Depths for Dust and Water Ice Bundle*. NASA Planetary Data System.
DOI: https://doi.org/10.17189/kwez-jq47

- Archive: https://atmos.nmsu.edu/data_and_services/atmospheres_data/MARS/montabone.html
- User guide: https://atmos.nmsu.edu/PDS/data/PDS4/mgs_tes_atmos_dust-ice/document/user_guide_TES_COD.pdf
- Processing level: derived; the map is reconstructed from infrared retrievals,
  not raw detector counts and not a weather forecast.

## Scope and interpretation

Eleven explicitly selected archive products are shipped. This is not the full
archive, continuous daily coverage, or a date interpolation service. Two examples
are from 2000/2001; nine observation intervals are from January–August 2004.
These intervals overlap early MER operations but are **not Spirit/Opportunity
measurements**, and no automatic route-time association is made.

The displayed quantity is `CDOD610`: atmospheric **absorption** column dust
optical depth at **9.3 microns**, normalized to **610 Pa** (dimensionless).
`CDOD610UNC` is the published combined uncertainty, not a confidence level we
have assigned. Grid-point reliability and number/time window of contributing
retrievals are exposed by the picker. No route-risk thresholds are invented.

Native grid: 60 x 60 points; planetocentric latitude, east-positive longitude.
Longitude centers: -180, -174, ..., 174 degrees. Latitude centers: 88.5, 85.5,
..., -88.5 degrees. These are regional estimates, roughly 356 x 178 km spacing
at the equator. They cannot resolve variation along a short EVA route.

Daily reconstructed maps may combine input retrievals from 1, 3, 5, or 7 sols.
The UI shows the actual UTC **input-observation interval**, not an invented
instantaneous date. `solOfYear` is a planetary calendar label, not a rover's
mission Sol. Missing values (-999 / -999.99 in the source) become JSON null.
They remain visibly gray and are never filled with zero or nearby values.

The display uses the nearest grid point, with half-cell boundaries. A 120 x 60
texture preserves 6-degree-wide cells and splits the cell centered at -180
across the dateline correctly. No spatial interpolation is applied. The color
scale is shared across products, 0 to >=3; the numeric readout retains the
unclipped measurement. Lighting and the topographic color ramp are disabled
only while the scientific layer is active, so they cannot recolor the legend.
The CTOD provider and chosen vertical exaggeration are preserved.

Pancam opacity at 440/880 nm and TES absorption at 9.3 microns are different
quantities; do not merge their numeric values without a documented conversion.
Historical data are not current astronaut conditions. A safety assessment also
needs terrain/obstacles, local conditions and suit/equipment constraints.

## Rebuild and provenance

`manifest.json` records original product/label/ancillary URLs, LIDVIDs,
observation intervals, SHA-256 hashes of source data and labels, output hashes,
and valid-point counts. Each output preserves all eight numeric source fields;
only coordinates implied by the verified regular grid are omitted.

```sh
python3 scripts/build_dust_maps.py --download
node --test tests/dust-data.test.mjs
```

The builder needs only Python's standard library. Original .dat, .xml and .txt
files are retained in the ignored `.cache/nasa-tes-dust` directory. Run without
`--download` to rebuild offline from that cache. The builder checks source byte
counts, row counts, coordinate order, quality ranges and consistent missing
masks against NASA labels. The browser validates product identity, observation
period and schema; on secure origins it also checks the manifest's file hash.

Processed JSON is served with the web application. No live NASA request,
new backend service, API key, or cloud-provider dependency is introduced.

## Verification (2026-11-15)

- Rebuilt all 11 outputs offline from the original downloaded PDS files.
- `node --test --test-reporter spec tests/*.test.mjs`: 13 passed (8 science
  checks plus the 5 existing orientation/terrain-monitor checks).
- Browser: CTOD stayed connected while selecting two observation periods,
  reading a grid cell, and restoring both checked and unchecked topography
  preferences. A rapid switch back to surface did not attach a stale layer.
- The sample at grid center 25.5 N, 0 E for MY25/SOY400 displayed 0.78,
  uncertainty 0.08, 70 retrievals, a 3-sol window and reliability 0.9. These
  numbers were checked against the packaged original-derived numeric fields.
- A temporary HTTP server deliberately returned 503 for one science file:
  surface/topography returned, CTOD stayed ready, the obsolete science legend
  and reading were hidden, and another valid period recovered the science view.
- No backend/Docker changes, rover weather series, automatic mission-date
  matching, or cloud deployment are part of this stage.
