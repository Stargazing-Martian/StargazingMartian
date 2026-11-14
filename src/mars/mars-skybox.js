import { marsInertialToFixed } from './mars-orientation.js';

const Cesium = globalThis.Cesium;
const faces = {
    positiveX: 'px', negativeX: 'mx',
    positiveY: 'py', negativeY: 'my',
    positiveZ: 'pz', negativeZ: 'mz',
};

export async function createMarsSkybox(viewer) {
    // Resolve relative to this module, including deployments under a subdirectory.
    // Decode before adding the primitive: a missing image must not stop Cesium's render loop.
    const entries = await Promise.all(Object.entries(faces).map(async ([face, suffix]) => {
        const image = new Image();
        image.src = new URL(`../../assets/skybox/tycho2t3_80_${suffix}.jpg`, import.meta.url).href;
        await image.decode();
        if (image.naturalWidth !== image.naturalHeight) {
            throw new Error(`Skybox face is not square: ${face}`);
        }
        return [face, image];
    }));
    if (viewer.isDestroyed()) return;
    const size = entries[0][1].naturalWidth;
    if (entries.some(([, image]) => image.naturalWidth !== size)) {
        throw new Error('Skybox faces must have equal dimensions.');
    }

    const transform = new Cesium.Matrix3();
    function updateOrientation(_scene, time) {
        // Cesium JulianDate stores TAI. TT = TAI + 32.184 seconds.
        const days = time.dayNumber - 2451545 + (time.secondsOfDay + 32.184) / 86400;
        Cesium.Matrix3.fromRowMajorArray(marsInertialToFixed(days), transform);
    }
    updateOrientation(viewer.scene, viewer.clock.currentTime);

    // SkyBox's default shader uses Earth's TEME-to-fixed transform even for
    // a Mars ellipsoid. The public panorama API accepts our Mars rotation.
    const panorama = viewer.scene.primitives.add(new Cesium.CubeMapPanorama({
        sources: Object.fromEntries(entries),
        transform,
        show: true,
        credit: new Cesium.Credit(
            '<a href="https://svs.gsfc.nasa.gov/3572/">Stars: NASA/Goddard SVS · Tycho/Hipparcos</a>',
        ),
    }));
    viewer.scene.preUpdate.addEventListener(updateOrientation);
    viewer.scene.requestRender();
    return panorama;
}
