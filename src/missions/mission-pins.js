import { surfacePoint, facingTest } from '../mars/surface-point.js?v=2';
const Cesium = globalThis.Cesium;

// Stage 2 is split in two: right after the showcase the globe is centred
// without pins (2a); pins fade in once the user zooms in far enough (2b).
// Distances are from the centre of Mars, in metres (radius ≈ 3 396 km).
// Two thresholds (hysteresis) stop pins flickering at the boundary.
// Stage 2a starts at 13 000 km, so a small zoom-in is enough to reveal pins.
const SHOW_BELOW = 10_500_000;
const HIDE_ABOVE = 11_500_000;

// Marker: a small ringed dot centred on the site (rovers get an extra ring,
// failed missions a coral dot), with a label beside it.
const PIN_MARKUP = `<span class="mission-pin__icon" aria-hidden="true"><span class="mission-pin__core"></span></span>`;

// Pins are HTML/SVG on top of the Cesium canvas, so the browser draws them
// at full screen resolution (Cesium renders the scene at 1x on Retina).
export function createMissionPins(viewer, ellipsoid, missions, { onSelect } = {}) {
    const layer = document.createElement('div');
    layer.className = 'pin-layer';
    document.getElementById('app').appendChild(layer);

    // Pins sit above the canvas; pass wheel events through so zooming
    // still works while the cursor is over a pin.
    layer.addEventListener('wheel', event => {
        event.preventDefault();
        viewer.canvas.dispatchEvent(new WheelEvent('wheel', event));
    }, { passive: false });
    layer.addEventListener('click', event => {
        const pin = event.target.closest('.mission-pin');
        const mission = pin && missions.find(m => m.id === pin.dataset.id);
        if (mission) onSelect?.(mission);
    });

    const items = missions.map((mission, index) => {
        const element = document.createElement('div');
        element.className = `mission-pin mission-pin--${mission.type}`;
        element.dataset.id = mission.id;
        element.style.setProperty('--i', index); // staggered entrance
        const label = document.createElement('span');
        label.className = 'mission-pin__label';
        label.textContent = mission.name;
        element.append(label);
        element.insertAdjacentHTML('beforeend', PIN_MARKUP);
        layer.appendChild(element);
        return {
            element,
            position: Cesium.Cartesian3.fromDegrees(mission.lon, mission.lat, 0, ellipsoid),
            cartographic: Cesium.Cartographic.fromDegrees(mission.lon, mission.lat),
        };
    });

    const toWindow = Cesium.SceneTransforms.worldToWindowCoordinates
        ?? Cesium.SceneTransforms.wgs84ToWindowCoordinates;
    const screen = new Cesium.Cartesian2();
    let enabled = false; // true once stage 2 starts
    let revealed = false; // true while zoomed in far enough (stage 2b)

    viewer.scene.postRender.addEventListener(() => {
        if (!enabled) return;
        const distance = Cesium.Cartesian3.magnitude(viewer.camera.positionWC);
        if (!revealed && distance < SHOW_BELOW) revealed = true;
        else if (revealed && distance > HIDE_ABOVE) revealed = false;
        layer.classList.toggle('is-visible', revealed);
        if (!revealed) return;

        const occluder = { isPointVisible: facingTest(viewer, ellipsoid) };
        for (const item of items) {
            surfacePoint(viewer, ellipsoid, item.cartographic, item.position);
            const onScreen = occluder.isPointVisible(item.position)
                && toWindow(viewer.scene, item.position, screen);
            item.element.hidden = !onScreen;
            if (onScreen) {
                item.element.style.transform =
                    `translate3d(${screen.x.toFixed(1)}px, ${screen.y.toFixed(1)}px, 0)`;
            }
        }
    });

    return {
        enable() { enabled = true; },
        setSelected(id) {
            for (const item of items) {
                item.element.classList.toggle('is-selected', item.element.dataset.id === id);
            }
        },
    };
}
