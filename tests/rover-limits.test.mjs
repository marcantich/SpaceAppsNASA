import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitingFactor } from '../app/src/rover-limits.js';

const base = {
  status: 'field', missing: [], noTarget: [],
  used: [{ name: 'slope', label: 'Slope', target: 10, margin: 5 },
    { name: 'temperature', label: 'Temperature', target: 200, margin: 100 }],
  closest: { earth: { slope: 14, temperature: 220 } },
};

test('uses the largest relative mismatch, rather than the largest raw difference', () => {
  const f = limitingFactor(base);
  assert.equal(f.label, 'Slope');
  assert.equal(f.ratio, 0.8);
  assert.equal(f.earth, 14);
});

test('physical caps take precedence over matching terrain', () => {
  const cap = { max: 'lab', factor: 'Vacuum', why: 'Vacuum changes heat transfer.' };
  assert.equal(limitingFactor({ ...base, status: 'lab', cap }).label, 'Vacuum');
  assert.equal(limitingFactor({ ...base, status: 'lab', cap }).why, cap.why);
  assert.equal(limitingFactor({ ...base, status: 'partial', cap: { ...cap, max: 'partial' } }).why, cap.why);
});

test('reports missing data without inventing a physical mismatch', () => {
  assert.match(limitingFactor({ ...base, status: 'partial', missing: ['rock abundance'] }).why, /rock abundance/);
  assert.equal(limitingFactor({ ...base, status: 'nodata' }).label, 'Insufficient data');
  assert.equal(limitingFactor({ ...base, closest: null }).label, 'Insufficient data');
});

test('lab classifications can explain the closest terrain even outside twice the margin', () => {
  const f = limitingFactor({ ...base, status: 'lab', closest: { earth: { slope: 30, temperature: 220 } } });
  assert.equal(f.label, 'Slope');
  assert.equal(f.ratio, 4);
});

test('exact matches do not falsely claim a limiting variable', () => {
  assert.equal(limitingFactor({ ...base, closest: { earth: { slope: 10, temperature: 200 } } }).label, 'No measured mismatch');
});
