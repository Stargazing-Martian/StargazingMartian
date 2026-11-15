const Cesium = globalThis.Cesium;

// Routes are tiny on a whole-planet view, so they only appear once the camera
// is this close to the surface — or when their pin is selected.
const SHOW_BELOW_HEIGHT = 600_000; // metres above the surface

// Google Maps-style lines: a wider dark "casing" under a coloured fill.
// Selected = the active route, idle = the light alternative-route look.
const color = css => Cesium.Color.fromCssColorString(css);
const STYLE = {
    idle:     { casing: color('#1a5fd6'), casingWidth: 8,  fill: color('#a9c4f5'), fillWidth: 5 },
    selected: { casing: color('#17117a'), casingWidth: 12, fill: color('#3d33f0'), fillWidth: 8 },
};

// Real rover traverses, built by scripts/build_routes.py.
// Returns Map<missionId, [[lon, lat, sol], ...]>.
export async function loadRoutes(missions) {
    const entries = await Promise.all(missions.filter(m => m.hasRoute).map(async mission => {
        const response = await fetch(`data/routes/${mission.id}.json`);
        if (!response.ok) throw new Error(`Route ${mission.id}: HTTP ${response.status}`);
        return [mission.id, (await response.json()).points];
    }));
    return new Map(entries);
}

export function createRouteLayer(viewer, ellipsoid, routeData) {
    const routes = new Map();

    function addLine(positions, zIndex) {
        return viewer.entities.add({
            show: false,
            polyline: { positions, clampToGround: true, zIndex },
        });
    }

    for (const [id, points] of routeData) {
        const positions = Cesium.Cartesian3.fromDegreesArray(
            points.flatMap(([lon, lat]) => [lon, lat]), ellipsoid);
        routes.set(id, {
            positions,
            casing: addLine(positions, 0),
            fill: addLine(positions, 1),
        });
    }

    let selectedId;

    function applyStyle(id, style) {
        const route = routes.get(id);
        if (!route) return;
        route.casing.polyline.width = style.casingWidth;
        route.casing.polyline.material = style.casing;
        route.fill.polyline.width = style.fillWidth;
        route.fill.polyline.material = style.fill;
        // The selected route is drawn above the others.
        const lift = style === STYLE.selected ? 2 : 0;
        route.casing.polyline.zIndex = lift;
        route.fill.polyline.zIndex = lift + 1;
    }
    for (const id of routes.keys()) applyStyle(id, STYLE.idle);

    viewer.scene.preRender.addEventListener(() => {
        const height = Cesium.Cartesian3.magnitude(viewer.camera.positionWC) - ellipsoid.maximumRadius;
        const close = height < SHOW_BELOW_HEIGHT;
        for (const [id, route] of routes) {
            const show = close || id === selectedId;
            route.casing.show = show;
            route.fill.show = show;
        }
    });

    const toWindow = Cesium.SceneTransforms.worldToWindowCoordinates
        ?? Cesium.SceneTransforms.wgs84ToWindowCoordinates;

    function distanceToSegment(p, a, b) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const lengthSq = dx * dx + dy * dy;
        const t = lengthSq ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq)) : 0;
        return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    }

    return {
        positionsOf(id) { return routes.get(id)?.positions; },
        // Screen-space hit test: Cesium's pick() does not reliably return
        // ground-clamped lines, so measure the click's pixel distance to each
        // visible route instead.
        hitTest(windowPosition, tolerancePx) {
            const occluder = new Cesium.EllipsoidalOccluder(ellipsoid, viewer.camera.positionWC);
            let best, bestDistance = tolerancePx;
            for (const [id, route] of routes) {
                if (!route.fill.show) continue;
                let previous;
                for (const position of route.positions) {
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
        select(id) {
            if (selectedId) applyStyle(selectedId, STYLE.idle);
            selectedId = id;
            if (id) applyStyle(id, STYLE.selected);
        },
    };
}
