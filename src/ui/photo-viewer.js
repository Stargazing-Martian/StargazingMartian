// Photo viewer. Panoramas open full screen in Pannellum (drag to look
// around 360°, scroll to zoom). Flat photos open as a "peek": a floating
// card over the dimmed map, closed by Esc, × or a click outside it.
// Pannellum is loaded from the CDN the first time a panorama is opened.

const PANNELLUM = 'https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/';

let pannellumReady;
function loadPannellum() {
    pannellumReady ??= new Promise((resolve, reject) => {
        const style = document.createElement('link');
        style.rel = 'stylesheet';
        style.href = `${PANNELLUM}pannellum.css`;
        document.head.appendChild(style);
        const script = document.createElement('script');
        script.src = `${PANNELLUM}pannellum.js`;
        script.onload = () => resolve(window.pannellum);
        script.onerror = () => { pannellumReady = undefined; reject(new Error('Pannellum failed to load')); };
        document.head.appendChild(script);
    });
    return pannellumReady;
}

const escape = text => String(text).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createPhotoViewer() {
    const overlay = document.createElement('div');
    overlay.className = 'photo-viewer';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
        <div class="photo-viewer__card">
            <div class="photo-viewer__stage"></div>
            <div class="photo-viewer__bar">
                <div class="photo-viewer__text">
                    <p class="photo-viewer__title"></p>
                    <p class="photo-viewer__credit"></p>
                </div>
                <button class="photo-viewer__close" aria-label="Close photo">×</button>
            </div>
            <p class="photo-viewer__hint">Drag to look around · Scroll to zoom</p>
        </div>`;
    document.body.appendChild(overlay);
    const stage = overlay.querySelector('.photo-viewer__stage');
    let viewer;
    let opened = 0; // ignores a slow Pannellum load after the viewer closed

    function close() {
        opened++;
        viewer?.destroy();
        viewer = undefined;
        stage.replaceChildren();
        overlay.hidden = true;
    }

    async function open(photo) {
        const current = ++opened;
        overlay.hidden = false;
        overlay.dataset.type = photo.type;
        overlay.querySelector('.photo-viewer__title').textContent = photo.title;
        overlay.querySelector('.photo-viewer__credit').innerHTML =
            `Image: ${escape(photo.credit)} · <a href="${escape(photo.source)}" target="_blank" rel="noopener">images.nasa.gov</a>`;
        stage.replaceChildren();
        overlay.querySelector('.photo-viewer__close').focus();

        if (photo.type !== 'pano') {
            const image = document.createElement('img');
            image.src = photo.src;
            image.alt = photo.title;
            stage.appendChild(image);
            return;
        }
        const pannellum = await loadPannellum();
        if (current !== opened) return;
        const container = document.createElement('div');
        container.className = 'photo-viewer__pano';
        stage.appendChild(container);
        viewer = pannellum.viewer(container, {
            type: 'equirectangular',
            panorama: photo.src,
            // NASA's 360° mosaics are cylindrical strips, not full spheres.
            haov: photo.haov,
            vaov: photo.vaov,
            vOffset: 0,
            // Keep the view centre on the strip. (avoidShowingBackground
            // leaves these narrow strips black, so limit pitch instead.)
            minPitch: -photo.vaov / 2,
            maxPitch: photo.vaov / 2,
            autoLoad: true,
            autoRotate: -2,
            autoRotateInactivityDelay: 4000,
            showControls: false, // its zoom buttons sit under our title bar
            hfov: 90,
            minHfov: 30,
        });
    }

    overlay.querySelector('.photo-viewer__close').addEventListener('click', close);
    // Peek: a click on the dimmed backdrop (outside the card) closes it.
    overlay.addEventListener('click', event => {
        if (event.target === overlay) close();
    });
    // Capture phase on window: Esc closes the viewer only, and does not also
    // reach the map's Esc handler (which would clear the selection).
    window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !overlay.hidden) {
            event.stopPropagation();
            close();
        }
    }, true);

    return { open, close };
}
