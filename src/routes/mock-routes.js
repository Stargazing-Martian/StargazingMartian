// MOCK ONLY: fake rover routes for the prototype. Delete this file once
// real traverse data is wired in. Same seed -> same route on every reload.

const KM_PER_DEGREE = 59.27; // Mars: 2π · 3396 km / 360

function seededRandom(text) {
    let seed = 0;
    for (const char of text) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
    return () => {
        // mulberry32
        seed = (seed + 0x6d2b79f5) >>> 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// A wandering line that starts at the pin: 20–40 points, 15–45 km long.
// Returns [[lon, lat], ...] in degrees.
export function createMockRoute(mission) {
    const random = seededRandom(mission.id);
    const pointCount = 20 + Math.floor(random() * 21);
    const lengthKm = 15 + random() * 30;
    const stepKm = lengthKm / (pointCount - 1);
    let heading = random() * Math.PI * 2;
    let { lon, lat } = mission;
    const points = [[lon, lat]];
    for (let i = 1; i < pointCount; i++) {
        heading += (random() - 0.5) * 1.1; // gentle turns
        lat += (stepKm * Math.cos(heading)) / KM_PER_DEGREE;
        lon += (stepKm * Math.sin(heading)) / (KM_PER_DEGREE * Math.cos(lat * Math.PI / 180));
        points.push([lon, lat]);
    }
    return smooth(smooth(points));
}

// Chaikin corner cutting: rounds the zig-zag so the line reads like a path.
// Keeps the first and last point so the route still starts at the pin.
function smooth(points) {
    const result = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
        const [x0, y0] = points[i], [x1, y1] = points[i + 1];
        result.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
        result.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    result.push(points[points.length - 1]);
    return result;
}
