import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('../src/mars/config.js', import.meta.url), 'utf8');
const { resolveTerrainUrl, normalizeTerrainUrl } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const pages = { hostname: 'stargazing-martian.github.io', protocol: 'https:',
    pageUrl: 'https://stargazing-martian.github.io/StargazingMartian/' };

test('Pages defaults to a same-origin static terrain path under the repository prefix', () => {
    assert.equal(resolveTerrainUrl(pages, null), 'https://stargazing-martian.github.io/StargazingMartian/data/terrain/mars');
    assert.equal(resolveTerrainUrl({ ...pages, pageUrl: 'https://example.org/' }), 'https://example.org/data/terrain/mars');
});
test('an explicit HTTPS cloud source overrides automatic hosting defaults', () => {
    assert.equal(resolveTerrainUrl(pages, 'https://example.azurewebsites.net/tiles/mars'), 'https://example.azurewebsites.net/tiles/mars');
});
test('local development and Codespaces keep automatic CTOD connections', () => {
    assert.equal(resolveTerrainUrl({ ...pages, hostname: 'localhost', protocol: 'http:' }), 'http://localhost:5000/tiles/mars');
    assert.equal(resolveTerrainUrl({ ...pages, hostname: '[::1]', protocol: 'http:' }), 'http://[::1]:5000/tiles/mars');
    assert.equal(resolveTerrainUrl({ ...pages, hostname: 'example-5500.app.github.dev' }), 'https://example-5000.app.github.dev/tiles/mars');
});
test('published sources cannot silently use HTTP or embedded credentials', () => {
    globalThis.location = { protocol: 'https:', href: pages.pageUrl };
    assert.throws(() => normalizeTerrainUrl('http://localhost:5000/tiles/mars'), /HTTPS/);
    assert.throws(() => normalizeTerrainUrl('https://user:password@example.org/tiles/mars'), /HTTP or HTTPS/);
    assert.equal(normalizeTerrainUrl('./data/terrain/mars/layer.json'), pages.pageUrl + 'data/terrain/mars');
});
