// Map-mode tiles in the side panel. They drive the existing #science-map-mode
// select (which owns the science-map logic), and follow it if anything else
// changes the mode.
export function createMapModePicker() {
    const select = document.getElementById('science-map-mode');
    const tiles = [...document.querySelectorAll('.map-mode')];
    const sync = () => {
        for (const tile of tiles) tile.setAttribute('aria-checked', String(tile.dataset.mode === select.value));
    };
    for (const tile of tiles) {
        tile.addEventListener('click', () => {
            if (select.value === tile.dataset.mode) return;
            select.value = tile.dataset.mode;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            sync();
        });
    }
    select.addEventListener('change', sync);
    sync();
}
