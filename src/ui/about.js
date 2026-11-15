// About dialog: a peek-style card over the dimmed page. Opens from the
// About button; closes with ×, Esc or a click outside the card.
export function createAbout() {
    const dialog = document.getElementById('about-dialog');
    const opener = document.getElementById('about-open');
    const open = () => {
        dialog.hidden = false;
        dialog.querySelector('[data-about-close]').focus();
    };
    const close = () => {
        if (dialog.hidden) return;
        dialog.hidden = true;
        opener.focus();
    };
    opener.addEventListener('click', open);
    dialog.addEventListener('click', event => {
        if (event.target === dialog || event.target.closest('[data-about-close]')) close();
    });
    // Capture phase: Esc closes the dialog without also clearing the map selection.
    window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !dialog.hidden) { event.stopPropagation(); close(); }
    }, true);
    // Scrolling the dialog must not start exploring or zoom the globe.
    window.addEventListener('wheel', event => {
        if (!dialog.hidden) event.stopImmediatePropagation();
    }, { capture: true, passive: true });
}
