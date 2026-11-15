import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Minimal Cesium adapter tests lifecycle/caching; real rendering is checked in-browser.
class Property {
    constructor(value) { this.value = value; }
    getValue() { return this.value; }
}
const graphics = values => new Proxy(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, new Property(v)])), {
    set(object, key, value) { object[key] = value === undefined ? undefined : new Property(value); return true; },
});
let requests = 0;
globalThis.Cesium = {
    Color: { fromCssColorString: css => css },
    ArcType: { NONE: 0, GEODESIC: 1 },
    Cartesian3: {
        fromDegreesArray: values => Array.from({ length: values.length / 2 }, (_, i) =>
            ({ longitude: values[i * 2], latitude: values[i * 2 + 1], height: 0 })),
        fromRadians: (longitude, latitude, height, ellipsoid, result = {}) => Object.assign(result, { longitude, latitude, height }),
        magnitude: point => point.magnitude,
    },
    Cartographic: { fromDegrees: (longitude, latitude) => ({ longitude, latitude }), clone: point => ({ ...point }) },
    SceneTransforms: { worldToWindowCoordinates() {} },
    async sampleTerrainMostDetailed(provider, points) {
        ++requests;
        return points.map(point => ({ ...point, height: provider.height }));
    },
};
const code = await readFile(new URL('../src/routes/route-layer.js', import.meta.url), 'utf8');
const { createRouteLayer } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('negative terrain heights remain visible at 5x, reuse samples across 1x/5x and refresh on provider change', async () => {
    const callbacks = [], entities = [];
    const viewer = {
        entities: { add(entity) { entity.polyline = graphics(entity.polyline); entities.push(entity); return entity; } },
        camera: { positionWC: { magnitude: 3397190 } },
        scene: { verticalExaggeration: 5, verticalExaggerationRelativeHeight: 0,
            preRender: { addEventListener(callback) { callbacks.push(callback); } }, requestRender() {} },
    };
    const render = async () => { callbacks.forEach(callback => callback()); await Promise.resolve(); };
    const layer = createRouteLayer(viewer, { maximumRadius: 3396190 }, new Map([['opportunity', {
        points: [[-5.5, -1.9, 1], [-5.6, -2, 2]],
        segments: [{ from: 0, to: 1, difficulty: 'easy' }],
    }]]));
    const endpointReference = layer.positionsOf('opportunity')[0];
    layer.setTerrain({ height: -100 });
    await render(); await render();
    assert.equal(requests, 1);
    assert.equal(endpointReference.height, -495); // DEM * 5 + visual lift; never a zero-height substitute.
    assert.ok(entities.every(entity => entity.polyline.clampToGround.getValue() === false));
    assert.ok(entities.every(entity => entity.polyline.zIndex === undefined));
    assert.notEqual(entities[0].polyline.positions.getValue()[0].height, entities[1].polyline.positions.getValue()[0].height);

    viewer.scene.verticalExaggeration = 1;
    await render();
    assert.equal(endpointReference.height, -100);
    assert.ok(entities.every(entity => entity.polyline.clampToGround.getValue() === true));
    viewer.scene.verticalExaggeration = 5;
    await render();
    assert.equal(requests, 1);
    assert.equal(endpointReference.height, -495);

    layer.setTerrain({ height: 200 });
    await render(); await render();
    assert.equal(requests, 2);
    assert.equal(endpointReference.height, 1005);
});
