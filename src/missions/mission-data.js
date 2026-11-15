// Landing sites of the 12 missions, shown as 11 pins: Ingenuity flew from
// Perseverance's site, so it is folded into the Perseverance pin.
// Coordinates: planetocentric latitude, east-positive longitude (-180..180).
// hasRoute: a real traverse file exists in data/routes/<id>.json.
// kind / year / place / status / summary feed the left panel.
export const MISSIONS = [
    {
        id: 'viking-1', name: 'Viking 1', lat: 22.27, lon: -47.95, type: 'lander', hasRoute: false,
        kind: 'Lander', year: 1976, place: 'Chryse Planitia', status: 'Ended 1982',
        summary: 'The first successful US landing on Mars. It returned the first pictures from the surface and tested the soil for signs of life.',
    },
    {
        id: 'viking-2', name: 'Viking 2', lat: 47.64, lon: 134.29, type: 'lander', hasRoute: false,
        kind: 'Lander', year: 1976, place: 'Utopia Planitia', status: 'Ended 1980',
        summary: 'Landed on rocky northern plains and photographed a thin layer of frost on the ground during the Martian winter.',
    },
    {
        id: 'pathfinder', name: 'Mars Pathfinder', lat: 19.13, lon: -33.22, type: 'lander', hasRoute: false,
        kind: 'Lander + Sojourner rover', year: 1997, place: 'Ares Vallis', status: 'Ended 1997',
        summary: 'Delivered Sojourner, the first rover on Mars, to an ancient flood plain covered in rocks. Sojourner drove about 100 m; no traverse file is published, so no route is shown.',
    },
    {
        // Lost on arrival in 1999; the impact site was never found. Target area.
        id: 'deep-space-2', name: 'Deep Space 2', lat: -75.0, lon: 164.0, type: 'failed', hasRoute: false,
        kind: 'Penetrator probes', year: 1999, place: 'South polar layered terrain', status: 'Lost on arrival',
        summary: 'Two small probes built to punch into the ground and look for water ice. No signal was ever received; the pin marks the target area, not a known impact site.',
    },
    {
        id: 'spirit', name: 'Spirit', lat: -14.5684, lon: 175.4726, type: 'rover', hasRoute: true,
        kind: 'Rover', year: 2004, place: 'Gusev crater', status: 'Ended 2010',
        summary: 'Found silica-rich soil at Home Plate, a sign of ancient hot springs. It became stuck in soft sand at Troy in 2009 and fell silent in 2010.',
    },
    {
        id: 'opportunity', name: 'Opportunity', lat: -1.9462, lon: -5.5266, type: 'rover', hasRoute: true,
        kind: 'Rover', year: 2004, place: 'Meridiani Planum', status: 'Ended 2018',
        summary: 'Found hematite and layered rocks formed in water. It drove 45 km across the plains to Endeavour crater before a global dust storm ended the mission.',
    },
    {
        id: 'phoenix', name: 'Phoenix', lat: 68.2188, lon: -125.7492, type: 'lander', hasRoute: false,
        kind: 'Lander', year: 2008, place: 'Vastitas Borealis', status: 'Ended 2008',
        summary: 'Dug into the arctic soil and confirmed water ice just centimetres below the surface.',
    },
    {
        id: 'curiosity', name: 'Curiosity', lat: -4.5895, lon: 137.4417, type: 'rover', hasRoute: true,
        kind: 'Rover', year: 2012, place: 'Gale crater', status: 'Active',
        summary: 'Showed that Gale crater once held a lake that could have supported microbial life. It is still climbing the layered slopes of Mount Sharp.',
    },
    {
        // ESA's Schiaparelli lander crashed in 2016; this is its impact site.
        id: 'schiaparelli', name: 'ExoMars Schiaparelli', lat: -2.052, lon: -6.208, type: 'failed', hasRoute: false,
        kind: 'Test lander (ESA)', year: 2016, place: 'Meridiani Planum', status: 'Crashed on landing',
        summary: 'A test lander for ESA\'s ExoMars programme. A sensor error cut its descent short and it crashed; the pin marks the impact site seen from orbit.',
    },
    {
        id: 'insight', name: 'InSight', lat: 4.5024, lon: 135.6234, type: 'lander', hasRoute: false,
        kind: 'Lander', year: 2018, place: 'Elysium Planitia', status: 'Ended 2022',
        summary: 'Recorded marsquakes to map the planet\'s crust, mantle and core. The mission ended when dust covered its solar panels.',
    },
    {
        id: 'perseverance', name: 'Perseverance', lat: 18.4447, lon: 77.4508, type: 'rover', hasRoute: true,
        kind: 'Rover + Ingenuity helicopter', year: 2021, place: 'Jezero crater', status: 'Active',
        summary: 'Collecting rock samples from an ancient river delta for a future return to Earth. It carried Ingenuity, the first aircraft to fly on another planet (72 flights).',
    },
];
