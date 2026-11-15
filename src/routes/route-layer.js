import { createSurfacePath } from './surface-path.js?v=1';
const Cesium = globalThis.Cesium;

// Routes are tiny on a whole-planet view, so they only appear once the camera
// is this close to the surface — or when their pin is selected.
const SHOW_BELOW_HEIGHT = 600_000; // metres above the surface

// Google Maps-style lines: a wider dark "casing" under a coloured fill.
// Each route is drawn as its science-phase segments.
//   idle:   route not selected (light alternative-route look)
//   active: route selected, or the selected segment; coloured by difficulty
//   muted:  the other segments while one segment is selected (still clickable)
//   hover:  blue highlight drawn on top of the segment under the cursor
// Hard segments are slightly wider so colour is not the only cue.
const color = css => Cesium.Color.fromCssColorString(css);
const STYLE = {
    idle:   { casing: color('rgba(8, 24, 54, 0.75)'), casingWidth: 7,  fill: color('#8ab4f8'), fillWidth: 4, z: 0 },
    active: {
        easy:   { casing: color('rgba(10, 30, 16, 0.9)'), casingWidth: 10, fill: color('#34a853'), fillWidth: 6, z: 4 },
        medium: { casing: color('rgba(48, 24, 0, 0.9)'),  casingWidth: 10, fill: color('#fb8c00'), fillWidth: 6, z: 4 },
        hard:   { casing: color('rgba(54, 8, 8, 0.9)'),   casingWidth: 12, fill: color('#ea4335'), fillWidth: 8, z: 4 },
    },
    muted:  { casing: color('rgba(20, 22, 26, 0.6)'), casingWidth: 8,  fill: color('#9aa0a6'), fillWidth: 5, z: 2 },
    hover:  { casing: color('rgba(255, 255, 255, 0.95)'), casingWidth: 14, fill: color('#4dabff'), fillWidth: 9, z: 6 },
};

// Real rover traverses, built by scripts/build_routes.py.
// Returns Map<missionId, { points: [[lon, lat, sol]], segments: [...] }>.
export async function loadRoutes(missions) {
    const entries = await Promise.all(missions.filter(m => m.hasRoute).map(async mission => {
        const response = await fetch(`data/routes/${mission.id}.json`, { cache: 'no-cache' });
        if (!response.ok) throw new Error(`Route ${mission.id}: HTTP ${response.status}`);
        return [mission.id, await response.json()];
    }));
    return new Map(entries);
}

