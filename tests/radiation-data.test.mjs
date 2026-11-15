import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {shieldingProxy} from '../src/science/radiation-data.js';
const model=JSON.parse(await readFile(new URL('../data/science/radiation/model.json',import.meta.url)));
test('fixed model is a ratio, rejects extrapolation and retains the published reference',()=>{
 assert.equal(shieldingProxy(0,model).ratio,1);
 assert.ok(shieldingProxy(-4000,model).ratio<1);
 assert.ok(shieldingProxy(20000,model).ratio>1);
 assert.equal(shieldingProxy(100000,model),undefined);
 assert.equal(shieldingProxy(NaN,model),undefined);
});
test('every published corridor includes both planning policies and finite independent comparison metrics',async()=>{
 const d=JSON.parse(await readFile(new URL('../data/network/corridors.json',import.meta.url)));
 let changed=0;
 for(const c of d.corridors){
  assert.ok(c.radiationAware); assert.ok(Number.isFinite(c.radiationAware.radiationProxyKm));
  assert.ok(c.render.points.every(p=>p.length===3&&p.every(Number.isFinite)));
  assert.ok(c.radiationAware.render.points.every(p=>p.length===3&&p.every(Number.isFinite)));
  assert.equal(c.baselineProxyKm,c.radiationProxyKm);
  if(JSON.stringify(c.points)!==JSON.stringify(c.radiationAware.points))changed++;
 }
 assert.ok(changed>0,'radiation must change actual pathfinding, not only a map colour');
});
