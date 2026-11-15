import { shieldingProxy, radiationColor } from './radiation-data.js';
import { requestSurfaceRender } from '../mars/request-surface-render.js?v=2';

export function createRadiationMap(viewer, ellipsoid, controls) {
    const C = globalThis.Cesium;
    let active = false, model, material, generation = 0;
    const reading = document.getElementById('radiation-reading');
    const status = document.getElementById('radiation-status');
    function apply() {
        if (!active || !model) return;
        const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 1;
        const ctx = canvas.getContext('2d'); const pixels = ctx.createImageData(256, 1);
        for (let i = 0; i < 256; ++i) {
            const value = shieldingProxy(-8000 + i / 255 * 30000, model);
            pixels.data.set([...(value ? radiationColor(value.ratio) : [100, 100, 100]), 255], i * 4);
        }
        ctx.putImageData(pixels, 0, 0);
        const scale = viewer.scene.verticalExaggeration;
        material = C.Material.fromType('ElevationRamp', { image: canvas,
            minimumHeight: -8000 * scale, maximumHeight: 22000 * scale });
        viewer.scene.globe.material = material;
        requestSurfaceRender(viewer.scene);
    }
    document.getElementById('relief-scale').addEventListener('change', apply);
    return {
        async activate() {
            const current = ++generation; active = true;
            document.getElementById('radiation-map-panel').hidden = false;
            status.textContent = 'Loading the published model assumptions…';
            try {
                if (!model) {
                    const response = await fetch(new URL('../../data/science/radiation/model.json', import.meta.url), { signal: AbortSignal.timeout(15000) });
                    if (!response.ok) throw new Error(`Model: HTTP ${response.status}`);
                    model = await response.json();
                }
                if (!active || current !== generation) return;
                controls.setScientificMode(true); apply();
                status.textContent = 'Fixed GCR scenario · relative proxy · no date or weather matching';
                reading.textContent = 'Shift+click the terrain to read the model. Values are based on source heights, independent of 1×/5× display.';
            } catch (error) { if (current === generation) status.textContent = `Model unavailable: ${error.message}`; }
        },
        deactivate() {
            ++generation;
            if (active) {
                active = false;
                if (viewer.scene.globe.material === material) viewer.scene.globe.material = undefined;
                controls.setScientificMode(false);
            }
            document.getElementById('radiation-map-panel').hidden = true;
            requestSurfaceRender(viewer.scene);
        },
        inspect(position) {
            if (!active || !model) return;
            const ray = viewer.camera.getPickRay(position), hit = ray && viewer.scene.globe.pick(ray, viewer.scene);
            if (!hit) { reading.textContent = 'Pick a point on Mars.'; return; }
            const point = ellipsoid.cartesianToCartographic(hit);
            const scale = viewer.scene.verticalExaggeration, relative = viewer.scene.verticalExaggerationRelativeHeight;
            const height = (point.height - relative) / scale + relative;
            const value = shieldingProxy(height, model);
            reading.textContent = !value ? 'Outside the published lookup domain; no value assigned.' :
                `${C.Math.toDegrees(point.latitude).toFixed(4)}°, ${C.Math.toDegrees(point.longitude).toFixed(4)}° E\n` +
                `Relative vertical-column proxy: ${value.ratio.toFixed(3)} × reference\n` +
                `Model column: ${value.column.toFixed(2)} g/cm² · rendered DEM height: ${height.toFixed(0)} m\n` +
                'Not an observed radiation dose or an astronaut safety assessment. Terrain detail depends on local tile coverage.';
        },
    };
}
