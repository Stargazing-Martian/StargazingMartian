import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const dustCode = await readFile(new URL('../src/science/dust-data.js', import.meta.url), 'utf8');
const dustUrl = `data:text/javascript;base64,${Buffer.from(dustCode).toString('base64')}`;
const code = (await readFile(new URL('../src/science/temperature-data.js', import.meta.url), 'utf8'))
    .replace('./dust-data.js?v=1', dustUrl);
const { validateTemperatureProduct, kelvinToCelsius, sampleTemperature,
    temperaturePixels, temperatureColor, fetchTemperatureProduct } =
    await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const base = new URL('../data/science/tes-temperature/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
const examples = await Promise.all(manifest.products.map(async entry => {
    const raw = await readFile(new URL(entry.file, base));
    return { entry, raw, product: JSON.parse(raw) };
}));

test('temperature maps match source identity, exact UTC periods, counts and file hashes', () => {
    assert.equal(examples.length, 3);
    assert.equal(manifest.quantity.unit, 'Kelvin');
    assert.equal(manifest.quantity.sourceField, 'TSURF');
    for (const { entry, raw, product } of examples) {
        assert.equal(createHash('sha256').update(raw).digest('hex'), entry.sha256);
        assert.equal(validateTemperatureProduct(product, entry), product);
        assert.ok(product.selectedRetrievals > 0);
    }
});

test('Celsius conversion does not change the underlying Kelvin data', () => {
    assert.equal(kelvinToCelsius(273.15), 0);
    assert.ok(Math.abs(kelvinToCelsius(200) + 73.15) < 1e-10);
    assert.deepEqual(temperatureColor(null), [170, 177, 185, 255]);
});

test('a different temperature period cannot be relabeled as the selected date', () => {
    assert.throws(() => validateTemperatureProduct(examples[0].product, examples[1].entry), /uyuşmuyor/);
});

test('missing cells stay missing and sample spread is not measurement uncertainty', () => {
    for (const { product } of examples) {
        const i = product.fields.MEAN_K.indexOf(null);
        assert.ok(i >= 0);
        assert.equal(sampleTemperature(product, -180 + (i % 60) * 6, 88.5 - Math.floor(i / 60) * 3).missing, true);
        assert.equal(product.measurementUncertaintyK, null);
        for (let j = 0; j < 3600; j++) if (product.fields.COUNT[j] === 1) assert.equal(product.fields.STD_K[j], null);
    }
});

test('temperature texture aligns with the numeric picker across the dateline', () => {
    const p = examples[0].product, pixels = temperaturePixels(p);
    for (let y = 0; y < 60; y++) for (let x = 0; x < 120; x++) {
        const s = sampleTemperature(p, -180 + (x + .5) * 3, 90 - (y + .5) * 3);
        const i = (y * 120 + x) * 4;
        assert.deepEqual(Array.from(pixels.slice(i, i + 4)), temperatureColor(s.values.MEAN_K));
    }
});

test('out-of-window cell data, night observations and false error bars are rejected', () => {
    const { product, entry } = examples[0];
    const i = product.fields.COUNT.findIndex(v => v !== null);
    for (const alter of [p => { p.fields.FIRST_UTC[i] = 0; },
        p => { p.fields.LTST_MIN[i] = 2; }, p => { p.measurementUncertaintyK = 5; }]) {
        const p = structuredClone(product); alter(p);
        assert.throws(() => validateTemperatureProduct(p, entry));
    }
});

test('failed or swapped HTTP products cannot silently provide a different temperature map', async () => {
    await assert.rejects(fetchTemperatureProduct(examples[0].entry, base, {
        fetcher: async () => new Response('', { status: 503 }),
    }), /503/);
    await assert.rejects(fetchTemperatureProduct(examples[0].entry, base, {
        fetcher: async () => new Response(examples[1].raw),
    }), /bütünlüğü|uyuşmuyor/);
});
