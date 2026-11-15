import { surfacePoint } from '../mars/surface-point.js?v=1';
const Cesium = globalThis.Cesium;

// START / END dots at both ends of every visible route. HTML overlay (like
// the pins) so the dots and their mono labels stay sharp at any zoom.
export function createRouteEndpoints(viewer, ellipsoid, routes, missionIds) {
    const layer = document.createElement('div');
    layer.className = 'route-endpoints';
    document.getElementById('app').appendChild(layer);

    const items = [];
    for (const id of missionIds) {
        const positions = routes.positionsOf(id);
        if (!positions) continue;
        for (const [kind, position] of [['start', positions[0]], ['end', positions.at(-1)]]) {
            const element = document.createElement('div');
            element.className = `route-endpoint route-endpoint--${kind}`;
            element.innerHTML = `<span class="route-endpoint__dot"></span>`
                + `<span class="route-endpoint__label">${kind.toUpperCase()}</span>`;
            element.hidden = true;
            layer.appendChild(element);
            items.push({ id, element, position: Cesium.Cartesian3.clone(position),
                cartographic: Cesium.Cartographic.fromCartesian(position, ellipsoid) });
        }
    }

    const toWindow = Cesium.SceneTransforms.worldToWindowCoordinates
        ?? Cesium.SceneTransforms.wgs84ToWindowCoordinates;
    const screen = new Cesium.Cartesian2();

    viewer.scene.postRender.addEventListener(() => {
        const occluder = new Cesium.EllipsoidalOccluder(ellipsoid, viewer.camera.positionWC);
        for (const item of items) {
            if (routes.isShown(item.id)) surfacePoint(viewer, ellipsoid, item.cartographic, item.position);
            const onScreen = routes.isShown(item.id)
                && occluder.isPointVisible(item.position)
                && toWindow(viewer.scene, item.position, screen);
            item.element.hidden = !onScreen;
            if (onScreen) {
                item.element.style.transform =
                    `translate3d(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px, 0)`;
            }
        }
    });
}
