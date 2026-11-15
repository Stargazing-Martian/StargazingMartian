// Screen markers (pins, START/END, destinations) must sit on the drawn
// surface. With 5x relief that surface is far above the height-0 ellipsoid,
// so markers anchored at height 0 drift away from their lines. This lifts a
// fixed lon/lat to the rendered globe height (which includes exaggeration).
export function surfacePoint(viewer, ellipsoid, cartographic, result) {
    const C = globalThis.Cesium;
    const height = viewer.scene.verticalExaggeration === 1 ? 0 : viewer.scene.globe.getHeight(cartographic);
    return C.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude,
        Number.isFinite(height) ? height : 0, ellipsoid, result);
}
