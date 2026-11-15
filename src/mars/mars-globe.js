import { createSurfaceImagery } from '../nasa/nasa-layers.js?v=2';
import { MARS_RADIUS, initialTerrainUrl, normalizeTerrainUrl, terrainTimeoutMs } from './config.js?v=7';
import { createTerrainControls } from '../ui/terrain-controls.js?v=10';
import { createMissionEnvironment } from '../ui/mission-environment.js?v=2';
import { createScienceMaps } from '../science/science-map.js?v=4';
import { monitorTerrain } from './terrain-monitor.js';
import { createMarsCamera } from './mars-camera.js?v=7';
import { createMarsSkybox } from './mars-skybox.js';
import { MISSIONS } from '../missions/mission-data.js?v=12';
import { createMissionPins } from '../missions/mission-pins.js?v=12';
import { createMissionSelection } from '../missions/mission-selection.js?v=27';
import { createRouteLayer, loadRoutes } from '../routes/route-layer.js?v=29';
import { createRouteEndpoints } from '../routes/route-endpoints.js?v=2';
import { createMissionPanel } from '../ui/mission-panel.js?v=6';
import { createPhotoViewer } from '../ui/photo-viewer.js?v=5';
import { createCorridorLayer, loadCorridors } from '../network/corridor-layer.js?v=4';
import { createMapModePicker } from '../ui/map-mode-picker.js?v=2';
import { createAbout } from '../ui/about.js?v=1';

// While the globe and the app load, a skeleton screen is shown and
// exploring is held back: the scroll that would start it is swallowed.
const isLoading = () => document.body.classList.contains('is-loading');
window.addEventListener('wheel', event => {
    if (isLoading()) { event.preventDefault(); event.stopImmediatePropagation(); }
}, { capture: true, passive: false });
createAbout();

