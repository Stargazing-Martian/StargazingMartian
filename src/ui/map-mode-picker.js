// Map-mode tiles in the map panel: Dust, Terrain, Topography, Temperature.
// They drive the existing controls, which own the map logic:
//   #science-map-mode  (surface | dust | temperature) and
//   #topography        (elevation colours on the surface view).
// Terrain and Topography are both the surface view, without / with colours.
export function createMapModePicker() {
    const select = document.getElementById('science-map-mode');
    const topography = document.getElementById('topography');
    const tiles = [...document.querySelectorAll('.map-mode')];

    const current = () => select.value !== 'surface' ? select.value
        : topography.checked ? 'topography' : 'surface';
    const sync = () => {
        for (const tile of tiles) tile.setAttribute('aria-checked', String(tile.dataset.mode === current()));
    };
    const set = (element, property, value) => {
        if (element[property] === value) return;
        element[property] = value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
    };

    for (const tile of tiles) {
        tile.addEventListener('click', () => {
            const mode = tile.dataset.mode;
            const surface = mode === 'surface' || mode === 'topography';
            set(select, 'value', surface ? 'surface' : mode);
            if (surface) set(topography, 'checked', mode === 'topography');
            sync();
        });
    }
    select.addEventListener('change', sync);
    topography.addEventListener('change', sync);
    sync();
}
