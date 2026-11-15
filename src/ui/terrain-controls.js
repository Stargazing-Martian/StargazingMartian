// Terrain remains active; display controls change colour and visual height only.
export function createTerrainControls(viewer, imagery) {
    const Cesium = globalThis.Cesium;
    const panel = document.getElementById('terrain-panel');
    const fieldset = document.getElementById('relief-controls');
    const topography = document.getElementById('topography');
    const scale = document.getElementById('relief-scale');
    const legend = document.getElementById('elevation-legend');
    let ramp, surfaceLighting;
    let scientificMode = false;

    function updateMaterial() {
        const exaggeration = scale.value === '1' ? 1 : 5;
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
             [.7, '#b97444'], [.85, '#974839'], [1, '#fff0dc']]
                .forEach(([stop, color]) => gradient.addColorStop(stop, color));
            context.fillStyle = gradient;
            context.fillRect(0, 0, 256, 1);
            ramp = Cesium.Material.fromType('ElevationRamp', {
                image: canvas, minimumHeight: -8000 * exaggeration, maximumHeight: 22000 * exaggeration,
            });
        }
        viewer.scene.globe.material = enabled ? ramp : undefined;
        if (ramp) {
            ramp.uniforms.minimumHeight = -8000 * exaggeration;
            ramp.uniforms.maximumHeight = 22000 * exaggeration;
        }
        viewer.scene.verticalExaggeration = exaggeration;
        document.getElementById('relief-scale-note').textContent =
            `Relief shown at ${exaggeration}× height; colours use source DEM metres.`;
        viewer.scene.requestRender();
    }
    topography.addEventListener('change', updateMaterial);
    scale.addEventListener('change', updateMaterial);
    panel.addEventListener('wheel', event => event.stopPropagation(), { passive: true });
    return {
        setScientificMode(active) {
            if (active === scientificMode) return;
            if (active) surfaceLighting = viewer.scene.globe.enableLighting;
            scientificMode = active;
            viewer.scene.globe.enableLighting = active ? false : surfaceLighting;
            updateMaterial();
        },
        setReady(ready) {
            fieldset.disabled = !ready;
            updateMaterial();
        },
    };
}
