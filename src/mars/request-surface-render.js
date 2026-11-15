// Material canvas textures upload after the first render. Give their upload
// another frame before returning to idle (otherwise the globe stays white).
const pending = new WeakMap();
export function requestSurfaceRender(scene) {
    if (pending.has(scene)) return;
    let frames = 3;
    const remove = scene.postRender.addEventListener(() => {
        if (--frames <= 0) { remove(); pending.delete(scene); return; }
        queueMicrotask(() => scene.requestRender());
    });
    pending.set(scene, remove);
    scene.requestRender();
}
