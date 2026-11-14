import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const code = await readFile(new URL('../src/mars/terrain-monitor.js', import.meta.url), 'utf8');
const { monitorTerrain } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

function fixture() {
    let listener;
    let failing = true;
    const events = [];
    const provider = {
        errorEvent: { addEventListener(fn) { listener = fn; return () => { listener = undefined; }; } },
        requestTileGeometry(x, y, level, request) {
            if (request?.throttle) return undefined;
            return failing ? Promise.reject(new Error('503')) : Promise.resolve({ tile: 'mesh' });
        }
    };
    const stop = monitorTerrain(provider, {
        onFailure: event => events.push(['failed', event.key, event.count]),
        onRecovered: () => events.push(['recovered'])
    });
    return { provider, events, stop, recover() { failing = false; }, error(event) { listener(event); } };
}

test('warning clears only after all failed tiles have succeeded', async () => {
    const f = fixture();
    await assert.rejects(f.provider.requestTileGeometry(1, 2, 3), /503/);
    await assert.rejects(f.provider.requestTileGeometry(2, 2, 3), /503/);
    f.recover();
    await f.provider.requestTileGeometry(1, 2, 3);
    assert.equal(f.events.length, 2);
    await f.provider.requestTileGeometry(2, 2, 3);
    assert.deepEqual(f.events, [['failed', '3/1/2', 1], ['failed', '3/2/2', 2], ['recovered']]);
    f.stop();
});

test('Cesium throttling is not reported as a failure and retries are bounded', () => {
    const f = fixture();
    assert.equal(f.provider.requestTileGeometry(1, 2, 3, { throttle: true }), undefined);
    assert.equal(f.events.length, 0);
    const retry = { timesRetried: 0, retry: false };
    f.error(retry);
    assert.equal(retry.retry, true);
    const exhausted = { timesRetried: 2, retry: false };
    f.error(exhausted);
    assert.equal(exhausted.retry, false);
    f.stop();
});
