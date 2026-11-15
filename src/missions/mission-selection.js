const Cesium = globalThis.Cesium;

const FLY_SECONDS = 2;
const RESET_SECONDS = 0.8;
const VIEW_PITCH = Cesium.Math.toRadians(-60); // slightly oblique, Google Earth-like
const ROUTELESS_RADIUS = 15_000; // metres framed around a pin without a route
const MIN_FRAME_RADIUS = 2_500; // short segments are framed at least this wide
const PICK_TOLERANCE_PX = 12; // how close (in pixels) a click must be to a route
const DESELECT_ABOVE_HEIGHT = 400_000; // metres; zooming out past this leaves stage 3

// Stage 3 selection: pin click selects and flies there; another pin switches
// directly; Esc or a click on empty map clears and levels the camera again.
// With a route selected, its segments highlight on hover; a click selects a
// segment (the rest turn grey but stay clickable). Esc or an empty click then
// steps back: first to the whole route, then out of the selection.
export function createMissionSelection(viewer, ellipsoid, { pins, routes, missions }) {
    let selected;
    let selectedSegment;
    let flying = false; // true while the camera flies to a selection
    let flightCount = 0;

    function flyTo(mission, segment) {
        const positions = routes.positionsOf(mission.id, segment);
        const sphere = positions
            ? Cesium.BoundingSphere.fromPoints(positions)
            : new Cesium.BoundingSphere(
                Cesium.Cartesian3.fromDegrees(mission.lon, mission.lat, 0, ellipsoid),
                ROUTELESS_RADIUS);
        sphere.radius = Math.max(sphere.radius, MIN_FRAME_RADIUS);
        // Starting a new flight cancels the previous one; only the latest
        // flight may clear the flag.
        const flight = ++flightCount;
        flying = true;
        const done = () => { if (flight === flightCount) flying = false; };
        stopTiltReset();
        const range = sphere.radius * 4.5;
        const cameraHeight = Cesium.Cartesian3.magnitude(viewer.camera.positionWC) - ellipsoid.maximumRadius;
        viewer.camera.flyToBoundingSphere(sphere, {
            duration: FLY_SECONDS,
            offset: new Cesium.HeadingPitchRange(0, VIEW_PITCH, range),
            // No "hop": by default Cesium climbs above the start before
            // descending, which looks like a jump when coming from orbit.
            maximumHeight: Math.max(cameraHeight, range),
            easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
            complete: done,
            cancel: done,
        });
    }

    // The selection view is tilted; leaving it must give back the normal
    // straight-down view, or rotating the globe afterwards feels broken.
    // Instead of a camera flight (which moves the camera along a path and
    // stutters), orbit around the point at screen centre, frame by frame,
    // until the camera looks straight down. Distance and heading stay.
    let tiltReset; // { remove, finish } while the animation runs
    function stopTiltReset() { tiltReset?.finish(); }

    function resetTilt() {
        stopTiltReset();
        const camera = viewer.camera;
        const canvas = viewer.scene.canvas;
        const centre = camera.pickEllipsoid(
            new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2), ellipsoid);
        if (!centre) return;
        const down = Cesium.Cartesian3.negate(ellipsoid.geodeticSurfaceNormal(centre), new Cesium.Cartesian3());
        const tilt = Math.acos(Cesium.Math.clamp(Cesium.Cartesian3.dot(camera.directionWC, down), -1, 1));
        if (tilt < Cesium.Math.toRadians(0.5)) return;

        // Pivot frame at the centre point; camera keeps its world position.
        camera.lookAtTransform(Cesium.Transforms.eastNorthUpToFixedFrame(centre, ellipsoid));
        const start = performance.now();
        let applied = 0;
        const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

        const finish = () => {
            remove();
            removeInput();
            camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
            tiltReset = undefined;
        };
        const remove = viewer.scene.preUpdate.addEventListener(() => {
            const t = Math.min((performance.now() - start) / (RESET_SECONDS * 1000), 1);
            const target = tilt * ease(t);
            // rotateDown swings the camera over the pivot towards the zenith.
            camera.rotateDown(target - applied);
            applied = target;
            if (t === 1) finish();
        });
        // Dragging hands the camera back to the user at once. Wheel zoom is
        // allowed during the animation: zooming out is what can trigger it.
        const onInput = () => finish();
        viewer.canvas.addEventListener('pointerdown', onInput);
        const removeInput = () => viewer.canvas.removeEventListener('pointerdown', onInput);
        tiltReset = { finish };
    }

    function select(mission) {
        const wasSelected = Boolean(selected);
        selected = mission;
        selectedSegment = undefined;
        pins.setSelected(mission?.id);
        routes.select(mission?.id);
        if (mission) flyTo(mission);
        else if (wasSelected) resetTilt();
    }

    function selectSegment(index) {
        selectedSegment = index;
        routes.selectSegment(index);
        flyTo(selected, index); // index undefined: back to the whole route
    }

    // One step back: segment -> whole route -> nothing.
    function stepBack() {
        if (selectedSegment !== undefined) selectSegment(undefined);
        else if (selected) select(undefined);
    }

    // Zooming far out of a selection returns to stage 2. Only checked once the
    // fly-in has finished, since the flight itself starts far away.
    viewer.scene.preRender.addEventListener(() => {
        if (!selected || flying) return;
        const height = Cesium.Cartesian3.magnitude(viewer.camera.positionWC) - ellipsoid.maximumRadius;
        if (height > DESELECT_ABOVE_HEIGHT) select(undefined);
    });

    // Left click on the globe (drags are ignored by Cesium's LEFT_CLICK).
    // A route counts as its pin; anything else clears the selection.
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.canvas);
    handler.setInputAction(({ position }) => {
        const hit = routes.hitTest(position, PICK_TOLERANCE_PX);
        if (hit && hit.id === selected?.id) selectSegment(hit.segment);
        else if (hit) select(missions.find(m => m.id === hit.id));
        else stepBack();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Hover: segments of the selected route highlight; any route under the
    // cursor shows a pointer. Hit-tested at most once per frame.
    let pointer;
    handler.setInputAction(({ endPosition }) => {
        if (!pointer) requestAnimationFrame(updateHover);
        pointer = Cesium.Cartesian2.clone(endPosition);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
    function updateHover() {
        const hit = routes.hitTest(pointer, PICK_TOLERANCE_PX);
        pointer = undefined;
        routes.hover(hit && hit.id === selected?.id ? hit : undefined);
        viewer.canvas.style.cursor = hit ? 'pointer' : '';
    }

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') stepBack();
    });

    return { select };
}
