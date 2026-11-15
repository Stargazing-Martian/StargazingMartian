# Historical daytime surface temperature

This is a **Stargazing-derived map of NASA TES observations**, not a NASA-issued
gridded temperature product, live weather, or a forecast.

Source: Montabone, L., Smith, M., Wolff, M., and Cantor, B. (2023), *Mars Global
Surveyor (MGS) Thermal Emission Spectrometer (TES) Atmospheric Column Optical
Depths for Dust and Water Ice Bundle*, NASA Planetary Data System.
https://doi.org/10.17189/kwez-jq47

The infrared single-retrieval files include `TSURF`, explicitly defined as the
best-fit **surface temperature in Kelvin**, retrieved from nadir infrared
observations. It is not atmospheric temperature or thermal inertia. See the
[NASA user guide, Table 8 and Appendix A](https://atmos.nmsu.edu/PDS/data/PDS4/mgs_tes_atmos_dust-ice/document/user_guide_TES_COD.pdf).

## Selection and processing

Three explicit UTC intervals are packaged:

| Selection | Start (inclusive, UTC) | End (inclusive, UTC) | NASA source file |
| --- | --- | --- | --- |
| January 2004 | 2004-01-22 13:41:18 | 2004-01-29 17:10:44 | MY26 / Ls330–Ls360 |
| March–April 2004 | 2004-03-29 09:12:32 | 2004-04-05 10:26:46 | MY27 / Ls000–Ls030 |
| July–August 2004 | 2004-07-28 13:57:04 | 2004-08-04 17:19:22 | MY27 / Ls060–Ls090 |

The selections overlap three existing dust-map input windows, but temperature
and dust maps use different processing. The temperature UI reports the actual
first/last accepted observations; the numeric picker also reports the exact
first/last UTC and local-time range for its individual grid cell. Planetary
calendar Sol-of-Year and rover mission Sol are not treated as interchangeable.
No automatic rover-route/date association is made.

- Only published retrievals in the selected UTC interval with **13 <= LTST < 15**
  (local true solar hours), finite positive TSURF, valid Mars coordinates and a
  documented spectrum type (10/11/20/21) are used.
- The archive is already a selected daytime aerosol-retrieval dataset. It does
  not sample every temperature, terrain or time equally. No claim of an unbiased
  area-average surface temperature is made.
- Coordinates are planetocentric and east-positive. Values are binned to 60 x 60
  cells, at 6-degree longitude / 3-degree latitude spacing. Centers and seam
  treatment match the dust mode. The roughly 356 x 178 km spacing at the equator
  cannot resolve differences along a short EVA route.
- Within a populated cell, the unweighted arithmetic mean, observed minimum,
  observed maximum and sample standard deviation (n-1) are calculated. Minimum
  and maximum refer only to the selected daytime samples, **not daily extrema**.
- Nearby observations may be correlated. No standard error, confidence interval
  or effective independent-sample count is inferred. The source supplies no
  separate TSURF uncertainty field; `measurementUncertaintyK` remains null.
  Opacity uncertainty is never reused as temperature uncertainty.
- Empty cells stay null/gray; no spatial or temporal interpolation is performed.
  With one observation, sample standard deviation stays null, not zero.
- Stored temperatures and spreads remain in Kelvin (two decimal places). The UI
  converts temperature with **°C = K - 273.15**. Spread remains labeled in K.
  The fixed display scale spans <=-130 to >=40 °C. Clipping affects only color,
  not the numeric readout. Colors do not represent a safety classification.

These are historical environmental context layers, not sufficient evidence that
an astronaut route is safe. Local conditions, terrain/obstacles and equipment
constraints remain separate requirements.

## Reproducibility

```sh
python3 scripts/build_temperature_maps.py --download
python3 -m unittest discover -s tests -p test_temperature_builder.py -v
node --test tests/*.test.mjs
```

The builder uses the Python standard library. Three original files total about
191 MB and remain in ignored `.cache/nasa-tes-temperature`; they are not shipped
with the app. Rebuild without `--download` to use the original cache offline.
Source sizes, record counts, temperature field/unit and interval containment are
checked against NASA XML labels. Every source byte is SHA-256 hashed. Outputs
record source/label URLs, LIDVIDs, hashes, selection and actual observation times,
filters, counts, and the explicit derivation method. Browser validation checks
these identities and numeric/time/missing-data contracts; secure origins also
verify the packaged JSON hash.

The single science-map controller owns the active layer, so surface, dust and
temperature modes cannot retain competing overlays. It preserves CTOD, camera,
mission selection and vertical exaggeration. Data failures clear stale values
and the science legend and restore the surface view. Assets are static and work
with the existing web Docker service on Azure or another host.

## Verification (2026-11-15)

- Three maps use 231,288 selected published retrievals in total: January 87,906
  (2,603 populated bins), March–April 80,424 (2,512 bins), July–August 62,958
  (2,117 bins).
- Offline rebuilding from the downloaded original files produces byte-for-byte
  identical JSON, including the manifest.
- 20 JavaScript checks pass (including existing dust/orientation/terrain checks),
  plus 6 Python aggregation tests for units, time/daylight filters, missing data,
  sample standard deviation and dateline behavior.
- Independently re-reading the original January source for the cell centered
  at 25.5 N / 0 E gives 60 retrievals, mean 266.04 K (-7.11 C), sample spread
  1.56 K. The packaged file and browser picker display these same values.
- Browser: dust -> temperature conversion preserves CTOD and 5x exaggeration.
  A preview-only HTTP 503 clears the temperature legend/readout and restores
  surface/topography. A deliberately delayed temperature request does not
  replace the dust layer after switching modes.
- This validation does not establish local EVA safety, provide continuous
  historical weather, or verify automatic rover/date association.
