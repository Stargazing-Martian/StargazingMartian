# NASA MER Pancam historical environmental observations

This is a read-only local subset packaging the **440 nm** Spirit and Opportunity
Pancam opacity tables from the NASA PDS [MER archive](https://pds-geosciences.wustl.edu/mer/mer1_mer2-m-pancam-5-atmos-opacity-v1/merao_1xxx/).
It is not a new temperature map, live forecast or complete weather product.

## Provenance and interpretation

- PDS dataset: `MER1/MER2-M-PANCAM-5-ATMOS-OPACITY-V1.0`. PDS4 LIDVIDs,
  source/label URLs, SHA-256 digests and counts are in `manifest.json`.
- Spirit/MER2: `2tau440_2209_20110214a.tab`, 4,391 valid observations.
  Opportunity/MER1: `1tau440_5106_20181207a.tab`, 8,697 valid observations.
- The NASA XML defines mission Sol as **ceil(local_time)**; noon on Sol 2 is
  local_time 1.5. This Sol is specific to the selected mission. It is not a
  terrestrial date or a Sol counted from another mission's landing.
- `opacity` and `relativeError` preserve the published values. The latter is
  the source relative-error field, not a combined total uncertainty. The header
  separately states an absolute calibration error 0.03 at airmass 1. No
  propagation, safety thresholds or conversions to TES opacity are introduced.
- Source sentinel -1 in flux, opacity or error is excluded; true zero is valid.
  These particular two files have no such excluded records.
- `solarLongitude` preserves source Ls, including its negative early values.

## Clock-derived approximate UTC

NASA [NAIF SPICE](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/scs2e_c.html)
converts integer SCLK seconds from each image ID using the corresponding
[MER clock kernel](https://naif.jpl.nasa.gov/pub/naif/MER/kernels/sclk/)
and `naif0012.tls`. MER1/Opportunity is spacecraft -253; MER2/Spirit is -254.
Partition 1 and fraction zero are used; subsecond image timing is unavailable
in this table. Converted UTC is approximate: at file endpoints the results
differ by 1–6 seconds from the archive's published endpoint metadata. The UTC
day filter uses this explicitly labelled clock-derived time, not an invented
exact event time. Near midnight, the true date cannot be guaranteed by these
integer-clock values.

Applicability limits in the kernels are enforced before emitting UTC. For
Opportunity, 408 observations after the applicable stop of
2017-03-28T23:31:43.672Z retain their source Sol but have `utc:null`. They cannot
match a UTC-day query or a TES period. The full Spirit table is covered. No
clock extrapolation, linear Earth-day approximation or nearest-day fallback
is used. Source clock/leap kernel URLs and hashes and SpiceyPy version are
recorded per mission.

## Location and map association

The opacity table does not provide the observation's rover coordinates.
`position:null` is intentional. The existing mission pin provides only an
**explicitly labelled landing-region reference cell** for the coarse TES map;
it is not presented as the measurement location. Smoothed route vertices are
not substituted for original observation coordinates.

When the binding checkbox is enabled, only curated TES products whose actual
input-observation interval contains the selected clock-derived UTC are
available. No matching product means no overlay and no stale numeric reading.
This is temporal overlap with a regional product (often a multi-sol mean),
not same-day co-located weather. A missing regional cell remains missing.
Free archive browsing is available by disabling the binding checkbox.

Pancam 440 nm extinction opacity and TES 9.3 μm absorption opacity normalized
to 610 Pa are distinct quantities and are never directly compared here.
No air temperature, wind, storm-event classification or astronaut safety
rating is inferred from opacity alone.

## Rebuild and validation

Only the offline builder needs `spiceypy==8.4.0`; no deployed Python or cloud
dependency is added. Install that dependency in a temporary environment, then:

```sh
python3 scripts/build_mer_weather.py --download
python3 scripts/build_mer_weather.py --output /tmp/mer-weather-rebuild
node --test tests/mission-environment-data.test.mjs
python3 -m unittest discover -s tests -p 'test_mer_weather_builder.py'
```

Downloads are cached in ignored `.cache/nasa-mer-weather`. Shipped JSON is
about 1.1 MB. Runtime loads only the selected mission; it never calls NASA
directly or opens another CTOD service. No terrain geometry or route builder
is changed.
