const options = globalThis.STARGAZING_CONFIG ?? {};
export const MARS_RADIUS = 3396190;
export const terrainTimeoutMs = options.terrainTimeoutMs ?? 15000;
export function initialTerrainUrl() {
    let saved;
    try { saved = localStorage.getItem('stargazing.terrainUrl'); } catch { /* Storage can be disabled. */ }
    return options.terrainUrl ?? saved ?? '';
}
export function normalizeTerrainUrl(value) {
    if (!value.trim()) throw new Error('CTOD terrain adresini girin.');
    const url = new URL(value, location.href);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('HTTP veya HTTPS terrain adresi girin.');
    }
    if (location.protocol === 'https:' && url.protocol !== 'https:') {
        throw new Error('HTTPS sayfası için CTOD adresi de HTTPS olmalı.');
    }
    url.pathname = url.pathname.replace(/\/layer\.json\/?$/, '').replace(/\/$/, '');
    if (!url.pathname || url.pathname === '/') url.pathname = '/tiles/mars';
    url.hash = '';
    url.search = '';
    return url.href.replace(/\/$/, '');
}
export function saveTerrainUrl(value) {
    try { localStorage.setItem('stargazing.terrainUrl', value); } catch { /* Session still works. */ }
}
