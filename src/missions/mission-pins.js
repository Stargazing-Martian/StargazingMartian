const Cesium = globalThis.Cesium;

// Stage 2 is split in two: right after the showcase the globe is centred
// without pins (2a); pins fade in once the user zooms in far enough (2b).
// Distances are from the centre of Mars, in metres (radius ≈ 3 396 km).
// Two thresholds (hysteresis) stop pins flickering at the boundary.
// Stage 2a starts at 13 000 km, so a small zoom-in is enough to reveal pins.
const SHOW_BELOW = 10_500_000;
const HIDE_ABOVE = 11_500_000;

const PIN_SVG = `
<svg class="mission-pin__icon" viewBox="0 0 28 36" aria-hidden="true">
  <path d="M14 34.5C14 34.5 3.5 22.6 3.5 13.8a10.5 10.5 0 0 1 21 0c0 8.8-10.5 20.7-10.5 20.7z"/>
  <circle cx="14" cy="13.8" r="4.4"/>
</svg>`;

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

    const items = missions.map(mission => {
        const element = document.createElement('div');
        element.className = 'mission-pin';
        element.dataset.id = mission.id;
        const label = document.createElement('span');
        label.className = 'mission-pin__label';
        label.textContent = mission.name;
        element.append(label);
        element.insertAdjacentHTML('beforeend', PIN_SVG);
        layer.appendChild(element);
        return {
            element,
            position: Cesium.Cartesian3.fromDegrees(mission.lon, mission.lat, 0, ellipsoid),
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

        const occluder = new Cesium.EllipsoidalOccluder(ellipsoid, viewer.camera.positionWC);
        for (const item of items) {
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
