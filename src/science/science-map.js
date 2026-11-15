import { DUST_STOPS, dustPixels, fetchDustProduct, sampleDust } from './dust-data.js?v=2';
import { TEMPERATURE_STOPS, temperaturePixels, fetchTemperatureProduct,
    sampleTemperature, kelvinToCelsius } from './temperature-data.js?v=2';
import { matchingPeriods } from './mission-environment-data.js?v=2';
import { createRadiationMap } from './radiation-map.js?v=1';

const formatDate = value => new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
}).format(new Date(value));
const number = value => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
const utc = value => new Date(value * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');

const MODES = {
    dust: {
        prefix: 'dust-map', directory: 'tes-dust', stops: DUST_STOPS,
        fetch: fetchDustProduct, pixels: dustPixels, sample: sampleDust,
        credit: 'NASA PDS · MGS/TES · Montabone et al. (2023) · doi:10.17189/kwez-jq47',
        period: p => `Input observations (UTC): ${formatDate(p.observationStart)} – ${formatDate(p.observationEnd)} · ` +
            `Mars year ${p.marsYear}, sol of year ${p.solOfYear}.`,
        describe: sample => {
            const v = sample.values;
            return `τ₆₁₀ = ${number(v.CDOD610)} · Uncertainty: ${number(v.CDOD610UNC)}\n` +
                `${v.CDODNUM} observations · ${v.CDODTW}-sol window · Reliability: ${number(v.CDODREL)}.\n` +
                'Regional 6° × 3° atmospheric context, not a local measurement at a route point.';
        },
    },
    temperature: {
        prefix: 'temperature-map', directory: 'tes-temperature', stops: TEMPERATURE_STOPS,
        fetch: fetchTemperatureProduct, pixels: temperaturePixels, sample: sampleTemperature,
        credit: 'NASA PDS · MGS/TES TSURF · Stargazing regional average · doi:10.17189/kwez-jq47',
        period: p => `Observations used (UTC): ${formatDate(p.observationStart)} – ${formatDate(p.observationEnd)}. ` +
            'Local true solar time: 13:00–15:00.',
        describe: sample => {
            const v = sample.values;
            return `Mean surface temperature: ${number(kelvinToCelsius(v.MEAN_K))} °C (${number(v.MEAN_K)} K)\n` +
                `Observed range: ${number(kelvinToCelsius(v.MIN_K))} – ${number(kelvinToCelsius(v.MAX_K))} °C · ${v.COUNT} observations.\n` +
                (v.STD_K === null ? 'Spread: cannot be computed from a single observation.\n' :
                    `Sample spread (s): ${number(v.STD_K)} K; not measurement error.\n`) +
                `Observations in this cell: ${utc(v.FIRST_UTC)} – ${utc(v.LAST_UTC)}.\n` +
                `Local solar time: ${number(v.LTST_MIN)}–${number(v.LTST_MAX)} h.\n` +
                'Average of daytime observations in a 6° × 3° cell; not air temperature or a rover measurement.';
        },
    },
};

// A single owner for layer lifecycle and appearance, so modes cannot overlap or
// restore topographic colors while another science layer is still active.
export function createScienceMaps(viewer, ellipsoid, surfaceControls) {
    const Cesium = globalThis.Cesium;
    const mode = document.getElementById('science-map-mode');
    const views = Object.fromEntries(Object.entries(MODES).map(([key, config]) => {
        const byId = suffix => document.getElementById(`${config.prefix}-${suffix}`);
        const view = { ...config, key, panel: byId('panel'), select: byId('product'), status: byId('status'),
            periodText: byId('period'), legend: byId('legend'), reading: byId('reading'),
            sampleButton: byId('sample'), retryButton: byId('retry'), source: byId('source'), productId: byId('id'),
            catalogUrl: new URL(`../../data/science/${config.directory}/manifest.json`, import.meta.url) };
        byId('ramp').style.background = `linear-gradient(to right, ${config.stops.map(
            ([stop, rgb]) => `rgb(${rgb.join(',')}) ${stop * 100}%`).join(', ')})`;
        return [key, view];
    }));
    let layer, activeProduct, activeView, pending, context;
    let generation = 0, destroyed = false;
    const cache = new Map();
    const radiation = createRadiationMap(viewer, ellipsoid, surfaceControls);

    async function getCatalog(view) {
        if (!view.catalogPromise) {
            view.catalogPromise = fetch(view.catalogUrl, { signal: AbortSignal.timeout(15000) }).then(async response => {
                if (!response.ok) throw new Error(`NASA data catalogue: HTTP ${response.status}`);
                const catalog = await response.json();
                if (catalog.schemaVersion !== 1 || catalog.grid?.width !== 60 || catalog.grid?.height !== 60 ||
                    catalog.grid.longitudeStart !== -180 || catalog.grid.latitudeStart !== 88.5 ||
                    catalog.grid.longitudeStep !== 6 || catalog.grid.latitudeStep !== -3 ||
                    !Array.isArray(catalog.products) || !catalog.products.length ||
                    !catalog.products.some(entry => entry.id === catalog.defaultProduct) ||
                    (view.key === 'temperature' && (catalog.quantity?.unit !== 'Kelvin' || catalog.quantity.sourceField !== 'TSURF'))) {
                    throw new Error('NASA data catalogue is not supported.');
                }
                return catalog;
            }).catch(error => { view.catalogPromise = undefined; throw error; });
        }
        return view.catalogPromise;
    }

    function periods(view, catalog) {
        const previous = view.select.value;
        const entries = context ? matchingPeriods(catalog.products, context.utc) : catalog.products;
        view.select.replaceChildren(...entries.map(entry => {
            const option = document.createElement('option');
            option.value = entry.id;
            option.textContent = new Intl.DateTimeFormat('en-GB', {
                day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
            }).formatRange(new Date(entry.observationStart), new Date(entry.observationEnd));
            return option;
        }));
        view.select.value = entries.some(e => e.id === previous) ? previous :
            entries.some(e => e.id === catalog.defaultProduct) ? catalog.defaultProduct : entries[0]?.id ?? '';
        return entries;
    }

    function clearLayer() {
        radiation.deactivate();
        if (layer) viewer.imageryLayers.remove(layer, true);
        layer = activeProduct = activeView = undefined;
        surfaceControls.setScientificMode(false);
        for (const view of Object.values(views)) {
            view.sampleButton.disabled = true;
            view.legend.hidden = true;
            view.reading.textContent = '';
            view.source.hidden = true;
            view.productId.textContent = '';
            view.periodText.textContent = '';
            view.retryButton.hidden = true;
        }
        viewer.scene.requestRender();
    }

    async function refresh() {
        const current = ++generation;
        pending?.abort();
        clearLayer();
        for (const view of Object.values(views)) view.panel.hidden = mode.value !== view.key;
        if (mode.value === 'radiation' && !destroyed) { await radiation.activate(); return; }
        const view = views[mode.value];
        if (!view || destroyed) return;
        view.status.dataset.state = 'loading';
        view.status.textContent = 'Loading NASA observation period…';
        view.select.disabled = true;
        view.loadingGeneration = current;
        const controller = new AbortController();
        pending = controller;
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const catalog = await getCatalog(view);
            if (current !== generation || destroyed) return;
            const entries = periods(view, catalog);
            if (context && !entries.length) {
                view.status.dataset.state = 'missing';
                view.status.textContent = context.utc ?
                    'This sample archive has no map period overlapping the observation. Surface view is active.' :
                    'No supported UTC observation for this mission/time. No date matching was performed; surface view is active.';
                return;
            }
            const entry = entries.find(item => item.id === view.select.value);
            if (!entry) throw new Error('Could not select a NASA observation period.');
            const cacheKey = `${view.key}/${entry.id}`;
            let product = cache.get(cacheKey);
            if (!product) {
                product = await view.fetch(entry, view.catalogUrl, { signal: controller.signal });
                cache.set(cacheKey, product);
                if (cache.size > 4) cache.delete(cache.keys().next().value);
            }
            if (current !== generation || destroyed) return;
            const canvas = document.createElement('canvas');
            canvas.width = 120; canvas.height = 60;
            canvas.getContext('2d').putImageData(new ImageData(view.pixels(product), 120, 60), 0, 0);
            const provider = await Cesium.SingleTileImageryProvider.fromUrl(canvas.toDataURL('image/png'), {
                ellipsoid, credit: view.credit,
            });
            if (current !== generation || destroyed) return;
            if (controller.signal.aborted) throw new DOMException('NASA download timed out.', 'AbortError');
            layer = viewer.imageryLayers.add(new Cesium.ImageryLayer(provider, {
                minificationFilter: Cesium.TextureMinificationFilter.NEAREST,
                magnificationFilter: Cesium.TextureMagnificationFilter.NEAREST,
            }));
            surfaceControls.setScientificMode(true);
            activeProduct = product; activeView = view;
            view.legend.hidden = false;
            view.status.dataset.state = 'ready';
            view.status.textContent = `NASA TES · ${number(100 * product.validCount / 3600)}% valid grid points`;
            view.periodText.textContent = view.period(product);
            view.source.href = entry.sourceUrl;
            view.source.hidden = false;
            view.productId.textContent = entry.sourceLidvid ?? entry.lidvid;
            view.sampleButton.disabled = false;
            view.reading.textContent = 'Shift+click a region, or read the region at the centre, to see its value.';
            if (context && Number.isFinite(context.longitude) && Number.isFinite(context.latitude)) {
                const sample = view.sample(product, context.longitude, context.latitude);
                let detail = sample.missing ? 'No valid regional data in this cell.' : view.describe(sample);
                if (view.key === 'temperature' && !sample.missing) {
                    const day = context.utc.slice(0, 10);
                    const first = new Date(sample.values.FIRST_UTC * 1000).toISOString().slice(0, 10);
                    const last = new Date(sample.values.LAST_UTC * 1000).toISOString().slice(0, 10);
                    if (day < first || day > last) {
                        detail = `Observations in this cell span ${first} – ${last}. ` +
                            `No local temperature match for ${day}; no temperature assigned to that day.`;
                    }
                }
                view.reading.textContent = `${context.mission} landing-region reference cell (not the exact rover observation position):\n` +
                    detail +
                    '\nPeriod overlap only; not weather measured on the same day at the same position.';
            }
            viewer.scene.requestRender();
        } catch (error) {
            if (current !== generation || destroyed) return;
            clearLayer();
            view.status.dataset.state = 'error';
            view.status.textContent = `${error.name === 'AbortError' ? 'NASA data did not load in time.' : error.message} Surface view is active.`;
            view.retryButton.hidden = false;
        } finally {
            clearTimeout(timeout);
            if (view.loadingGeneration === current) view.select.disabled = !view.select.options.length;
            if (current === generation) pending = undefined;
        }
    }

    function inspect(position) {
        if (mode.value === 'radiation') { radiation.inspect(position); return; }
        if (!activeProduct || !activeView) return;
        const ray = viewer.camera.getPickRay(position);
        const hit = ray && viewer.scene.globe.pick(ray, viewer.scene);
        if (!hit) {
            activeView.reading.textContent = 'No Mars surface at this point. Pick a region on the globe.';
            return;
        }
        const point = ellipsoid.cartesianToCartographic(hit);
        const lon = Cesium.Math.toDegrees(point.longitude), lat = Cesium.Math.toDegrees(point.latitude);
        const sample = activeView.sample(activeProduct, lon, lat);
        const location = `${number(lat)}° latitude, ${number(lon)}° east longitude`;
        activeView.reading.textContent = sample.missing ? `${location}: no valid data in this observation period.` :
            `${location}\nGrid merkezi: ${number(sample.latitude)}°, ${number(sample.longitude)}°\n${activeView.describe(sample)}`;
        if (context) activeView.reading.textContent += '\nThis is the region picked on the map, not the exact rover observation position. Time overlap is with the period only.';
    }

    const picker = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    picker.setInputAction(({ position }) => inspect(position),
        Cesium.ScreenSpaceEventType.LEFT_CLICK, Cesium.KeyboardEventModifier.SHIFT);
    const inspectCenter = () => inspect(new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2));
    mode.addEventListener('change', refresh);
    for (const view of Object.values(views)) {
        view.select.addEventListener('change', refresh);
        view.sampleButton.addEventListener('click', inspectCenter);
        view.retryButton.addEventListener('click', refresh);
    }
    return {
        setContext(value) {
            context = value;
            document.getElementById('science-map-context').textContent = value ?
                `${value.mission ?? 'Mission'} · ${value.utc ?? 'no UTC observation'} · overlapping map periods only. ` +
                    'Regional averages are not instantaneous weather.' : 'Free archive browsing · no mission/date association.';
            refresh();
        },
        destroy() {
            destroyed = true; ++generation; pending?.abort(); clearLayer(); cache.clear(); picker.destroy();
            mode.removeEventListener('change', refresh);
            for (const view of Object.values(views)) {
                view.select.removeEventListener('change', refresh);
                view.sampleButton.removeEventListener('click', inspectCenter);
                view.retryButton.removeEventListener('click', refresh);
            }
        },
    };
}
