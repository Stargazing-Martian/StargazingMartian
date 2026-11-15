import { fetchMissionEnvironment, queryObservations } from '../science/mission-environment-data.js?v=1';

// Independent read-only science panel. Route geometry and CTOD are not modified.
export function createMissionEnvironment(missions, scienceMaps, onVisit) {
    const byId = suffix => document.getElementById(`mission-weather-${suffix}`);
    const mission = byId('mission'), kind = byId('kind'), sol = byId('sol'), date = byId('date');
    const records = byId('records'), status = byId('status'), reading = byId('reading');
    const source = byId('source'), binding = byId('bind');
    const catalogUrl = new URL('../../data/science/mer-weather/manifest.json', import.meta.url);
    let catalogPromise, product, rows = [], generation = 0, pending;
    const cache = new Map();
    mission.replaceChildren(new Option('Select a mission', ''), ...missions.map(m => new Option(m.name, m.id)));

    function context() {
        if (!binding.checked || !mission.value) return scienceMaps.setContext(null);
        const selected = missions.find(m => m.id === mission.value);
        const row = rows[Number(records.value)];
        scienceMaps.setContext({ mission: selected?.name, utc: row?.[6] ?? null,
            longitude: selected?.lon, latitude: selected?.lat });
    }
    function showRecord() {
        const row = rows[Number(records.value)];
        reading.textContent = '';
        source.hidden = !row;
        byId('details').hidden = !row;
        byId('provenance').textContent = '';
        if (row) {
            const [id, day, local, ls, opacity, error, utc] = row;
            reading.textContent = `${missions.find(m => m.id === product.id).name} · Sol ${day}\n` +
                `Pancam 440 nm optical depth: ${opacity.toFixed(3)} (dimensionless)\n` +
                `Source relative-error field: ${error.toFixed(3)}\n` +
                (utc ? `Approximate UTC (spacecraft clock): ${utc.replace('T', ' ')}\n` :
                    'UTC unavailable: outside the clock kernel applicability range. Source Sol retained.\n') +
                'Exact observation coordinates are absent from this source; no air temperature or wind is provided.';
            byId('provenance').textContent = `Ls: ${ls.toFixed(1)}°\nSource local time: ${local} sol\nImage ID: ${id}`;
            source.href = product.sourceUrl;
        }
        context();
    }
    function query() {
        sol.hidden = kind.value !== 'sol';
        date.hidden = kind.value !== 'utc';
        byId('sol-label').hidden = sol.hidden;
        byId('date-label').hidden = date.hidden;
        rows = queryObservations(product, mission.value, kind.value, kind.value === 'sol' ? sol.value : date.value);
        records.replaceChildren(...rows.map((row, i) => new Option(
            `Sol ${row[1]} · ${row[6] ? row[6].replace('T', ' ') : 'UTC outside coverage'} · τ ${row[4].toFixed(3)}`, String(i))));
        records.disabled = !rows.length;
        if (product) {
            status.textContent = rows.length ? `${rows.length} source observation(s) found. Sol ${product.firstSol}–${product.lastSol} archive.` :
                'No valid observation for this mission and time. No substitution from another date or mission.';
            status.dataset.state = rows.length ? 'ready' : 'missing';
        }
        showRecord();
    }
    async function load() {
        const current = ++generation;
        pending?.abort();
        const controller = new AbortController();
        pending = controller;
        product = undefined; rows = []; records.replaceChildren(); records.disabled = true;
        reading.textContent = ''; source.hidden = true;
        byId('details').hidden = true; byId('provenance').textContent = '';
        byId('visit').disabled = !mission.value;
        context();
        if (!mission.value) {
            status.textContent = 'Select a mission and Sol or UTC day.';
            status.dataset.state = 'missing'; return;
        }
        if (!['spirit', 'opportunity'].includes(mission.value)) {
            status.textContent = 'Verified environmental data has not yet been added for this mission.';
            status.dataset.state = 'missing'; return;
        }
        status.textContent = 'Loading NASA Pancam observations…';
        status.dataset.state = 'loading';
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            catalogPromise ??= fetch(catalogUrl, { signal: AbortSignal.timeout(15000) }).then(async r => {
                if (!r.ok) throw new Error(`NASA mission catalogue: HTTP ${r.status}`);
                const c = await r.json();
                if (c.schemaVersion !== 1 || c.wavelengthNm !== 440 || !Array.isArray(c.products) ||
                    c.products.length !== 2 || new Set(c.products.map(p => p.id)).size !== 2 ||
                    !c.products.every(p => ['spirit', 'opportunity'].includes(p.id))) throw new Error('Invalid mission catalogue.');
                return c;
            }).catch(e => { catalogPromise = undefined; throw e; });
            const catalog = await catalogPromise;
            if (current !== generation) return;
            const id = mission.value;
            const loaded = cache.get(id) ?? await fetchMissionEnvironment(catalog.products.find(e => e.id === id), catalogUrl,
                { signal: controller.signal });
            if (current !== generation || controller.signal.aborted) return;
            cache.set(id, loaded); product = loaded; query();
        } catch (error) {
            if (current !== generation) return;
            status.textContent = `Mission data could not be loaded: ${error.name === 'AbortError' ? 'timeout' : error.message}. Use Reload observations to try again.`;
            status.dataset.state = 'error'; context();
        } finally { clearTimeout(timeout); }
    }
    mission.addEventListener('change', load);
    kind.addEventListener('change', query);
    sol.addEventListener('input', query);
    date.addEventListener('change', query);
    records.addEventListener('change', showRecord);
    binding.addEventListener('change', context);
    byId('retry').addEventListener('click', load);
    byId('visit').addEventListener('click', () => onVisit(missions.find(m => m.id === mission.value)));
    load();
    return { selectMission(selected) {
        if (selected && mission.value !== selected.id) { mission.value = selected.id; load(); }
    } };
}
