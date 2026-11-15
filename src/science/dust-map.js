import { DUST_STOPS, dustPixels, fetchDustProduct, sampleDust } from './dust-data.js?v=1';

const CATALOG_URL = new URL('../../data/science/tes-dust/manifest.json', import.meta.url);
const formatDate = value => new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
}).format(new Date(value));
const number = value => value.toLocaleString('tr-TR', { maximumFractionDigits: 2 });

// Uses the existing viewer and terrain. No rover weather, camera flight, or
// route selection is inferred from a global atmospheric reconstruction.
export function createDustMap(viewer, ellipsoid, surfaceControls) {
    const Cesium = globalThis.Cesium;
    const mode = document.getElementById('science-map-mode');
    const panel = document.getElementById('dust-map-panel');
    const select = document.getElementById('dust-map-product');
    const status = document.getElementById('dust-map-status');
    const period = document.getElementById('dust-map-period');
    const legend = document.getElementById('dust-map-legend');
    const reading = document.getElementById('dust-map-reading');
    const sampleButton = document.getElementById('dust-map-sample');
    const retryButton = document.getElementById('dust-map-retry');
    const source = document.getElementById('dust-map-source');
    const productId = document.getElementById('dust-map-id');
    let catalogPromise;
    let layer;
    let activeProduct;
    let pending;
    let generation = 0;
    let destroyed = false;
    const cache = new Map();

    document.getElementById('dust-map-ramp').style.background = `linear-gradient(to right, ${
        DUST_STOPS.map(([stop, rgb]) => `rgb(${rgb.join(',')}) ${stop * 100}%`).join(', ')})`;

    async function getCatalog() {
        if (!catalogPromise) {
            catalogPromise = fetch(CATALOG_URL, { signal: AbortSignal.timeout(15000) }).then(async response => {
                if (!response.ok) throw new Error(`NASA veri kataloğu: HTTP ${response.status}`);
                const catalog = await response.json();
                if (catalog.schemaVersion !== 1 || catalog.grid?.width !== 60 || catalog.grid?.height !== 60 ||
                    catalog.grid.longitudeStep !== 6 || catalog.grid.latitudeStep !== -3 ||
                    !Array.isArray(catalog.products) || !catalog.products.length ||
                    !catalog.products.some(entry => entry.id === catalog.defaultProduct)) {
                    throw new Error('NASA veri kataloğu desteklenmiyor.');
                }
                select.replaceChildren(...catalog.products.map(entry => {
                    const option = document.createElement('option');
                    option.value = entry.id;
                    option.textContent = new Intl.DateTimeFormat('tr-TR', {
                        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
                    }).formatRange(new Date(entry.observationStart), new Date(entry.observationEnd));
                    return option;
                }));
                select.value = catalog.defaultProduct;
                return catalog;
            }).catch(error => { catalogPromise = undefined; throw error; });
        }
        return catalogPromise;
    }

    function clearLayer() {
        if (layer) viewer.imageryLayers.remove(layer, true);
        layer = undefined;
        activeProduct = undefined;
        surfaceControls.setScientificMode(false);
        sampleButton.disabled = true;
        legend.hidden = true;
        reading.textContent = '';
        source.hidden = true;
        productId.textContent = '';
        period.textContent = '';
        viewer.scene.requestRender();
    }

    async function refresh() {
        const current = ++generation;
        pending?.abort();
        clearLayer();
        retryButton.hidden = true;
        panel.hidden = mode.value !== 'dust';
        if (panel.hidden || destroyed) return;
        status.dataset.state = 'loading';
        status.textContent = 'NASA gözlem dönemi yükleniyor…';
        select.disabled = true;
        const controller = new AbortController();
        pending = controller;
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const catalog = await getCatalog();
            if (current !== generation || destroyed) return;
            const entry = catalog.products.find(item => item.id === select.value);
            if (!entry) throw new Error('NASA gözlem dönemi seçilemedi.');
            let product = cache.get(entry.id);
            if (!product) {
                product = await fetchDustProduct(entry, CATALOG_URL, { signal: controller.signal });
                cache.set(entry.id, product);
                if (cache.size > 3) cache.delete(cache.keys().next().value);
            }
            if (current !== generation || destroyed) return;
            const canvas = document.createElement('canvas');
            canvas.width = 120; canvas.height = 60;
            canvas.getContext('2d').putImageData(new ImageData(dustPixels(product), 120, 60), 0, 0);
            const provider = await Cesium.SingleTileImageryProvider.fromUrl(canvas.toDataURL('image/png'), {
                ellipsoid,
                credit: 'NASA PDS · MGS/TES · Montabone et al. (2023) · doi:10.17189/kwez-jq47',
            });
            if (current !== generation || destroyed) return;
            layer = viewer.imageryLayers.add(new Cesium.ImageryLayer(provider, {
                minificationFilter: Cesium.TextureMinificationFilter.NEAREST,
                magnificationFilter: Cesium.TextureMagnificationFilter.NEAREST,
            }));
            surfaceControls.setScientificMode(true);
            activeProduct = product;
            legend.hidden = false;
            status.dataset.state = 'ready';
            status.textContent = `NASA TES · ${number(100 * product.validCount / 3600)}% geçerli grid noktası`;
            period.textContent = `Girdi gözlemleri (UTC): ${formatDate(product.observationStart)} – ${
                formatDate(product.observationEnd)} · Mars yılı ${product.marsYear}, yılın solu ${product.solOfYear}.`;
            source.href = entry.sourceUrl;
            source.hidden = false;
            productId.textContent = entry.lidvid;
            sampleButton.disabled = false;
            reading.textContent = 'Bir bölgenin sayısal değerini okumak için Shift+tıkla veya merkezdeki bölgeyi seç.';
            viewer.scene.requestRender();
        } catch (error) {
            if (current !== generation || destroyed) return;
            clearLayer();
            status.dataset.state = 'error';
            status.textContent = `${error.name === 'AbortError' ? 'NASA verisi zamanında yüklenemedi.' : error.message} Yüzey görünümü etkin.`;
            retryButton.hidden = false;
        } finally {
            clearTimeout(timeout);
            if (current === generation) {
                select.disabled = false;
                pending = undefined;
            }
        }
    }

    function inspect(position) {
        if (!activeProduct) return;
        const ray = viewer.camera.getPickRay(position);
        const hit = ray && viewer.scene.globe.pick(ray, viewer.scene);
        if (!hit) {
            reading.textContent = 'Bu noktada Mars yüzeyi bulunamadı. Küre üzerindeki bir bölgeyi seçin.';
            return;
        }
        const point = ellipsoid.cartesianToCartographic(hit);
        const lon = Cesium.Math.toDegrees(point.longitude), lat = Cesium.Math.toDegrees(point.latitude);
        const sample = sampleDust(activeProduct, lon, lat);
        const location = `${number(lat)}° enlem, ${number(lon)}° doğu boylamı`;
        if (sample.missing) {
            reading.textContent = `${location}: bu gözlem döneminde geçerli veri yok.`;
            return;
        }
        const v = sample.values;
        reading.textContent = `${location}\nτ₆₁₀ = ${number(v.CDOD610)} · Belirsizlik: ${number(v.CDOD610UNC)}\n` +
            `Grid merkezi: ${number(sample.latitude)}°, ${number(sample.longitude)}° · ${v.CDODNUM} gözlem · ` +
            `${v.CDODTW} sol pencere · Güvenilirlik: ${number(v.CDODREL)}.\n` +
            'Bu değer 6° × 3° bölgesel atmosfer bağlamıdır; rota noktasındaki yerel ölçüm değildir.';
    }

    const picker = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    picker.setInputAction(({ position }) => inspect(position),
        Cesium.ScreenSpaceEventType.LEFT_CLICK, Cesium.KeyboardEventModifier.SHIFT);
    const inspectCenter = () => inspect(new Cesium.Cartesian2(
        viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2));
    mode.addEventListener('change', refresh);
    select.addEventListener('change', refresh);
    sampleButton.addEventListener('click', inspectCenter);
    retryButton.addEventListener('click', refresh);
    return {
        destroy() {
            destroyed = true; ++generation; pending?.abort(); clearLayer(); cache.clear(); picker.destroy();
            mode.removeEventListener('change', refresh);
            select.removeEventListener('change', refresh);
            sampleButton.removeEventListener('click', inspectCenter);
            retryButton.removeEventListener('click', refresh);
        },
    };
}