(async () => {
    const container = document.getElementById("mars-globe");
    let appReady = false;
    // Loaded = first surface tiles on screen and every layer wired up.
    const finishLoading = () => {
        if (!appReady || !container.dataset.surfaceReady || !isLoading()) return;
        document.body.classList.remove('is-loading');
        document.getElementById('loading-screen').setAttribute('aria-busy', 'false');
    };
    const routeData = loadRoutes(MISSIONS); // fetch while the viewer starts
    const corridorData = loadCorridors()
        .catch(error => { console.error('Corridors could not be loaded', error); return undefined; });
    const photoData = fetch('data/photos.json', { cache: 'no-cache' })
        .then(response => response.json())
        .catch(error => { console.error('Photos could not be loaded', error); return {}; });

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
        // Route clicks are handled by mission-selection; Cesium's own entity
        // info box and selection marker would pop up on top of them.
        infoBox:              false,
        selectionIndicator:   false,
        animation:            false,
        timeline:             false,
        skyBox:               false,
        shouldAnimate:        false,
        requestRenderMode:    true,
        maximumRenderTimeChange: Infinity,
        // Native display pixels, including Retina. Performance work must not
        // silently render a smaller canvas or lower the source tile detail.
        useBrowserRecommendedResolution: false
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
    // Native Retina canvas stays; the tile error budget follows the pixel
    // ratio so the globe needs the same tiles as at 1x (about 4x fewer on a
    // Retina Mac). Waiting for 4x the tiles made the first load very slow.
    viewer.scene.globe.maximumScreenSpaceError = 2 * Math.min(window.devicePixelRatio || 1, 2);
    viewer.scene.postProcessStages.fxaa.enabled = true;
    viewer.scene.globe.tileCacheSize = 512;
    // Load a usable parent before fanning out into many missing children.
    // This changes scheduling only; the final tile level stays unchanged.
    viewer.scene.globe.loadingDescendantLimit = 4;
    viewer.scene.light = new Cesium.DirectionalLight({
        direction: new Cesium.Cartesian3(1.0, 0.0, 0.0),
        color:     Cesium.Color.WHITE,
        intensity: 1.5
    });


    const { enterInteractiveMode, onEnterInteractive } = createMarsCamera(container, viewer);

    // Pins never show in the showcase; in exploration they need a zoom-in first.
    let selection, environment;
    const pins = createMissionPins(viewer, ellipsoid, MISSIONS, {
        onSelect: mission => selection.select(mission),
    });
    onEnterInteractive(() => pins.enable());
    // The logo is large on the showcase and shrinks into the corner for exploring.
    onEnterInteractive(() => document.body.classList.add('is-exploring'));
    document.getElementById('explore-hint').addEventListener('click', () => {
        if (!isLoading()) enterInteractiveMode();
    });

    // Stage 3: routes appear when zoomed close or when their pin is selected.
    const routes = createRouteLayer(viewer, ellipsoid, await routeData);
    createRouteEndpoints(viewer, ellipsoid, routes, MISSIONS.map(m => m.id));
    // Whole-planet expedition corridors, shown from stage 2 like the pins.
    const network = await corridorData;
    const corridors = network && createCorridorLayer(viewer, ellipsoid, network);
    if (corridors) onEnterInteractive(() => corridors.enable());
    selection = createMissionSelection(viewer, ellipsoid, { pins, routes, missions: MISSIONS, corridors });
    createMissionPanel(selection, routes, await photoData, createPhotoViewer());

    const imagery  = createSurfaceImagery(viewer, ellipsoid);
    const controls = createTerrainControls(viewer, imagery);
    const scienceMaps = createScienceMaps(viewer, ellipsoid, controls);
    createMapModePicker();
    environment = createMissionEnvironment(MISSIONS, scienceMaps, async mission => {
        await enterInteractiveMode();
        selection.select(mission);
    });
    const errorMessage = document.getElementById('terrain-error');
    const status       = document.getElementById('terrain-status');

    selection.onChange(({ mission }) => environment.selectMission(mission));
    // The globe opens at true height (1x). Selecting a site or route switches
    // to 5x relief so the local terrain reads; leaving the selection goes back.
    const reliefScale = document.getElementById('relief-scale');
    selection.onChange(({ mission }) => {
        const scale = mission ? '5' : '1';
        if (reliefScale.value === scale) return;
        reliefScale.value = scale;
        reliefScale.dispatchEvent(new Event('change', { bubbles: true }));
    });

    let generation = 0;
    let removeProviderError;

    function setStatus(text, state) {
        status.textContent  = text;
        status.dataset.state = state;
    }

    function withTimeout(promise) {
        let timer;
        return Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('CTOD response timed out.')), terrainTimeoutMs);
        })]).finally(() => clearTimeout(timer));
    }

    async function loadTerrain() {
        const current = ++generation;
        removeProviderError?.();
        removeProviderError = undefined;
        controls.setReady(false);
        viewer.terrainProvider = fallback;
        errorMessage.hidden    = true;
        setStatus('Checking the CTOD connection and heights…', 'loading');
        try {
            const url      = normalizeTerrainUrl(initialTerrainUrl());
            const response = await fetch(`${url}/layer.json`, {
                signal: AbortSignal.timeout(terrainTimeoutMs), cache: 'no-store'
            });
            if (!response.ok) throw new Error(`Terrain metadata: HTTP ${response.status}`);
            const metadata = await response.json();
            if (metadata.body !== 'mars' || !Array.isArray(metadata.ellipsoid) ||
                metadata.ellipsoid.length !== 3 ||
                metadata.ellipsoid.some(radius => radius !== MARS_RADIUS)) {
                throw new Error('CTOD Mars model is out of date or the globe radius does not match.');
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
                throw new Error('Could not read heights from the terrain tiles.');
            }
            if (current !== generation) return;
            const resolution = Math.round(metadata.sourceResolutionMeters ?? 200);
            const readyText = `3D terrain active · HRSC/MOLA ≈${resolution} m`;
            removeProviderError = monitorTerrain(provider, {
                onFailure({ key, count, error }) {
                    if (current !== generation) return;
                    console.error(`Mars terrain tile ${key} failed`, error);
                    setStatus(`3D terrain: ${count} tiles failed. Try again.`, 'warning');
                    errorMessage.hidden = false;
                    errorMessage.textContent = `Tile ${key}: ${error.message ?? error}`;
                },
                onRecovered() {
                    if (current !== generation) return;
                    setStatus(readyText, 'ready');
                    errorMessage.hidden = true;
                }
            });
            viewer.terrainProvider = provider;
            routes.setTerrain(provider, metadata.version);
            controls.setReady(true);
            const coverage = document.getElementById('terrain-coverage');
            if (metadata.staticCoverage) {
                const { globalMaxZoom, regionalMaxZoom } = metadata.staticCoverage;
                coverage.textContent = `Global terrain through level ${globalMaxZoom}; mission regions through level ${regionalMaxZoom}. ` +
                    'Outside those regions, terrain detail is coarser. Source DEM: approximately 200 m.';
                coverage.hidden = false;
            }
            setStatus(readyText, 'ready');
            document.getElementById('terrain-source').textContent =
                `Terrain: ${new URL(url, location.href).origin}${new URL(url, location.href).pathname} · ${metadata.version}`;
        } catch (error) {
            if (current !== generation) return;
            console.error('Mars terrain unavailable', error);
            setStatus('3D terrain not connected — showing surface imagery only.', 'error');
            errorMessage.hidden    = false;
            errorMessage.textContent = 'Terrain data could not be loaded. Science maps and mission observations remain available.';
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

    // Do not expose an empty dark globe while its first surface tiles arrive.
    // Show it once the imagery tiles are in, or after 3 s at the latest;
    // never wait for the 3D terrain download (tens of MB on a slow link).
    const reveal = () => { container.dataset.surfaceReady = 'true'; revealSurface(); finishLoading(); };
    const revealSurface = viewer.scene.postRender.addEventListener(() => {
        if (viewer.scene.globe.tilesLoaded) reveal();
    });
    setTimeout(reveal, 3000);
    document.addEventListener('visibilitychange', () => {
        viewer.useDefaultRenderLoop = !document.hidden;
        if (!document.hidden) { viewer.resize(); viewer.scene.requestRender(); }
    });

    // Enabled on every host, including GitHub Pages. The source lives in site-config.js.
    // Deferred: the showcase is a far view where relief is invisible, so the
    // heavy terrain tiles start when exploring begins (or after 5 s idle).
    appReady = true;
    finishLoading();
    let terrainStarted = false;
    const startTerrain = () => { if (!terrainStarted) { terrainStarted = true; void loadTerrain(); } };
    onEnterInteractive(startTerrain);
    setTimeout(startTerrain, 5000);
})();
