// Source coordinates/heights are immutable. Only display Cartesian positions
// change with exaggeration and the currently rendered mesh LOD.
export function displayHeight(height, scale, relative = 0) {
    return (height - relative) * scale + relative + 3; // 3 m cartographic line offset, never a measurement
}

export function createSurfacePath(viewer, ellipsoid, points, changed) {
    const C = globalThis.Cesium;
    const cartographics = points.map(([lon, lat]) => C.Cartographic.fromDegrees(lon, lat));
    const positions = points.map(([lon, lat, h]) => C.Cartesian3.fromDegrees(lon, lat, h, ellipsoid));
    let scale, relative, dirty = true, working = false, serial = 0;
    function invalidate() { dirty = true; ++serial; }
    const removeCamera = viewer.camera.moveEnd.addEventListener(invalidate);
    const removeTiles = viewer.scene.globe.tileLoadProgressEvent.addEventListener(count => { if (count === 0) invalidate(); });
    function update(visible) {
        const nextScale = viewer.scene.verticalExaggeration;
        const nextRelative = viewer.scene.verticalExaggerationRelativeHeight;
        if (nextScale !== scale || nextRelative !== relative) {
            scale = nextScale; relative = nextRelative; invalidate();
            points.forEach((p, i) => C.Cartesian3.fromDegrees(p[0], p[1], displayHeight(p[2], scale, relative), ellipsoid, positions[i]));
            changed(positions);
        }
        if (!visible || !dirty || working || !viewer.scene.globe.tilesLoaded) return;
        working = true; dirty = false;
        const current = serial, heights = new Float64Array(points.length);
        let index = 0;
        function batch() {
            if (current !== serial) { working = false; return; }
            const start = performance.now();
            do {
                // getHeight already includes scene exaggeration. Scaling twice
                // is a serious error on negative-height rover regions.
                const height = viewer.scene.globe.getHeight(cartographics[index]);
                heights[index] = Number.isFinite(height) ? height + 3 : displayHeight(points[index][2], scale, relative);
                ++index;
            } while (index < points.length && performance.now() - start < 3);
            if (index < points.length) { setTimeout(batch, 0); return; }
            points.forEach((p, i) => C.Cartesian3.fromDegrees(p[0], p[1], heights[i], ellipsoid, positions[i]));
            working = false;
            changed(positions);
            viewer.scene.requestRender();
        }
        setTimeout(batch, 0);
    }
    return { positions, update, destroy() { ++serial; removeCamera(); removeTiles(); } };
}
