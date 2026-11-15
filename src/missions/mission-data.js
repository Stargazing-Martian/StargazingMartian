// Landing sites of the 12 missions, shown as 11 pins: Ingenuity flew from
// Perseverance's site, so it is folded into the Perseverance pin.
// Coordinates: planetocentric latitude, east-positive longitude (-180..180).
// hasRoute: a real traverse file exists in data/routes/<id>.json.
export const MISSIONS = [
    { id: 'viking-1',     name: 'Viking 1',          lat: 22.27,   lon: -47.95,   type: 'lander',   hasRoute: false },
    { id: 'viking-2',     name: 'Viking 2',          lat: 47.64,   lon: 134.29,   type: 'lander',   hasRoute: false },
    { id: 'pathfinder',   name: 'Mars Pathfinder',   lat: 19.13,   lon: -33.22,   type: 'lander',   hasRoute: false },
    // Lost on arrival in 1999; the impact site was never found. Target area.
    { id: 'deep-space-2', name: 'Deep Space 2',      lat: -75.0,   lon: 164.0,    type: 'failed',   hasRoute: false },
    { id: 'spirit',       name: 'Spirit',            lat: -14.5684, lon: 175.4726, type: 'rover',   hasRoute: true },
    { id: 'opportunity',  name: 'Opportunity',       lat: -1.9462, lon: -5.5266,  type: 'rover',    hasRoute: true },
    { id: 'phoenix',      name: 'Phoenix',           lat: 68.2188, lon: -125.7492, type: 'lander',  hasRoute: false },
    { id: 'curiosity',    name: 'Curiosity',         lat: -4.5895, lon: 137.4417, type: 'rover',    hasRoute: true },
    // ESA's Schiaparelli lander crashed in 2016; this is its impact site.
    { id: 'schiaparelli', name: 'ExoMars Schiaparelli', lat: -2.052, lon: -6.208, type: 'failed',   hasRoute: false },
    { id: 'insight',      name: 'InSight',           lat: 4.5024,  lon: 135.6234, type: 'lander',   hasRoute: false },
    { id: 'perseverance', name: 'Perseverance',      lat: 18.4447, lon: 77.4508,  type: 'rover',    hasRoute: true },
];
