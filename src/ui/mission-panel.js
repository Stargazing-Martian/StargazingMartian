// Floating panel, bottom-left. Follows the selection:
//   place   — mission card (any pin)
//   route   — the route's segments (after "Explore route")
//   segment — one segment's details (segment selected on the map or list)
// Segment rows and map segments highlight each other on hover.

const DIFFICULTY_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const BASIS_NOTE = {
    'rover-tilt': 'Scored from the rover\'s own tilt at each stop. Tilt is a proxy for ground slope, not a surveyed slope.',
    'mission-record': 'This rover logged no tilt. Scored from terrain notes and incidents in the mission record.',
};
const PROFILE_TICKS = 64;
// Panorama badge: a frame with bowed top and bottom edges.
const PANO_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5Q12 8.5 20 5.5V18.5Q12 15.5 4 18.5Z"/></svg>`;

const escape = text => String(text).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const km = value => `${value.toFixed(1)} km`;
const sols = ([from, to]) => `Sol ${from}–${to}`;
const totalKm = segments => segments.reduce((sum, s) => sum + s.lengthKm, 0);

export function createMissionPanel(selection, routes, photos = {}, photoViewer) {
    const panel = document.createElement('section');
    panel.className = 'mission-panel';
    panel.setAttribute('aria-live', 'polite');
    panel.hidden = true;
    document.getElementById('app').appendChild(panel);

    let view = 'place';
    let state = {};
    let renderedKey;

    // A strip of ticks along the route, each coloured by the segment it
    // falls in, so the panel shows where the hard parts are.
    function profile(segments) {
        const total = totalKm(segments);
        let ticks = '';
        for (let i = 0; i < PROFILE_TICKS; i++) {
            const at = (i + 0.5) / PROFILE_TICKS * total;
            let sum = 0;
            const index = segments.findIndex(s => (sum += s.lengthKm) >= at);
            const segment = segments[index === -1 ? segments.length - 1 : index];
            ticks += `<i class="tick tick--${segment.difficulty}" data-segment="${segments.indexOf(segment)}"></i>`;
        }
        const byLevel = level => segments.filter(s => s.difficulty === level).reduce((sum, s) => sum + s.lengthKm, 0);
        const legend = ['easy', 'medium', 'hard']
            .filter(level => byLevel(level) > 0)
            .map(level => `<span><b class="dot dot--${level}"></b>${km(byLevel(level))} ${level}</span>`)
            .join('');
        return `<div class="profile" aria-hidden="true">${ticks}</div><div class="profile-legend">${legend}</div>`;
    }

    function photoStrip(mission) {
        const list = photos[mission.id] ?? [];
        if (!list.length) return '';
        const tiles = list.map((photo, i) => `
            <button class="photo" data-photo="${i}" title="${escape(photo.title)}">
                <img src="${escape(photo.thumb)}" alt="${escape(photo.title)}" loading="lazy">
                ${photo.type === 'pano' ? `<span class="pano-badge">${PANO_ICON}360°</span>` : ''}
            </button>`).join('');
        return `<div class="photos${list.length === 1 ? ' photos--single' : ''}">${tiles}</div>`;
    }

    function placeView(mission, segments) {
        const stats = segments
            ? `<ul class="stats">
                   <li><span class="label">Distance</span>${km(totalKm(segments))}</li>
                   <li><span class="label">Segments</span>${segments.length}</li>
                   <li><span class="label">Sols</span>${segments[0].sols[0]}–${segments.at(-1).sols[1]}</li>
               </ul>
               ${profile(segments)}
               <button class="primary" data-action="explore">Explore route</button>`
            : '';
        return `
            <header>
                <p class="eyebrow">${escape(mission.kind)} · ${mission.year}</p>
                <button class="close" data-action="close" aria-label="Close">×</button>
            </header>
            <h2>${escape(mission.name)}</h2>
            <p class="place">${escape(mission.place)} <span class="status status--${mission.type}">${escape(mission.status)}</span></p>
            ${photoStrip(mission)}
            <p class="summary">${escape(mission.summary)}</p>
            ${stats}`;
    }

    function routeView(mission, segments) {
        const rows = segments.map((s, i) => `
            <li class="segment-row" data-segment="${i}" tabindex="0">
                <b class="bar bar--${s.difficulty}"></b>
                <span class="name">${escape(s.name)}</span>
                <span class="meta">${km(s.lengthKm)} · ${sols(s.sols)}</span>
                <span class="chip chip--${s.difficulty}">${DIFFICULTY_LABEL[s.difficulty]}</span>
            </li>`).join('');
        return `
            <header>
                <button class="back" data-action="overview">‹ Overview</button>
                <button class="close" data-action="close" aria-label="Close">×</button>
            </header>
            <h2>${escape(mission.name)} route</h2>
            <p class="place">${km(totalKm(segments))} · ${segments.length} segments · ${sols([segments[0].sols[0], segments.at(-1).sols[1]])}</p>
            ${profile(segments)}
            <ol class="segment-list">${rows}</ol>`;
    }

    function segmentView(mission, segments, index) {
        const s = segments[index];
        const metrics = s.metrics
            ? `<li><span class="label">Tilt (90%)</span>${s.metrics.tiltP90}°</li>
               <li><span class="label">Max tilt</span>${s.metrics.tiltMax}°</li>
               <li><span class="label">Total climb</span>${s.metrics.climbM} m</li>`
            : '';
        return `
            <header>
                <button class="back" data-action="route">‹ All segments</button>
                <button class="close" data-action="close" aria-label="Close">×</button>
            </header>
            <p class="eyebrow">${escape(mission.name)} · Segment ${index + 1} of ${segments.length}</p>
            <h2>${escape(s.name)}</h2>
            <p class="place"><span class="chip chip--${s.difficulty}">${DIFFICULTY_LABEL[s.difficulty]} walk</span></p>
            <ul class="stats">
                <li><span class="label">Distance</span>${km(s.lengthKm)}</li>
                <li><span class="label">Sols</span>${s.sols[0]}–${s.sols[1]}</li>
                ${metrics}
            </ul>
            <h3>Why ${DIFFICULTY_LABEL[s.difficulty].toLowerCase()}</h3>
            <ul class="reasons">${s.reasons.map(r => `<li>${escape(r)}</li>`).join('')}</ul>
            <p class="note">${BASIS_NOTE[s.basis]}</p>`;
    }

    // A Mars-wide expedition corridor between two destinations.
    function corridorView(c) {
        const days = `~${c.sols} sols`;
        return `
            <header>
                <p class="eyebrow">Expedition corridor</p>
                <button class="close" data-action="close" aria-label="Close">×</button>
            </header>
            <h2>${escape(c.fromNode.name)} → ${escape(c.toNode.name)}</h2>
            <p class="place"><span class="chip chip--${c.difficulty}">${DIFFICULTY_LABEL[c.difficulty]} corridor</span></p>
            <ul class="stats">
                <li><span class="label">Distance</span>${c.lengthKm.toLocaleString('en-US')} km</li>
                <li><span class="label">By rover</span>${days}</li>
                <li><span class="label">Climb</span>${(c.climbM / 1000).toFixed(1)} km</li>
                <li><span class="label">Slope (90%)</span>${c.slopeP90}°</li>
                <li><span class="label">Max slope</span>${c.slopeMax}°</li>
                <li><span class="label">TES sample minimum</span>${c.tempMinC === null ? 'Unavailable' : `${c.tempMinC} °C`}</li>
            </ul>
            <p class="note">${c.policy === 'radiation' ? 'Radiation-aware model' : 'Baseline scenario'} · Integrated relative proxy: ${c.radiationProxyKm ?? 'unavailable'} proxy·km; baseline ${c.baselineProxyKm ?? 'unavailable'} proxy·km over ${c.baselineLengthKm ?? c.lengthKm} km. Lower integrated proxy is preferable in this fixed scenario; it is not a dose or a safety certification.</p>
            <h3>Why ${DIFFICULTY_LABEL[c.difficulty].toLowerCase()}</h3>
            <ul class="reasons">${c.reasons.map(r => `<li>${escape(r)}</li>`).join('')}</ul>
            <h3>Destinations</h3>
            <ul class="reasons">
                <li><b>${escape(c.fromNode.name)}:</b> ${escape(c.fromNode.summary)}</li>
                <li><b>${escape(c.toNode.name)}:</b> ${escape(c.toNode.summary)}</li>
            </ul>
            <p class="note">Least-cost path over NASA MOLA topography (~7.4 km cells) and TES daytime
                surface temperature, for a multi-sol crewed rover expedition at about 20 km per sol.
                At this scale boulders, small craters and cliffs are invisible: a planning corridor,
                not a verified walking route.</p>`;
    }

    function render() {
        const { mission, segment, corridor } = state;
        if (corridor) {
            const key = `corridor|${corridor.id}|${corridor.policy}`;
            if (key !== renderedKey) {
                renderedKey = key;
                panel.dataset.view = 'corridor';
                panel.innerHTML = corridorView(corridor);
                panel.scrollTop = 0;
                panel.hidden = false;
            }
            return;
        }
        if (!mission) {
            panel.hidden = true;
            renderedKey = undefined;
            return;
        }
        const segments = mission.hasRoute ? routes.segmentsOf(mission.id) : undefined;
        if (segment !== undefined) view = 'segment';
        else if (view === 'segment') view = 'route';
        if (!segments) view = 'place';

        const key = `${mission.id}|${view}|${segment}`;
        if (key !== renderedKey) {
            renderedKey = key;
            panel.dataset.view = view;
            panel.innerHTML = view === 'place' ? placeView(mission, segments)
                : view === 'route' ? routeView(mission, segments)
                : segmentView(mission, segments, segment);
            panel.scrollTop = 0;
            panel.hidden = false;
        }
        // Hover only toggles classes, so the list keeps its scroll position.
        for (const element of panel.querySelectorAll('[data-segment]')) {
            const index = Number(element.dataset.segment);
            element.classList.toggle('is-hovered', index === state.hovered);
            element.classList.toggle('is-dimmed', state.hovered !== undefined && index !== state.hovered);
        }
    }

    selection.onChange(next => {
        if (next.mission !== state.mission) view = 'place';
        state = next;
        render();
    });

    panel.addEventListener('click', event => {
        const action = event.target.closest('[data-action]')?.dataset.action;
        const row = event.target.closest('.segment-row');
        const photo = event.target.closest('[data-photo]');
        if (state.corridor) {
            if (action === 'close') selection.selectCorridor(undefined);
            return;
        }
        if (!state.mission) return; // panel is closing
        if (photo) photoViewer?.open(photos[state.mission.id][Number(photo.dataset.photo)]);
        else if (action === 'close') selection.select(undefined);
        else if (action === 'explore') { view = 'route'; render(); }
        else if (action === 'overview') { view = 'place'; render(); }
        else if (action === 'route') selection.selectSegment(undefined);
        else if (row) selection.selectSegment(Number(row.dataset.segment));
    });
    panel.addEventListener('keydown', event => {
        const row = event.target.closest('.segment-row');
        if (row && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            selection.selectSegment(Number(row.dataset.segment));
        }
    });
    panel.addEventListener('mouseover', event => {
        const row = event.target.closest('.segment-row');
        if (row) selection.hoverSegment(Number(row.dataset.segment));
    });
    panel.addEventListener('mouseout', event => {
        const row = event.target.closest('.segment-row');
        if (row && !row.contains(event.relatedTarget)) selection.hoverSegment(undefined);
    });
}
