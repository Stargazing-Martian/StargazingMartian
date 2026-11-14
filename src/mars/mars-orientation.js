// IAU 2000 Mars orientation, as preserved by NASA/JPL NAIF:
// https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/mars_iau2000_v1.tpc
// This is an approximate visual orientation, not a precision ephemeris.
// Input: TT days since J2000 (TT approximates the model's TDB here).
// Output: row-major rotation from J2000 equatorial axes to Mars-fixed axes.
export function marsInertialToFixed(days) {
    const radians = Math.PI / 180;
    const centuries = days / 36525;
    const ra = (317.68143 - 0.1061 * centuries) * radians;
    const dec = (52.88650 - 0.0609 * centuries) * radians;
    const w = ((176.630 + 350.89198226 * days) % 360) * radians;
    const sa = Math.sin(ra), ca = Math.cos(ra);
    const sd = Math.sin(dec), cd = Math.cos(dec);
    const sw = Math.sin(w), cw = Math.cos(w);

    // Equatorial node = [-sin(ra), cos(ra), 0]; pole × node gives
    // the second equatorial axis. Rotate these axes by the prime meridian W.
    return [
        -cw * sa - sw * sd * ca, cw * ca - sw * sd * sa, sw * cd,
         sw * sa - cw * sd * ca, -sw * ca - cw * sd * sa, cw * cd,
         cd * ca, cd * sa, sd,
    ];
}
