import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
const code = await readFile(new URL('../src/science/mission-environment-data.js', import.meta.url), 'utf8');
const { validateMissionEnvironment, queryObservations, matchingPeriods, fetchMissionEnvironment } =
    await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const base = new URL('../data/science/mer-weather/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', base)));
const examples = await Promise.all(manifest.products.map(async entry => {
    const raw = await readFile(new URL(entry.file, base));
    return { entry, raw, product: JSON.parse(raw) };
}));
const spirit = examples.find(e => e.entry.id === 'spirit');
const opportunity = examples.find(e => e.entry.id === 'opportunity');

test('full packaged NASA records match identity, count, hash and source Sol convention', () => {
    assert.deepEqual(examples.map(e => e.product.validRecords), [4391, 8697]);
    for (const { entry, raw, product } of examples) {
        assert.equal(createHash('sha256').update(raw).digest('hex'), entry.sha256);
        assert.equal(validateMissionEnvironment(product, entry), product);
        assert.ok(product.observations.every(r => r[1] === Math.ceil(r[2])));
    }
});
test('same Sol on different missions has different UTC; no cross-mission substitution', () => {
    const a = queryObservations(spirit.product, 'spirit', 'sol', '2');
    const b = queryObservations(opportunity.product, 'opportunity', 'sol', '2');
    assert.ok(a.length && b.length);
    assert.notEqual(a[0][6].slice(0, 10), b[0][6].slice(0, 10));
    assert.deepEqual(queryObservations(spirit.product, 'opportunity', 'sol', '20'), []);
    for (const value of ['99999', '0', '1.5', '', '-1']) {
        assert.deepEqual(queryObservations(spirit.product, 'spirit', 'sol', value), []);
    }
});
test('UTC query uses only selected clock-derived day; no closest day fallback', () => {
    const matches = queryObservations(spirit.product, 'spirit', 'utc', '2004-01-05');
    assert.ok(matches.length);
    assert.ok(matches.every(r => r[6].startsWith('2004-01-05')));
    assert.deepEqual(queryObservations(spirit.product, 'spirit', 'utc', '2004-01-26'), []);
    for (const date of ['2004-02-30', '2030-01-01', '2004-01-26T00:00:00Z']) {
        assert.deepEqual(queryObservations(spirit.product, 'spirit', 'utc', date), []);
    }
});
test('clock applicability retains 408 later Opportunity records only under mission Sol', () => {
    const rows = opportunity.product.observations.filter(r => r[6] === null);
    assert.equal(rows.length, 408);
    assert.ok(queryObservations(opportunity.product, 'opportunity', 'sol', rows.at(-1)[1]).length);
    assert.deepEqual(queryObservations(opportunity.product, 'opportunity', 'utc', '2018-06-05'), []);
    assert.equal(spirit.product.utcUnavailableRecords, 0);
});
test('period matching is inclusive, rejects unknown time and never selects nearest interval', () => {
    const entries = [{ id: 'a', observationStart: '2004-01-22T00:00:00Z', observationEnd: '2004-01-29T00:00:00Z' }];
    for (const time of [entries[0].observationStart, entries[0].observationEnd]) assert.deepEqual(matchingPeriods(entries, time), entries);
    for (const time of [null, undefined, '', '2004-01-30T00:00:00Z', '2018-06-05T00:00:00Z']) {
        assert.deepEqual(matchingPeriods(entries, time), []);
    }
});
test('rejects wrong mission, missing sentinel, clock metadata tampering and bad Sol', () => {
    for (const mutate of [p => p.id = 'opportunity', p => p.observations[0][1] = 100,
        p => p.observations[0][4] = -1, p => p.timeConversion.applicableStop = '2030-01-01T00:00:00Z']) {
        const p = structuredClone(spirit.product); mutate(p);
        assert.throws(() => validateMissionEnvironment(p, spirit.entry));
    }
});
test('runtime verifies file integrity and fails on download errors', async () => {
    globalThis.crypto ??= webcrypto;
    const fetcher = async () => new Response(spirit.raw);
    assert.equal((await fetchMissionEnvironment(spirit.entry, base, { fetcher })).id, 'spirit');
    await assert.rejects(fetchMissionEnvironment({ ...spirit.entry, sha256: '0'.repeat(64) }, base, { fetcher }), /integrity/);
    await assert.rejects(fetchMissionEnvironment(spirit.entry, base,
        { fetcher: async () => new Response('', { status: 503 }) }), /503/);
});
