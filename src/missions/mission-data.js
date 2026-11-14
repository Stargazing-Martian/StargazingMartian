/*
Real missions (to replace the mock pins later):
viking 1
viking 2
mars pathfinder + sojourner
deep space 2 (LANDER)
spirit
opportunity
mars phoenix
curiosity
exomars
insight
perseverance rover
Ingenuity Mars Helicopter
*/

// Mock pins for the prototype. Same shape the real mission data will use,
// so swapping in real missions only changes this file.
// Pins 2 and 6 have no route on purpose, to test routeless (lander) pins.
export const MISSIONS = [
    { id: 'pin-1',  name: 'Pin 1',  lat:  22.3, lon:  -48.0, type: 'rover',  hasRoute: true  },
    { id: 'pin-2',  name: 'Pin 2',  lat:  47.6, lon:  134.3, type: 'lander', hasRoute: false },
    { id: 'pin-3',  name: 'Pin 3',  lat:  19.1, lon:  -33.2, type: 'rover',  hasRoute: true  },
    { id: 'pin-4',  name: 'Pin 4',  lat: -14.6, lon:  175.5, type: 'rover',  hasRoute: true  },
    { id: 'pin-5',  name: 'Pin 5',  lat:  -1.9, lon:   -5.5, type: 'rover',  hasRoute: true  },
    { id: 'pin-6',  name: 'Pin 6',  lat:  68.2, lon: -125.7, type: 'lander', hasRoute: false },
    { id: 'pin-7',  name: 'Pin 7',  lat:  -4.6, lon:  137.4, type: 'rover',  hasRoute: true  },
    { id: 'pin-8',  name: 'Pin 8',  lat:   4.5, lon:  110.0, type: 'rover',  hasRoute: true  },
    { id: 'pin-9',  name: 'Pin 9',  lat:  18.4, lon:   77.5, type: 'rover',  hasRoute: true  },
    { id: 'pin-10', name: 'Pin 10', lat: -30.0, lon:   40.0, type: 'rover',  hasRoute: true  },
];
