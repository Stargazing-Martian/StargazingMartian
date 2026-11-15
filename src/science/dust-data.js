// Numeric data stays separate from display colors. No interpolation or risk thresholds.
export const GRID_SIZE = 3600;
export const DUST_FIELDS = ['CDODNUM', 'CDODTW', 'CDODREL', 'CDOD610', 'CDOD610UNC',
    'CDOD610RMSD', 'CDODTOT', 'CDODTOTUNC'];
export const DUST_STOPS = [
    [0, [0, 34, 78]], [.25, [67, 78, 108]], [.5, [124, 123, 120]],
    [.75, [188, 173, 108]], [1, [255, 233, 69]],
];
export const MISSING_COLOR = [170, 177, 185, 255];

export function validateDustProduct(product, entry) {
    if (product?.schemaVersion !== 1 || product.id !== entry.id || product.lidvid !== entry.lidvid ||
        product.observationStart !== entry.observationStart || product.observationEnd !== entry.observationEnd ||
        product.sourceSha256 !== entry.sourceSha256 || product.marsYear !== entry.marsYear ||
        product.solOfYear !== entry.solOfYear) throw new Error('NASA ürün kimliği veya gözlem dönemi uyuşmuyor.');
    for (const name of DUST_FIELDS) {
        const values = product.fields?.[name];
        if (!Array.isArray(values) || values.length !== GRID_SIZE ||
            values.some(v => v !== null && !Number.isFinite(v))) throw new Error('NASA harita verisi geçersiz.');
    }
    let validCount = 0;
    for (let i = 0; i < GRID_SIZE; i++) {
        const missing = product.fields.CDOD610[i] === null;
        if (DUST_FIELDS.some(name => (product.fields[name][i] === null) !== missing)) {
            throw new Error('NASA eksik veri maskesi tutarsız.');
        }
        if (missing) continue;
        ++validCount;
        const fields = product.fields;
        if (fields.CDOD610UNC[i] < 0 || fields.CDODTOTUNC[i] < 0 || fields.CDODNUM[i] < 1 ||
            !Number.isInteger(fields.CDODNUM[i]) || ![1, 3, 5, 7].includes(fields.CDODTW[i]) ||
            fields.CDODREL[i] < 0 || fields.CDODREL[i] > 1) throw new Error('NASA kalite bilgisi geçersiz.');
    }
    if (validCount !== entry.validCount || validCount !== product.validCount) {
        throw new Error('NASA haritasının geçerli veri sayısı uyuşmuyor.');
    }
    return product;
}

export function gridCell(longitude, latitude) {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
        throw new Error('Geçersiz Mars koordinatı.');
    }
    const column = Math.floor(((longitude + 183) % 360 + 360) % 360 / 6);
    const row = Math.min(59, Math.floor((90 - latitude) / 3));
    return { index: row * 60 + column, longitude: -180 + column * 6, latitude: 88.5 - row * 3 };
}

export function sampleDust(product, longitude, latitude) {
    const cell = gridCell(longitude, latitude);
    return { ...cell, missing: product.fields.CDOD610[cell.index] === null,
        values: Object.fromEntries(DUST_FIELDS.map(name => [name, product.fields[name][cell.index]])) };
}

export function dustColor(value) {
    if (value === null) return MISSING_COLOR;
    const normalized = Math.max(0, Math.min(1, value / 3));
    const upper = DUST_STOPS.findIndex(([stop]) => stop >= normalized);
    if (upper === 0) return [...DUST_STOPS[0][1], 255];
    const [from, a] = DUST_STOPS[upper - 1], [to, b] = DUST_STOPS[upper];
    const t = (normalized - from) / (to - from);
    return [...a.map((channel, i) => Math.round(channel + (b[i] - channel) * t)), 255];
}

// At 3 degrees per display pixel, 6-degree longitude cells occupy two pixels.
// The cell centered at -180 is split across both edges, without shifting the map.
export function dustPixels(product) {
    const pixels = new Uint8ClampedArray(120 * 60 * 4);
    for (let y = 0; y < 60; y++) {
        for (let x = 0; x < 120; x++) {
            const { index } = gridCell(-180 + (x + .5) * 3, 90 - (y + .5) * 3);
            pixels.set(dustColor(product.fields.CDOD610[index]), (y * 120 + x) * 4);
        }
    }
    return pixels;
}

export async function fetchDustProduct(entry, baseUrl, { signal, fetcher = fetch } = {}) {
    const response = await fetcher(new URL(entry.file, baseUrl), { signal });
    if (!response.ok) throw new Error(`NASA harita dosyası: HTTP ${response.status}`);
    const raw = await response.arrayBuffer();
    if (globalThis.crypto?.subtle) {
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)),
            v => v.toString(16).padStart(2, '0')).join('');
        if (hash !== entry.sha256) throw new Error('NASA harita dosyasının bütünlüğü doğrulanamadı.');
    }
    return validateDustProduct(JSON.parse(new TextDecoder().decode(raw)), entry);
}
