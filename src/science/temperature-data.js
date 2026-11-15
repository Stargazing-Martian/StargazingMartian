import { gridCell, MISSING_COLOR } from './dust-data.js?v=1';

export const TEMPERATURE_FIELDS = ['MEAN_K', 'MIN_K', 'MAX_K', 'STD_K', 'COUNT',
    'LTST_MEAN', 'LTST_MIN', 'LTST_MAX', 'FIRST_UTC', 'LAST_UTC'];
export const TEMPERATURE_STOPS = [
    [0, [20, 20, 70]], [.25, [53, 86, 160]], [.5, [79, 170, 183]],
    [.75, [245, 164, 63]], [1, [255, 65, 28]],
];
export const kelvinToCelsius = value => value - 273.15;

export function validateTemperatureProduct(product, entry) {
    if (product?.schemaVersion !== 1 || product.id !== entry.id ||
        product.sourceLidvid !== entry.sourceLidvid || product.sourceSha256 !== entry.sourceSha256 ||
        product.selectionStart !== entry.selectionStart || product.selectionEnd !== entry.selectionEnd ||
        product.observationStart !== entry.observationStart || product.observationEnd !== entry.observationEnd ||
        product.localTimeStart !== 13 || product.localTimeEndExclusive !== 15 ||
        product.measurementUncertaintyK !== null) throw new Error('NASA sıcaklık ürünü veya gözlem dönemi uyuşmuyor.');
    for (const name of TEMPERATURE_FIELDS) {
        const values = product.fields?.[name];
        if (!Array.isArray(values) || values.length !== 3600 || values.some(v => v !== null && !Number.isFinite(v))) {
            throw new Error('NASA sıcaklık haritasının sayısal verisi geçersiz.');
        }
    }
    const first = Date.parse(product.selectionStart) / 1000;
    const last = Date.parse(product.selectionEnd) / 1000;
    if (!Number.isFinite(first) || !Number.isFinite(last) || first >= last) throw new Error('Sıcaklık tarih aralığı geçersiz.');
    let count = 0, retrievals = 0;
    for (let i = 0; i < 3600; i++) {
        const v = Object.fromEntries(TEMPERATURE_FIELDS.map(name => [name, product.fields[name][i]]));
        if (v.MEAN_K === null) {
            if (Object.values(v).some(value => value !== null)) throw new Error('Sıcaklık eksik veri maskesi tutarsız.');
            continue;
        }
        if (TEMPERATURE_FIELDS.filter(name => name !== 'STD_K').some(name => v[name] === null) ||
            !Number.isInteger(v.COUNT) || v.COUNT < 1 || v.MIN_K <= 0 || v.MIN_K > v.MEAN_K ||
            v.MEAN_K > v.MAX_K || v.LTST_MIN < 13 || v.LTST_MAX >= 15 ||
            v.LTST_MIN > v.LTST_MEAN || v.LTST_MEAN > v.LTST_MAX ||
            !Number.isInteger(v.FIRST_UTC) || !Number.isInteger(v.LAST_UTC) ||
            v.FIRST_UTC < first || v.LAST_UTC > last || v.FIRST_UTC > v.LAST_UTC ||
            (v.COUNT === 1 ? v.STD_K !== null : v.STD_K === null || v.STD_K < 0)) {
            throw new Error('Sıcaklık örnek sayısı, zaman bilgisi veya yayılımı geçersiz.');
        }
        ++count; retrievals += v.COUNT;
    }
    if (count !== entry.validCount || count !== product.validCount ||
        retrievals !== product.selectedRetrievals || retrievals !== entry.selectedRetrievals) {
        throw new Error('Sıcaklık gözlem sayıları uyuşmuyor.');
    }
    return product;
}

export function sampleTemperature(product, longitude, latitude) {
    const cell = gridCell(longitude, latitude);
    return { ...cell, missing: product.fields.MEAN_K[cell.index] === null,
        values: Object.fromEntries(TEMPERATURE_FIELDS.map(name => [name, product.fields[name][cell.index]])) };
}

export function temperatureColor(kelvin) {
    if (kelvin === null) return MISSING_COLOR;
    const t = Math.max(0, Math.min(1, (kelvinToCelsius(kelvin) + 130) / 170));
    const upper = TEMPERATURE_STOPS.findIndex(([stop]) => stop >= t);
    if (upper === 0) return [...TEMPERATURE_STOPS[0][1], 255];
    const [from, a] = TEMPERATURE_STOPS[upper - 1], [to, b] = TEMPERATURE_STOPS[upper];
    return [...a.map((channel, i) => Math.round(channel + (b[i] - channel) * (t - from) / (to - from))), 255];
}

export function temperaturePixels(product) {
    const pixels = new Uint8ClampedArray(120 * 60 * 4);
    for (let y = 0; y < 60; y++) for (let x = 0; x < 120; x++) {
        const { index } = gridCell(-180 + (x + .5) * 3, 90 - (y + .5) * 3);
        pixels.set(temperatureColor(product.fields.MEAN_K[index]), (y * 120 + x) * 4);
    }
    return pixels;
}

export async function fetchTemperatureProduct(entry, baseUrl, { signal, fetcher = fetch } = {}) {
    const response = await fetcher(new URL(entry.file, baseUrl), { signal });
    if (!response.ok) throw new Error(`NASA sıcaklık dosyası: HTTP ${response.status}`);
    const raw = await response.arrayBuffer();
    if (globalThis.crypto?.subtle) {
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)),
            v => v.toString(16).padStart(2, '0')).join('');
        if (hash !== entry.sha256) throw new Error('NASA sıcaklık dosyasının bütünlüğü doğrulanamadı.');
    }
    return validateTemperatureProduct(JSON.parse(new TextDecoder().decode(raw)), entry);
}
