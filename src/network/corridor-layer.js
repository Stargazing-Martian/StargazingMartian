const Cesium = globalThis.Cesium;

// Mars-wide expedition corridors (built by scripts/build_corridors.py):
// least-cost paths between destinations over MOLA slope/roughness and TES
// temperature. Drawn like a road network on the whole-planet view; hidden
// while a mission is selected so the rover traverse stays in focus.

const SHOW_BELOW_DISTANCE = 10_500_000; // metres from Mars' centre: appears with the pins
const color = css => Cesium.Color.fromCssColorString(css);
const FILL = { easy: '#34a853', medium: '#fb8c00', hard: '#ea4335' };
// Google Maps-like: thin grey roads at rest; the difficulty colour appears
// (wider) only on hover and on the selected corridor.
const GREY = color('#d9d4cc');
const STYLE = {
    idle:     { casingWidth: 3.5, fillWidth: 1.6, casingAlpha: .45, fill: () => GREY.withAlpha(.8) },
    selected: { casingWidth: 9, fillWidth: 6, casingAlpha: .95, fill: c => color(FILL[c.difficulty]) },
};

export async function loadCorridors() {
    const response = await fetch('data/network/corridors.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Corridors: HTTP ${response.status}`);
    return response.json();
}

export function createCorridorLayer(viewer, ellipsoid, data) {
    const nodesById = new Map(data.nodes.map(node => [node.id, node]));
    const corridors = new Map();
    const add = (positions, z) => viewer.entities.add({
        show: false, polyline: { positions, clampToGround: true, zIndex: z },
    });

    for (const info of data.corridors) {
        const positions = Cesium.Cartesian3.fromDegreesArray(info.points.flat(), ellipsoid);
        const corridor = {
            ...info,
            fromNode: nodesById.get(info.from),
            toNode: nodesById.get(info.to),
            positions,
            casing: add(positions, 0),
            fill: add(positions, 1),
            hoverCasing: add(positions, 10),
            hoverFill: add(positions, 11),
            style: undefined,
        };
        corridor.hoverCasing.polyline.width = 8;
        corridor.hoverCasing.polyline.material = color('#1b1410').withAlpha(.9);
        corridor.hoverFill.polyline.width = 5;
        corridor.hoverFill.polyline.material = color(FILL[info.difficulty]);
        corridors.set(info.id, corridor);
    }

    let enabled = false; // stage 2 onwards
    let missionFocus = false; // a mission is selected: hide the network
    let selectedId;
    let hoveredId;

    function restyle() {
        for (const [id, c] of corridors) {
            const style = id === selectedId ? STYLE.selected : STYLE.idle;
            if (c.style === style) continue;
            c.style = style;
            c.casing.polyline.width = style.casingWidth;
            c.casing.polyline.material = color('#1b1410').withAlpha(style.casingAlpha);
            c.fill.polyline.width = style.fillWidth;
            c.fill.polyline.material = style.fill(c);
            const lift = id === selectedId ? 4 : 0;
            c.casing.polyline.zIndex = lift;
            c.fill.polyline.zIndex = lift + 1;
        }
    }
    restyle();

    // Destination markers (mission sites already have pins).
    const layer = document.createElement('div');
    layer.className = 'network-nodes';
    document.getElementById('app').appendChild(layer);
    const markers = data.nodes.filter(node => node.kind === 'destination').map(node => {
        const element = document.createElement('div');
        element.className = 'network-node';
        element.innerHTML = `<span class="network-node__dot"></span><span class="network-node__label"></span>`;
        element.querySelector('.network-node__label').textContent = node.name;
        element.hidden = true;
        layer.appendChild(element);
        return { element, position: Cesium.Cartesian3.fromDegrees(node.lon, node.lat, 0, ellipsoid) };
    });

    let visible = false;
    viewer.scene.preRender.addEventListener(() => {
        const distance = Cesium.Cartesian3.magnitude(viewer.camera.positionWC);
        visible = enabled && !missionFocus && distance < SHOW_BELOW_DISTANCE;
        for (const [id, c] of corridors) {
            c.casing.show = c.fill.show = visible;
            c.hoverCasing.show = c.hoverFill.show = visible && id === hoveredId && id !== selectedId;
        }
    });

    const toWindow = Cesium.SceneTransforms.worldToWindowCoordinates
        ?? Cesium.SceneTransforms.wgs84ToWindowCoordinates;
    const screen = new Cesium.Cartesian2();
    viewer.scene.postRender.addEventListener(() => {
        const occluder = new Cesium.EllipsoidalOccluder(ellipsoid, viewer.camera.positionWC);
        for (const marker of markers) {
            const onScreen = visible && occluder.isPointVisible(marker.position)
                && toWindow(viewer.scene, marker.position, screen);
            marker.element.hidden = !onScreen;
            if (onScreen) {
                marker.element.style.transform =
                    `translate3d(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px, 0)`;
            }
        }
    });

    function distanceToSegment(p, a, b) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const lengthSq = dx * dx + dy * dy;
        const t = lengthSq ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq)) : 0;
        return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    }

    return {
        enable() { enabled = true; },
        setMissionFocus(value) { missionFocus = value; },
        get(id) { return corridors.get(id); },
        // Screen-space hit test, as for rover routes. Returns a corridor id.
        hitTest(windowPosition, tolerancePx) {
            if (!visible) return undefined;
            const occluder = new Cesium.EllipsoidalOccluder(ellipsoid, viewer.camera.positionWC);
            let best, bestDistance = tolerancePx;
            for (const [id, c] of corridors) {
                let previous;
                for (const position of c.positions) {
                    const point = occluder.isPointVisible(position)
                        && toWindow(viewer.scene, position, new Cesium.Cartesian2());
                    if (point && previous) {
                        const distance = distanceToSegment(windowPosition, previous, point);
                        if (distance < bestDistance) { best = id; bestDistance = distance; }
                    }
                    previous = point || undefined;
                }
            }
            return best;
        },
        select(id) { selectedId = id; hoveredId = undefined; restyle(); },
        hover(id) { hoveredId = id; },
    };
}
