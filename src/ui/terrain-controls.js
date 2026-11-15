export function createTerrainControls(viewer, imagery, enterInteractiveMode, ellipsoid) {
    const panel = document.getElementById('terrain-panel');
    const fieldset = document.getElementById('relief-controls');
    const topography = document.getElementById('topography');
    const scale = document.getElementById('relief-scale');
    const legend = document.getElementById('elevation-legend');
    const reading = document.getElementById('terrain-reading');
    let provider;
    let measurement = 0;
    let ramp;
    let scientificMode = false;
    let surfaceLighting;
    function updateMaterial() {
        const enabled = topography.checked && !fieldset.disabled && !scientificMode;
        imagery.show = !enabled && !scientificMode;
        topography.disabled = scientificMode;
        legend.hidden = !enabled;
        if (enabled && !ramp) {
            const canvas = document.createElement('canvas');
            canvas.width = 256; canvas.height = 1;
            const context = canvas.getContext('2d');
            const gradient = context.createLinearGradient(0, 0, 256, 0);
            [[0, '#172b70'], [.2, '#398db0'], [.35, '#83b5a2'], [.5, '#d4c17d'],
             [.7, '#b97444'], [.85, '#974839'], [1, '#fff0dc']].forEach(([stop, color]) => gradient.addColorStop(stop, color));
            context.fillStyle = gradient; context.fillRect(0, 0, 256, 1);
            ramp = Cesium.Material.fromType('ElevationRamp', {
                image: canvas, minimumHeight: -8000, maximumHeight: 22000
            });
        }
        viewer.scene.globe.material = enabled ? ramp : undefined;
        viewer.scene.verticalExaggeration = Number(scale.value);
        if (ramp) {
            // Globe material receives exaggerated heights; keep the legend in source units.
            ramp.uniforms.minimumHeight = -8000 * Number(scale.value);
            ramp.uniforms.maximumHeight = 22000 * Number(scale.value);
        }
    }
    topography.addEventListener('change', updateMaterial);
    scale.addEventListener('change', updateMaterial);
    // A close oblique view makes the real height geometry visible at 1x.
    document.getElementById('olympus-view').addEventListener('click', async () => {
        await enterInteractiveMode();
        const target = Cesium.Cartesian3.fromDegrees(-133.8, 18.65, 12000, ellipsoid);
        viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 180000), {
            duration: 2,
            offset: new Cesium.HeadingPitchRange(Cesium.Math.toRadians(25), Cesium.Math.toRadians(-22), 500000)
        });
    });
    document.getElementById('terrain-origin').textContent = location.origin;
    panel.addEventListener('wheel', event => event.stopPropagation(), { passive: true });
    const picker = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    picker.setInputAction(async ({ position }) => {
        if (!provider || fieldset.disabled) return;
        const ray = viewer.camera.getPickRay(position);
        if (!ray) return;
        const hit = viewer.scene.globe.pick(ray, viewer.scene);
        if (!hit) return;
        const point = ellipsoid.cartesianToCartographic(hit);
        const current = ++measurement;
        reading.textContent = 'Kaynak DEM yüksekliği okunuyor…';
        try {
            const [sample] = await Cesium.sampleTerrainMostDetailed(provider, [point], true);
            if (current !== measurement) return;
            if (!Number.isFinite(sample.height)) throw new Error('Yükseklik okunamadı');
            reading.textContent = `${Cesium.Math.toDegrees(sample.latitude).toFixed(4)}°, ` +
                `${Cesium.Math.toDegrees(sample.longitude).toFixed(4)}° · ` +
                `${Math.round(sample.height).toLocaleString('tr-TR')} m (kaynak DEM)`;
        } catch (error) {
            if (current === measurement) reading.textContent = `Ölçüm alınamadı: ${error.message}`;
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    return {
        // A scientific imagery layer owns the colors while active. Preserve the
        // checkbox and vertical exaggeration so returning restores the surface.
        setScientificMode(active) {
            if (active === scientificMode) return;
            if (active) surfaceLighting = viewer.scene.globe.enableLighting;
            scientificMode = active;
            viewer.scene.globe.enableLighting = active ? false : surfaceLighting;
            updateMaterial();
        },
        setProvider(value) {
            provider = value;
        },
        setReady(ready) {
            fieldset.disabled = !ready;
            if (!ready) {
                provider = undefined;
                ++measurement;
            }
            reading.textContent = ready ? 'Yükseklik okumak için yüzeyde bir noktaya tıklayın.' : '';
            updateMaterial();
        }
    };
}
