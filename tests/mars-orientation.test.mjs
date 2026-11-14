import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marsInertialToFixed } from '../src/mars/mars-orientation.js';

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const apply = (m, v) => [0, 3, 6].map(i => dot(m.slice(i, i + 3), v));
const close = (actual, expected, tolerance = 1e-10) =>
    assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('orientation is a right-handed orthonormal rotation across epochs', () => {
    for (const days of [-36525, 0, 9779, 36525]) {
        const m = marsInertialToFixed(days);
        const rows = [m.slice(0, 3), m.slice(3, 6), m.slice(6)];
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) close(dot(rows[i], rows[j]), Number(i === j));
        }
        const cross = [rows[0][1] * rows[1][2] - rows[0][2] * rows[1][1],
            rows[0][2] * rows[1][0] - rows[0][0] * rows[1][2],
            rows[0][0] * rows[1][1] - rows[0][1] * rows[1][0]];
        close(dot(cross, rows[2]), 1);
    }
});

test('published J2000 Mars north pole maps to the positive fixed Z axis', () => {
    const ra = 317.68143 * Math.PI / 180;
    const dec = 52.88650 * Math.PI / 180;
    const pole = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
    const result = apply(marsInertialToFixed(0), pole);
    result.forEach((value, i) => close(value, Number(i === 2)));
});

test('inertial equatorial direction drifts west during a quarter Martian rotation', () => {
    const start = marsInertialToFixed(0);
    // The first matrix row is the prime-meridian direction in inertial coordinates.
    const direction = start.slice(0, 3);
    const result = apply(marsInertialToFixed(90 / 350.89198226), direction);
    close(result[0], 0, 1e-7);
    close(result[1], -1, 1e-7);
    close(result[2], 0, 1e-7);
});
