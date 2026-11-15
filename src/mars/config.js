const options = globalThis.STARGAZING_CONFIG ?? {};
export const MARS_RADIUS = 3396190;
export const terrainTimeoutMs = options.terrainTimeoutMs ?? 120000;
export function resolveTerrainUrl({ hostname, protocol, pageUrl }, configuredUrl) {
    if (configuredUrl !== null && configuredUrl !== undefined) return configuredUrl;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
        return `${protocol}//${hostname}:5000/tiles/mars`;
    }
    const codespace = hostname.match(/^(.*)-\d+\.app\.github\.dev$/);
    if (codespace) return `${protocol}//${codespace[1]}-5000.app.github.dev/tiles/mars`;
    // Respect the Pages repository prefix, e.g. /StargazingMartian/.
    return new URL('data/terrain/mars/', pageUrl).href.replace(/\/$/, '');
}
export function initialTerrainUrl() {
    return resolveTerrainUrl({ hostname: location.hostname, protocol: location.protocol,
        pageUrl: new URL('../../', import.meta.url).href }, options.terrainUrl);
}
export function normalizeTerrainUrl(value) {
    if (!value.trim()) throw new Error('Enter the CTOD terrain URL.');
    const url = new URL(value, location.href);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('Enter an HTTP or HTTPS terrain URL.');
    }
    if (location.protocol === 'https:' && url.protocol !== 'https:') {
        throw new Error('On an HTTPS page the CTOD URL must also be HTTPS.');
    }
    url.pathname = url.pathname.replace(/\/layer\.json\/?$/, '').replace(/\/$/, '');
    if (!url.pathname || url.pathname === '/') url.pathname = '/tiles/mars';
    url.hash = '';
    url.search = '';
    return url.href.replace(/\/$/, '');
}
