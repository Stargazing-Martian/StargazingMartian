// Mission Sol is mission-specific. Never substitute a neighbouring day or rover.
export const MER_FIELDS = ['productId', 'sol', 'localTimeSol', 'solarLongitude', 'opacity', 'relativeError', 'utc'];
export function validateMissionEnvironment(product, entry) {
    if (!['spirit', 'opportunity'].includes(entry.id) || product?.schemaVersion !== 1 ||
        product.id !== entry.id || product.wavelengthNm !== 440 || product.lidvid !== entry.lidvid ||
        product.sourceSha256 !== entry.sourceSha256 || product.validRecords !== entry.validRecords ||
        JSON.stringify(product.fields) !== JSON.stringify(MER_FIELDS) ||
        !Array.isArray(product.observations) || product.observations.length !== entry.validRecords ||
        JSON.stringify(product.timeConversion) !== JSON.stringify(entry.timeConversion)) {
        throw new Error('NASA mission identity or clock source does not match.');
    }
    const prefix = entry.id === 'spirit' ? '2P' : '1P';
    const identifiers = new Set();
    let withoutUtc = 0;
    for (const row of product.observations) {
        const [id, sol, local, ls, opacity, error, utc] = row;
        if (row.length !== 7 || !new RegExp(`^${prefix}\\d{9}[A-Z0-9#]{16}$`).test(id) ||
            identifiers.has(id) || ![sol, local, ls, opacity, error].every(Number.isFinite) ||
            local <= 0 || sol !== Math.ceil(local) || opacity < 0 || error < 0 ||
            (utc !== null && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(utc) ||
                !Number.isFinite(Date.parse(utc)) || Date.parse(utc) < Date.parse(entry.timeConversion.applicableStart) ||
                Date.parse(utc) > Date.parse(entry.timeConversion.applicableStop)))) {
            throw new Error('Invalid NASA mission observation record.');
        }
        identifiers.add(id);
        if (utc === null) ++withoutUtc;
    }
    if (withoutUtc !== product.utcUnavailableRecords || withoutUtc !== entry.utcUnavailableRecords ||
        Math.min(...product.observations.map(r => r[1])) !== entry.firstSol ||
        Math.max(...product.observations.map(r => r[1])) !== entry.lastSol) {
        throw new Error('NASA mission coverage does not match.');
    }
    return product;
}

export async function fetchMissionEnvironment(entry, baseUrl, { signal, fetcher = fetch } = {}) {
    const response = await fetcher(new URL(entry.file, baseUrl), { signal });
    if (!response.ok) throw new Error(`NASA mission file: HTTP ${response.status}`);
    const raw = await response.arrayBuffer();
    if (globalThis.crypto?.subtle) {
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)),
            byte => byte.toString(16).padStart(2, '0')).join('');
        if (hash !== entry.sha256) throw new Error('NASA mission file integrity could not be verified.');
    }
    return validateMissionEnvironment(JSON.parse(new TextDecoder().decode(raw)), entry);
}

export function queryObservations(product, missionId, kind, value) {
    if (!product || product.id !== missionId) return [];
    if (kind === 'sol') {
        if (!/^\d+$/.test(String(value)) || Number(value) < 1) return [];
        return product.observations.filter(row => row[1] === Number(value));
    }
    if (kind === 'utc' && /^\d{4}-\d\d-\d\d$/.test(value) &&
        Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value) {
        return product.observations.filter(row => row[6]?.slice(0, 10) === value);
    }
    return [];
}

export function matchingPeriods(products, utc) {
    const time = Date.parse(utc);
    if (!Number.isFinite(time)) return [];
    return products.filter(entry => Date.parse(entry.observationStart) <= time && time <= Date.parse(entry.observationEnd));
}
