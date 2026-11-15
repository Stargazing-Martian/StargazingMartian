import { DUST_STOPS, dustPixels, fetchDustProduct, sampleDust } from './dust-data.js?v=1';
import { TEMPERATURE_STOPS, temperaturePixels, fetchTemperatureProduct,
    sampleTemperature, kelvinToCelsius } from './temperature-data.js?v=1';

const formatDate = value => new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
}).format(new Date(value));
const number = value => value.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
const utc = value => new Date(value * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC');

const MODES = {
    dust: {
        prefix: 'dust-map', directory: 'tes-dust', stops: DUST_STOPS,
        fetch: fetchDustProduct, pixels: dustPixels, sample: sampleDust,
        credit: 'NASA PDS · MGS/TES · Montabone et al. (2023) · doi:10.17189/kwez-jq47',
        period: p => `Girdi gözlemleri (UTC): ${formatDate(p.observationStart)} – ${formatDate(p.observationEnd)} · ` +
            `Mars yılı ${p.marsYear}, yılın solu ${p.solOfYear}.`,
        describe: sample => {
            const v = sample.values;
            return `τ₆₁₀ = ${number(v.CDOD610)} · Belirsizlik: ${number(v.CDOD610UNC)}\n` +
                `${v.CDODNUM} gözlem · ${v.CDODTW} sol pencere · Güvenilirlik: ${number(v.CDODREL)}.\n` +
                '6° × 3° bölgesel atmosfer bağlamıdır; rota noktasındaki yerel ölçüm değildir.';
        },
    },
    temperature: {
        prefix: 'temperature-map', directory: 'tes-temperature', stops: TEMPERATURE_STOPS,
        fetch: fetchTemperatureProduct, pixels: temperaturePixels, sample: sampleTemperature,
        credit: 'NASA PDS · MGS/TES TSURF · Stargazing bölgesel ortalaması · doi:10.17189/kwez-jq47',
        period: p => `Kullanılan gözlemler (UTC): ${formatDate(p.observationStart)} – ${formatDate(p.observationEnd)}. ` +
            'Yerel gerçek güneş saati: 13:00–15:00.',
        describe: sample => {
            const v = sample.values;
            return `Ortalama yüzey sıcaklığı: ${number(kelvinToCelsius(v.MEAN_K))} °C (${number(v.MEAN_K)} K)\n` +
                `Gözlenen aralık: ${number(kelvinToCelsius(v.MIN_K))} – ${number(kelvinToCelsius(v.MAX_K))} °C · ${v.COUNT} gözlem.\n` +
                (v.STD_K === null ? 'Yayılım: tek gözlemle hesaplanamaz.\n' :
                    `Örnek yayılımı (s): ${number(v.STD_K)} K; ölçüm hatası değildir.\n`) +
                `Bu hücrenin gözlemleri: ${utc(v.FIRST_UTC)} – ${utc(v.LAST_UTC)}.\n` +
                `Yerel güneş saati: ${number(v.LTST_MIN)}–${number(v.LTST_MAX)} saat.\n` +
                '6° × 3° hücredeki gündüz gözlemlerinin ortalamasıdır; hava sıcaklığı veya rover ölçümü değildir.';
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
    let layer, activeProduct, activeView, pending;
    let generation = 0, destroyed = false;
    const cache = new Map();

    async function getCatalog(view) {
        if (!view.catalogPromise) {
            view.catalogPromise = fetch(view.catalogUrl, { signal: AbortSignal.timeout(15000) }).then(async response => {
                if (!response.ok) throw new Error(`NASA veri kataloğu: HTTP ${response.status}`);
                const catalog = await response.json();
                if (catalog.schemaVersion !== 1 || catalog.grid?.width !== 60 || catalog.grid?.height !== 60 ||
                    catalog.grid.longitudeStart !== -180 || catalog.grid.latitudeStart !== 88.5 ||
                    catalog.grid.longitudeStep !== 6 || catalog.grid.latitudeStep !== -3 ||
                    !Array.isArray(catalog.products) || !catalog.products.length ||
                    !catalog.products.some(entry => entry.id === catalog.defaultProduct) ||
                    (view.key === 'temperature' && (catalog.quantity?.unit !== 'Kelvin' || catalog.quantity.sourceField !== 'TSURF'))) {
                    throw new Error('NASA veri kataloğu desteklenmiyor.');
                }
                view.select.replaceChildren(...catalog.products.map(entry => {
                    const option = document.createElement('option');
                    option.value = entry.id;
                    option.textContent = new Intl.DateTimeFormat('tr-TR', {
                        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
                    }).formatRange(new Date(entry.observationStart), new Date(entry.observationEnd));
                    return option;
                }));
                view.select.value = catalog.defaultProduct;
                return catalog;
            }).catch(error => { view.catalogPromise = undefined; throw error; });
        }
        return view.catalogPromise;
    }

    function clearLayer() {
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
        const view = views[mode.value];
        if (!view || destroyed) return;
        view.status.dataset.state = 'loading';
        view.status.textContent = 'NASA gözlem dönemi yükleniyor…';
        view.select.disabled = true;
        view.loadingGeneration = current;
        const controller = new AbortController();
        pending = controller;
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const catalog = await getCatalog(view);
            if (current !== generation || destroyed) return;
            const entry = catalog.products.find(item => item.id === view.select.value);
            if (!entry) throw new Error('NASA gözlem dönemi seçilemedi.');
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
            if (controller.signal.aborted) throw new DOMException('NASA yüklemesi zaman aşımına uğradı.', 'AbortError');
            layer = viewer.imageryLayers.add(new Cesium.ImageryLayer(provider, {
                minificationFilter: Cesium.TextureMinificationFilter.NEAREST,
                magnificationFilter: Cesium.TextureMagnificationFilter.NEAREST,
            }));
            surfaceControls.setScientificMode(true);
            activeProduct = product; activeView = view;
            view.legend.hidden = false;
            view.status.dataset.state = 'ready';
            view.status.textContent = `NASA TES · ${number(100 * product.validCount / 3600)}% geçerli grid noktası`;
            view.periodText.textContent = view.period(product);
            view.source.href = entry.sourceUrl;
            view.source.hidden = false;
            view.productId.textContent = entry.sourceLidvid ?? entry.lidvid;
            view.sampleButton.disabled = false;
            view.reading.textContent = 'Bir bölgenin sayısal değerini okumak için Shift+tıkla veya merkezdeki bölgeyi seç.';
            viewer.scene.requestRender();
        } catch (error) {
            if (current !== generation || destroyed) return;
            clearLayer();
            view.status.dataset.state = 'error';
            view.status.textContent = `${error.name === 'AbortError' ? 'NASA verisi zamanında yüklenemedi.' : error.message} Yüzey görünümü etkin.`;
            view.retryButton.hidden = false;
        } finally {
            clearTimeout(timeout);
            if (view.loadingGeneration === current) view.select.disabled = false;
            if (current === generation) pending = undefined;
        }
    }

    function inspect(position) {
        if (!activeProduct || !activeView) return;
        const ray = viewer.camera.getPickRay(position);
        const hit = ray && viewer.scene.globe.pick(ray, viewer.scene);
        if (!hit) {
            activeView.reading.textContent = 'Bu noktada Mars yüzeyi bulunamadı. Küre üzerindeki bir bölgeyi seçin.';
            return;
        }
        const point = ellipsoid.cartesianToCartographic(hit);
        const lon = Cesium.Math.toDegrees(point.longitude), lat = Cesium.Math.toDegrees(point.latitude);
        const sample = activeView.sample(activeProduct, lon, lat);
        const location = `${number(lat)}° enlem, ${number(lon)}° doğu boylamı`;
        activeView.reading.textContent = sample.missing ? `${location}: bu gözlem döneminde geçerli veri yok.` :
            `${location}\nGrid merkezi: ${number(sample.latitude)}°, ${number(sample.longitude)}°\n${activeView.describe(sample)}`;
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
