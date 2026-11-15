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

// NASA's 360° mosaics are cylindrical strips: a full turn sideways, but
// only ~50–100° tall. To look straight up and down, the strip is placed in a
// full 2:1 equirectangular sphere and the rest is filled: sky above fading
// from the strip's top edge colour, ground below from its bottom edge colour.
// Gaps in the mosaic (pure black) show the fill too. The viewer says so.
const spheres = new Map();
function sphereFor(photo) {
    if (!spheres.has(photo.id)) spheres.set(photo.id, buildSphere(photo));
    return spheres.get(photo.id);
}

async function buildSphere(photo) {
    const image = new Image();
    image.src = photo.src;
    await image.decode();
    const width = image.naturalWidth;
    const height = width / 2;
    const stripHeight = Math.round(width * photo.vaov / 360);
    const top = Math.round((height - stripHeight) / 2);

    // Strip pixels, with mosaic gaps (near-black) made transparent.
    const strip = document.createElement('canvas');
    strip.width = width;
    strip.height = stripHeight;
    const stripContext = strip.getContext('2d', { willReadFrequently: true });
    stripContext.drawImage(image, 0, 0, width, stripHeight);
    const pixels = stripContext.getImageData(0, 0, width, stripHeight);
    const data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i] + data[i + 1] + data[i + 2] < 18) data[i + 3] = 0;
    }
    stripContext.putImageData(pixels, 0, 0);

    // Average colour of the visible pixels in a band of rows.
    const bandColour = (from, to) => {
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = Math.max(0, from); y < Math.min(stripHeight, to); y++) {
            for (let x = 0; x < width; x += 7) {
                const i = (y * width + x) * 4;
                if (data[i + 3]) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
            }
        }
        return n ? [r / n, g / n, b / n] : [120, 90, 70];
    };
    const band = Math.max(4, Math.round(stripHeight * 0.06));
    const sky = bandColour(0, band);
    const ground = bandColour(stripHeight - band, stripHeight);
    const rgb = ([r, g, b], k = 1) => `rgb(${r * k | 0} ${g * k | 0} ${b * k | 0})`;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const fill = context.createLinearGradient(0, 0, 0, height);
    fill.addColorStop(0, rgb(sky, 0.8));                 // zenith
    fill.addColorStop(top / height, rgb(sky));            // strip's top edge
    fill.addColorStop((top + stripHeight) / height, rgb(ground));
    fill.addColorStop(1, rgb(ground, 0.55));             // nadir
    context.fillStyle = fill;
    context.fillRect(0, 0, width, height);
    context.drawImage(strip, 0, top);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    return URL.createObjectURL(blob);
}

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
            <p class="photo-viewer__hint">Drag to look around · Scroll to zoom · Sky and ground beyond the photo are filled in</p>
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
        const sphere = await sphereFor(photo);
        if (current !== opened) return;
        viewer = pannellum.viewer(container, {
            type: 'equirectangular',
            panorama: sphere,
            // Full sphere: look all the way up and down.
            haov: 360,
            vaov: 180,
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
