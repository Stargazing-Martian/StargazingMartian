# Tycho skybox

These six 1024 × 1024 JPEG cube faces are byte-for-byte identical to the
[Cesium 1.145 skybox assets](https://github.com/CesiumGS/cesium/tree/1.145/packages/engine/Source/Assets/Textures/SkyBox).
All six were compared on 2026-10-11. `p`/`m` mean positive/negative and
`x`/`y`/`z` identify the cube axis; retain this mapping and image orientation.

The star map is based on Tycho/Hipparcos catalog data, not a photograph taken
from Mars. Credit: **NASA/Goddard Space Flight Center Scientific Visualization
Studio**, [The Tycho Catalog Skymap — Version 2.0](https://svs.gsfc.nasa.gov/3572/).
Star brightness is adjusted for visualization; it is not a naked-eye exposure.

## What the Mars scene represents

The images contain directions to distant stars, not the position of Mars in
its orbit. At this texture resolution a distant-star background is useful
from Mars as well, but the globe-to-stars orientation must be handled separately.
Changing `Cesium.Ellipsoid` alone does not make the default Earth-oriented skybox
Mars-aware. In Cesium 1.145 the default skybox shader uses TEME-to-Earth-fixed
rotation.

`mars-skybox.js` uses the public `CubeMapPanorama.transform` API instead. It
rotates the map using the pole and prime meridian from the
[NAIF IAU 2000 Mars model](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/mars_iau2000_v1.tpc),
evaluated at the viewer clock (initially the current time). Cesium's TAI time is
converted to TT; TT approximates TDB here. This is deliberately an **approximate
visual orientation** using an older IAU model. The static texture is treated
as an equatorial J2000 background; the original texture epoch/frame and its
TEME/J2000 distinction have not been independently calibrated against stars.

This is not a precise Mars observation simulator. It does not model stellar
proper motion, observer parallax, aberration, atmospheric extinction, or the
positions of Earth, the Sun, Phobos, Deimos and other Solar System objects.
The existing camera-following surface light and artistic atmosphere are also
independent of solar ephemerides. Exact observing directions require a validated
catalog-to-cubemap calibration and an appropriate modern ephemeris/frame model.

## Verified SHA-256

| Face | SHA-256 |
| --- | --- |
| px | `075509b5c76a3db76baf219c71d1156c90bd87a201e4402e80d4fb1f16b526da` |
| mx | `7eb5dfe95bebe58aaeff1a29f1e435e2e9985c7007d32397f63f1aa798062435` |
| py | `62404c604baff09b6293e79d83a6c851428452a07568aca2f4b69cfd67c8a25a` |
| my | `ee944d55d7abe7799f54768f59d6a3da6b802fabd50d20d3ceb898e888b6ca7a` |
| pz | `8a367b21469de9c3d41dec0a9b1aaf80472b5945e7f6827fb3a403707333e13b` |
| mz | `958b3d7779bf39e93dbb3373379a696c1b1d5660535d2ff963ab3c7f86d8042e` |
