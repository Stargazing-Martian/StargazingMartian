import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const code = await readFile(new URL('../src/science/dust-data.js', import.meta.url), 'utf8');
const { validateDustProduct, gridCell, sampleDust, dustPixels, dustColor, MISSING_COLOR, fetchDustProduct } =
    await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const base = new URL('../data/science/tes-dust/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
const examples = await Promise.all(manifest.products.map(async entry => {
    const raw = await readFile(new URL(entry.file, base));
    return { entry, raw, product: JSON.parse(raw) };
}));

test('all shipped NASA products match their hash, observation period, grid and missing masks', () => {
    assert.equal(examples.length, 11);
    for (const { entry, raw, product } of examples) {
        assert.equal(createHash('sha256').update(raw).digest('hex'), entry.sha256);
        assert.equal(validateDustProduct(product, entry), product);
        assert.ok(Date.parse(entry.observationStart) < Date.parse(entry.observationEnd));
    }
});

test('a different date or mission-year product is rejected, with no nearest-date fallback', () => {
    assert.throws(() => validateDustProduct(examples[0].product, examples[1].entry), /uyuşmuyor/);
    const changed = structuredClone(examples[0].product);
    changed.marsYear++;
    assert.throws(() => validateDustProduct(changed, examples[0].entry), /uyuşmuyor/);
});

test('dateline cells wrap at their half-width and polar edge cells stay within the grid', () => {
    assert.equal(gridCell(-180, 0).index, gridCell(180, 0).index);
    assert.equal(gridCell(179.99, 0).longitude, -180);
    assert.equal(gridCell(-177.01, 0).longitude, -180);
    assert.equal(gridCell(-177, 0).longitude, -174);
    assert.equal(gridCell(176.99, 0).longitude, 174);
    assert.equal(gridCell(177, 0).longitude, -180);
    assert.equal(gridCell(0, 90).latitude, 88.5);
    assert.equal(gridCell(0, -90).latitude, -88.5);
    assert.throws(() => gridCell(NaN, 0));
    assert.throws(() => gridCell(0, 91));
});

test('missing data is distinct from a valid zero measurement', () => {
    const { product, entry } = examples[0];
    assert.equal(sampleDust(product, -180, 88.5).missing, true);
    const index = product.fields.CDOD610.indexOf(0);
    assert.ok(index >= 0);
    const sample = sampleDust(product, -180 + (index % 60) * 6, 88.5 - Math.floor(index / 60) * 3);
    assert.equal(sample.missing, false);
    assert.equal(sample.values.CDOD610, 0);
    const corrupted = structuredClone(product);
    corrupted.fields.CDOD610UNC[0] = 0;
    assert.throws(() => validateDustProduct(corrupted, entry), /maskesi/);
});

test('display texture and numeric picker use the same cells, including both seam halves', () => {
    const { product } = examples[1];
    const pixels = dustPixels(product);
    assert.equal(pixels.length, 120 * 60 * 4);
    for (let y = 0; y < 60; y++) {
        for (let x = 0; x < 120; x++) {
            const sample = sampleDust(product, -180 + (x + .5) * 3, 90 - (y + .5) * 3);
            const start = (y * 120 + x) * 4;
            assert.deepEqual(Array.from(pixels.slice(start, start + 4)), dustColor(sample.values.CDOD610));
        }
        const left = (y * 120) * 4, right = (y * 120 + 119) * 4;
        assert.deepEqual(pixels.slice(left, left + 4), pixels.slice(right, right + 4));
    }
    assert.notDeepEqual(dustColor(0), MISSING_COLOR);
});

test('display saturation preserves the original numeric measurement', () => {
    assert.deepEqual(dustColor(5), dustColor(3));
    const { product } = examples[1];
    const sample = sampleDust(product, -60, 0);
    const before = sample.values.CDOD610;
    dustPixels(product);
    assert.equal(sampleDust(product, -60, 0).values.CDOD610, before);
});

test('a missing HTTP product fails instead of inventing an observation', async () => {
    await assert.rejects(fetchDustProduct(examples[0].entry, base, {
        fetcher: async () => new Response('', { status: 404 }),
    }), /HTTP 404/);
});

test('the HTTP data path validates the selected product identity', async () => {
    await assert.rejects(fetchDustProduct(examples[1].entry, base, {
        fetcher: async () => new Response(examples[0].raw),
    }), /bütünlüğü|uyuşmuyor/);
});
