// Track failures until the same tile actually succeeds. A temporary failure
// should neither disappear silently nor leave a permanent warning after recovery.
export function monitorTerrain(provider, { onFailure, onRecovered }) {
    const failed = new Set();
    const requestTile = provider.requestTileGeometry.bind(provider);
    const removeError = provider.errorEvent.addEventListener(error => {
        if (error.timesRetried < 2) error.retry = true;
    });
    provider.requestTileGeometry = function (x, y, level, request) {
        const result = requestTile(x, y, level, request);
        if (!result) return result; // Cesium may throttle and return undefined.
        const key = `${level}/${x}/${y}`;
        return Promise.resolve(result).then(data => {
            if (failed.delete(key) && failed.size === 0) onRecovered();
            return data;
        }, error => {
            failed.add(key);
            onFailure({ key, count: failed.size, error });
            throw error;
        });
    };
    return () => {
        removeError();
        provider.requestTileGeometry = requestTile;
    };
}
