export function createMarsCamera(container, viewer) {
    const Cesium = globalThis.Cesium;
    // Keep one viewport-sized canvas: clipping/moving it also clips the sky.
    container.style.pointerEvents = 'none';
    let cinematicMode = true;
    let angle = 0;
    let previousTime;
    let introAmount = 1;
    let transitionStart;
    let interactiveReady;

    const CINEMATIC_DISTANCE = 10000000;
    const INTERACTIVE_DISTANCE = 13000000;
    const MAX_ZOOM_OUT = 17000000;
    const TILT = Cesium.Math.toRadians(25.19);
    const SPEED = 0.00009;
    const DURATION = 1400;
    const standardFov = viewer.camera.frustum.fov;

    // Aim the camera beside Mars rather than moving/clipping the canvas.
    // Avoid frustum x/y offsets: Cesium uses multiple near/far ranges for terrain.
    const removeFraming = viewer.scene.preUpdate.addEventListener(() => {
        if (transitionStart !== undefined) {
            const progress = Math.min((performance.now() - transitionStart) / DURATION, 1);
            introAmount = 1 - progress * progress * (3 - 2 * progress);
        }
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (!width || !height) return;
        const frustum = viewer.camera.frustum;
        const aspect = width / height;
        const tanHalfY = height / (2 * Math.min(width, height)) * Math.tan(Math.PI / 6);
        const openingFov = 2 * Math.atan(tanHalfY * Math.max(1, aspect));
        frustum.fov = standardFov + (openingFov - standardFov) * introAmount;
        if (cinematicMode) {
            const time = performance.now();
            const elapsed = previousTime === undefined ? 0 : Math.min(time - previousTime, 100);
            previousTime = time;
            angle += SPEED * elapsed / (1000 / 60);
            viewer.camera.lookAt(
                Cesium.Cartesian3.ZERO,
                new Cesium.HeadingPitchRange(angle, -TILT, CINEMATIC_DISTANCE),
            );
            viewer.camera.lookLeft(Math.atan(0.55 * tanHalfY * aspect));
            viewer.camera.lookUp(Math.atan(0.65 * tanHalfY));
        }
        if (introAmount === 0) removeFraming();
    });

    function enterInteractiveMode() {
        if (!cinematicMode) return interactiveReady;
        cinematicMode = false;
        transitionStart = performance.now();
        container.style.pointerEvents = 'auto';
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        viewer.resize();
        interactiveReady = new Promise(resolve => {
            const finish = () => {
                introAmount = 0;
                viewer.camera.frustum.fov = standardFov;
                removeFraming();
                viewer.scene.screenSpaceCameraController.maximumZoomDistance = MAX_ZOOM_OUT;
                resolve();
            };
            viewer.camera.flyToBoundingSphere(
                new Cesium.BoundingSphere(Cesium.Cartesian3.ZERO, 3390000),
                {
                    duration: DURATION / 1000,
                    offset: new Cesium.HeadingPitchRange(angle, -TILT, INTERACTIVE_DISTANCE),
                    complete: finish,
                    cancel: finish,
                },
            );
        });
        return interactiveReady;
    }

    document.addEventListener('wheel', event => {
        // Scrolling a settings panel must not unexpectedly change the camera.
        if (cinematicMode && !event.target.closest('#terrain-panel')) {
            event.preventDefault();
            enterInteractiveMode();
        }
    }, { passive: false });
    return { enterInteractiveMode };
}
