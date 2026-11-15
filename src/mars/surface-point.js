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

// Which world points face the camera. Cesium's ellipsoidal occluder assumes
// the camera is above the ellipsoid; with 5x relief in Gale or Jezero the
// drawn ground lies kilometres below it, a zoomed-in camera follows it down,
// and the occluder then hides every route and marker. Close to the surface,
// use distance instead (nothing within ~2,000 km can be on the far side).
export function facingTest(viewer, ellipsoid) {
    const C = globalThis.Cesium;
    const camera = viewer.camera.positionWC;
    const height = C.Cartesian3.magnitude(camera) - ellipsoid.maximumRadius;
    if (height < 300_000) {
        return C.Cartesian3.distance ? point => C.Cartesian3.distance(camera, point) < 2_000_000 : () => true;
    }
    const occluder = new C.EllipsoidalOccluder(ellipsoid, camera);
    return point => occluder.isPointVisible(point);
}
