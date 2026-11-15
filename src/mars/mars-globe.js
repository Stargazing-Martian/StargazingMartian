import { createVikingImagery } from '../nasa/nasa-layers.js';
import { MARS_RADIUS, initialTerrainUrl, normalizeTerrainUrl, saveTerrainUrl, terrainTimeoutMs } from './config.js?v=5';
import { createTerrainControls } from '../ui/terrain-controls.js?v=6';
import { monitorTerrain } from './terrain-monitor.js';
import { createMarsCamera } from './mars-camera.js?v=6';
import { createMarsSkybox } from './mars-skybox.js';
import { MISSIONS } from '../missions/mission-data.js?v=11';
import { createMissionPins } from '../missions/mission-pins.js?v=10';
import { createMissionSelection } from '../missions/mission-selection.js?v=22';
import { createRouteLayer, loadRoutes } from '../routes/route-layer.js?v=22';

(async () => {
    const container = document.getElementById("mars-globe");
    const routeData = loadRoutes(MISSIONS); // fetch while the viewer starts

    const ellipsoid = new Cesium.Ellipsoid(MARS_RADIUS, MARS_RADIUS, MARS_RADIUS);
    Cesium.Ellipsoid.default = ellipsoid;
    const fallback = new Cesium.EllipsoidTerrainProvider({ ellipsoid });

    const viewer = new Cesium.Viewer("mars-globe", {
        globe:                new Cesium.Globe(ellipsoid),
        terrainProvider:      fallback,
        baseLayer:            false,
        baseLayerPicker:      false,
        geocoder:             false,
        homeButton:           false,
        sceneModePicker:      false,
        navigationHelpButton: false,
        animation:            false,
        timeline:             false,
        skyBox:               false,
        shouldAnimate:        true
    });

    void createMarsSkybox(viewer).catch(error => {
        console.error('Mars skybox could not be loaded', error);
        document.getElementById('skybox-error').hidden = false;
    });

    if (viewer.scene.sun)             viewer.scene.sun.show = false;
    if (viewer.scene.moon)            viewer.scene.moon.show = false;
    if (viewer.scene.skyAtmosphere)   viewer.scene.skyAtmosphere.show = false;
    viewer.scene.fog.enabled                = false;
    viewer.scene.backgroundColor            = Cesium.Color.BLACK;
    viewer.scene.globe.baseColor            = new Cesium.Color(0.12, 0.06, 0.03, 1.0);
    viewer.scene.globe.showGroundAtmosphere = false;
    viewer.scene.globe.enableLighting       = true;
    // Cesium default. 1 loads ~4x more imagery tiles and made zooming stutter.
    viewer.scene.globe.maximumScreenSpaceError = 2;
    viewer.scene.globe.tileCacheSize = 512;
    viewer.scene.light = new Cesium.DirectionalLight({
        direction: new Cesium.Cartesian3(1.0, 0.0, 0.0),
        color:     Cesium.Color.WHITE,
        intensity: 1.5
    });


    const { enterInteractiveMode, onEnterInteractive } = createMarsCamera(container, viewer);

    // Pins never show in the showcase; in exploration they need a zoom-in first.
    let selection;
    const pins = createMissionPins(viewer, ellipsoid, MISSIONS, {
        onSelect: mission => selection.select(mission),
    });
    onEnterInteractive(() => pins.enable());

    // Stage 3: routes appear when zoomed close or when their pin is selected.
    const routes = createRouteLayer(viewer, ellipsoid, await routeData);
    selection = createMissionSelection(viewer, ellipsoid, { pins, routes, missions: MISSIONS });

    const imagery  = viewer.imageryLayers.addImageryProvider(createVikingImagery(ellipsoid));
    const controls = createTerrainControls(viewer, imagery, enterInteractiveMode, ellipsoid);
    const address      = document.getElementById('terrain-url');
    const errorMessage = document.getElementById('terrain-error');
    const connection   = document.getElementById('terrain-connection');
    const status       = document.getElementById('terrain-status');

    address.value = initialTerrainUrl();

    let generation = 0;
    let removeProviderError;

    function setStatus(text, state) {
        status.textContent  = text;
        status.dataset.state = state;
    }

    function withTimeout(promise) {
        let timer;
        return Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('CTOD yanıtı zaman aşımına uğradı.')), terrainTimeoutMs);
        })]).finally(() => clearTimeout(timer));
    }

    async function loadTerrain() {
        const current = ++generation;
        removeProviderError?.();
        removeProviderError = undefined;
        controls.setReady(false);
        viewer.terrainProvider = fallback;
        errorMessage.hidden    = true;
        setStatus('CTOD bağlantısı ve yükseklikler doğrulanıyor…', 'loading');
        try {
            const url      = normalizeTerrainUrl(address.value.trim());
            const response = await fetch(`${url}/layer.json`, {
                signal: AbortSignal.timeout(terrainTimeoutMs), cache: 'no-store'
            });
            if (!response.ok) throw new Error(`Terrain metadata: HTTP ${response.status}`);
            const metadata = await response.json();
            if (metadata.body !== 'mars' || !Array.isArray(metadata.ellipsoid) ||
                metadata.ellipsoid.length !== 3 ||
                metadata.ellipsoid.some(radius => radius !== MARS_RADIUS)) {
                throw new Error('CTOD Mars modeli güncel değil veya küre yarıçapı uyuşmuyor.');
            }
            const provider = await withTimeout(Cesium.CesiumTerrainProvider.fromUrl(url, {
                ellipsoid, requestVertexNormals: true, requestMetadata: false
            }));
            if (current !== generation) return;
            const probes = [Cesium.Cartographic.fromDegrees(-133.8, 18.65),
                            Cesium.Cartographic.fromDegrees(70.5, 40)];
            const level   = Math.min(8, (metadata.available?.length ?? 1) - 1);
            const samples = await withTimeout(Cesium.sampleTerrain(provider, level, probes, true));
            if (samples.some(point => !Number.isFinite(point.height))) {
                throw new Error('Terrain tile verisinden yükseklik okunamadı.');
            }
            if (current !== generation) return;
            const resolution = Math.round(metadata.sourceResolutionMeters ?? 200);
            const readyText = `3B arazi etkin · HRSC/MOLA ≈${resolution} m`;
            removeProviderError = monitorTerrain(provider, {
                onFailure({ key, count, error }) {
                    if (current !== generation) return;
                    console.error(`Mars terrain tile ${key} failed`, error);
                    setStatus(`3B arazi: ${count} bölge alınamadı. Yeniden deneyin.`, 'warning');
                    errorMessage.hidden = false;
                    errorMessage.textContent = `Tile ${key}: ${error.message ?? error}`;
                    connection.open = true;
                },
                onRecovered() {
                    if (current !== generation) return;
                    setStatus(readyText, 'ready');
                    errorMessage.hidden = true;
                }
            });
            viewer.terrainProvider = provider;
            controls.setProvider(provider);
            controls.setReady(true);
            saveTerrainUrl(url);
            address.value   = url;
            connection.open = false;
            setStatus(readyText, 'ready');
        } catch (error) {
            if (current !== generation) return;
            console.error('Mars terrain unavailable', error);
            connection.open = true;
            setStatus('3B arazi bağlı değil — yalnızca yüzey görüntüsü gösteriliyor.', 'error');
            errorMessage.hidden    = false;
            errorMessage.textContent = error instanceof TypeError
                ? `CTOD yanıtı okunamadı. CORS ayarında bu origin'e izin verilmeli: ${location.origin}.`
                : error.message;
        }
    }

    const lightOffset = new Cesium.Cartesian3();
    viewer.scene.preRender.addEventListener(() => {
        // Oblique inspection light reveals slopes that a camera-aligned light flattens.
        const direction = viewer.scene.light.direction;
        Cesium.Cartesian3.clone(viewer.camera.directionWC, direction);
        Cesium.Cartesian3.multiplyByScalar(viewer.camera.rightWC, .65, lightOffset);
        Cesium.Cartesian3.add(direction, lightOffset, direction);
        Cesium.Cartesian3.multiplyByScalar(viewer.camera.upWC, -.35, lightOffset);
        Cesium.Cartesian3.add(direction, lightOffset, direction);
        Cesium.Cartesian3.normalize(direction, direction);
    });

    document.getElementById('terrain-form').addEventListener('submit', event => {
        event.preventDefault();
        if (address.value) void loadTerrain();
    });

    if (address.value) void loadTerrain();
})();
