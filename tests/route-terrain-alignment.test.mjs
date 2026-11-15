import test from 'node:test';
import assert from 'node:assert/strict';
const event = () => { const callbacks = new Set(); return { addEventListener(f) { callbacks.add(f); return () => callbacks.delete(f); }, raise(...args) { callbacks.forEach(f => f(...args)); } }; };
class Cartesian3 {
    static fromDegrees(lon, lat, height = 0, ellipsoid, result = {}) { return Object.assign(result, { lon, lat, height }); }
    static fromDegreesArray(a, e) { const out=[]; for(let i=0;i<a.length;i+=2)out.push(this.fromDegrees(a[i],a[i+1],0,e)); return out; }
    static clone(a,b={}) { return Object.assign(b,a); }
    static magnitude() { return 3397190; }
}
globalThis.Cesium = { Cartesian3, Color: { fromCssColorString: c => c }, ArcType: { NONE: 0 },
    Cartographic: { fromDegrees: (lon,lat) => ({lon,lat}) }, PolylineOutlineMaterialProperty: class { constructor(p) {Object.assign(this,p);} },
    EllipsoidalOccluder: class { isPointVisible() {return true;} }, SceneTransforms: { worldToWindowCoordinates() {} },
};
const {createRouteLayer} = await import('../src/routes/route-layer.js');

test('one outlined geometry preserves horizontal anchors at 1x/5x and uses rendered height once, with no tile downloads', async () => {
    const entities=[], preRender=event(), moveEnd=event(), tileLoadProgressEvent=event();
    let renderedHeight=-500, queries=0;
    const viewer={ entities:{add(e){entities.push(e);return e;}},camera:{positionWC:{},moveEnd},
      scene:{verticalExaggeration:5,verticalExaggerationRelativeHeight:0,preRender,requestRender(){},
        globe:{tilesLoaded:true,tileLoadProgressEvent,getHeight(){queries++;return renderedHeight;}}}};
    const points=[[-5,-2,1],[-5.001,-2,2]], original=JSON.stringify(points);
    const layer=createRouteLayer(viewer,{maximumRadius:3396190,scaleToGeodeticSurface:p=>p},new Map([['opportunity',{
      points,render:{terrainVersion:'a',anchors:[0,1],points:[[-5,-2,-100],[-5.001,-2,-100]]},segments:[{from:0,to:1,difficulty:'easy'}]}]]));
    layer.setTerrain({},'a'); preRender.raise(); await new Promise(r=>setTimeout(r,20));
    assert.equal(entities.length,2); // one outline plus reusable hover
    assert.equal(layer.positionsOf('opportunity')[0].height,-497);
    assert.equal(queries,2);
    preRender.raise(); await new Promise(r=>setTimeout(r,10)); assert.equal(queries,2); // idle does no sampling
    viewer.scene.verticalExaggeration=1; renderedHeight=-100; preRender.raise(); await new Promise(r=>setTimeout(r,20));
    assert.equal(layer.positionsOf('opportunity')[0].height,-97);
    assert.equal(JSON.stringify(points),original);
    assert.ok(entities.every(e=>e.polyline.clampToGround===false));
    layer.setTerrain({},'wrong-version'); preRender.raise(); assert.equal(layer.isShown('opportunity'),false);
});
