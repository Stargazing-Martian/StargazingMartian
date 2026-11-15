export function shieldingProxy(height, model) {
    if (!Number.isFinite(height)) return undefined;
    const column = model.referenceColumnGcm2 * Math.exp(-height / model.scaleHeightM);
    const xs = model.pathColumnGcm2, ys = model.tableEffectiveDoseCsvDay;
    function interpolate(x) {
        if (x < xs[0] || x > xs.at(-1)) return undefined;
        const j = Math.max(1, xs.findIndex(v => v >= x));
        return ys[j - 1] + (ys[j] - ys[j - 1]) * (x - xs[j - 1]) / (xs[j] - xs[j - 1]);
    }
    const value = interpolate(column), reference = interpolate(model.referenceColumnGcm2);
    return value === undefined ? undefined : { column, ratio: value / reference };
}

export const radiationColor = ratio => {
    const t = Math.max(0, Math.min(1, (ratio - .85) / .45));
    return [Math.round(40 + 210 * t), Math.round(190 - 125 * t), Math.round(185 - 135 * t)];
};