export function createRouteLayer(viewer, ellipsoid, routeData) {
    const routes = new Map();
    let terrainProvider;

    function addLine(positions) {
        return viewer.entities.add({ show: false,
            polyline: { positions, clampToGround: false, arcType: Cesium.ArcType.NONE } });
    }
    function setStyle(entity, style) {
        entity.polyline.width = style.casingWidth;
        entity.polyline.material = new Cesium.PolylineOutlineMaterialProperty({
            color: style.fill, outlineColor: style.casing,
            outlineWidth: (style.casingWidth - style.fillWidth) / 2,
        });
    }
    for (const [id, data] of routeData) {
        if (!data.render) { console.error(`Route ${id}: missing prepared terrain geometry`); continue; }
        const positions = Cesium.Cartesian3.fromDegreesArray(
            data.points.flatMap(([lon, lat]) => [lon, lat]), ellipsoid);
        const segments = data.segments.map(info => ({ ...info,
            positions: positions.slice(info.from, info.to + 1),
            line: addLine([]), style: undefined,
        }));
        const hover = addLine([]);
        setStyle(hover, STYLE.hover);
        const path = createSurfacePath(viewer, ellipsoid, data.render.points, drawing => {
            data.render.anchors.forEach((index, i) => Cesium.Cartesian3.fromDegrees(
                data.points[i][0], data.points[i][1], drawing[index].height, ellipsoid, positions[i]));
            for (const segment of segments) segment.line.polyline.positions =
                drawing.slice(data.render.anchors[segment.from], data.render.anchors[segment.to] + 1);
            const hit = segments[hovered?.id === id ? hovered.segment : -1];
            if (hit) hover.polyline.positions = hit.line.polyline.positions;
        });
        routes.set(id, { positions, segments, hover, path, data, shown: false });
    }

    let selectedId;
    let selectedSegment; // index into the selected route's segments
    let hovered; // { id, segment }

    // Styles change only when the selection changes (a material or width
    // change rebuilds the ground geometry); hovering only toggles `show`.
    function restyle() {
        for (const [id, route] of routes) {
            route.segments.forEach((segment, index) => {
                let style = STYLE.idle;
                if (id === selectedId) {
                    style = selectedSegment === undefined || selectedSegment === index
                        ? STYLE.active[segment.difficulty] : STYLE.muted;
                }
                if (segment.style !== style) {
                    setStyle(segment.line, style);
                    segment.style = style;
                }
            });
        }
    }
    restyle();

    viewer.scene.preRender.addEventListener(() => {
        const height = Cesium.Cartesian3.magnitude(viewer.camera.positionWC) - ellipsoid.maximumRadius;
        const close = height < SHOW_BELOW_HEIGHT;
        for (const [id, route] of routes) {
            const compatible = terrainProvider && route.data.render.terrainVersion === terrainProvider.stargazingVersion;
            const anchor = ellipsoid.scaleToGeodeticSurface(route.positions[0], new Cesium.Cartesian3());
            const facing = new Cesium.EllipsoidalOccluder(ellipsoid, viewer.camera.positionWC).isPointVisible(anchor);
            route.shown = Boolean(compatible && facing && (close || id === selectedId));
            route.path.update(route.shown);
            route.segments.forEach(segment => { segment.line.show = route.shown; });
            route.hover.show = route.shown && hovered?.id === id;

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
        setTerrain(provider, version) { terrainProvider = provider; provider.stargazingVersion = version; viewer.scene.requestRender(); },
        positionsOf(id, segment) {
            const route = routes.get(id);
            return segment === undefined ? route?.positions : route?.segments[segment]?.positions;
        },
        segmentsOf(id) { return routes.get(id)?.segments; },
        isShown(id) { return Boolean(routes.get(id)?.shown); },
        // Screen-space hit test: Cesium's pick() does not reliably return
        // ground-clamped lines, so measure the pointer's pixel distance to
        // each visible route instead. Returns { id, segment } or undefined.
        hitTest(windowPosition, tolerancePx) {
            const occluder = new Cesium.EllipsoidalOccluder(ellipsoid, viewer.camera.positionWC);
            let best, bestDistance = tolerancePx;
            for (const [id, route] of routes) {
                if (!route.shown) continue;
                route.segments.forEach((segment, index) => {
                    let previous;
                    for (const position of segment.positions) {
                        const point = occluder.isPointVisible(position)
                            && toWindow(viewer.scene, position, new Cesium.Cartesian2());
                        if (point && previous) {
                            const distance = distanceToSegment(windowPosition, previous, point);
                            // The selected route wins ties with routes under it.
                            const bias = id === selectedId ? 0.5 : 0;
                            if (distance - bias < bestDistance) {
                                best = { id, segment: index };
                                bestDistance = distance - bias;
                            }
                        }
                        previous = point || undefined;
                    }
                });
            }
            return best;
        },
        select(id) {
            selectedId = id;
            selectedSegment = undefined;
            hovered = undefined;
            restyle();
            viewer.scene.requestRender();
        },
        selectSegment(index) {
            selectedSegment = index;
            restyle();
            viewer.scene.requestRender();
        },
        hover(hit) {
            if (hovered?.id === hit?.id && hovered?.segment === hit?.segment) return;
            hovered = hit;
            if (hit) {
                const route = routes.get(hit.id);
                route.hover.polyline.positions = route.segments[hit.segment].line.polyline.positions;
            }
            viewer.scene.requestRender();
        },
    };
}
