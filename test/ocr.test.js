import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, classifyCells } from '../js/ocr.js';
import { MODEL } from '../js/model.js';

const FEAT = MODEL.layers[0].in;

test('model layers chain and end in nine classes', () => {
  for (let i = 1; i < MODEL.layers.length; i++) assert.equal(MODEL.layers[i].in, MODEL.layers[i - 1].out);
  assert.equal(MODEL.layers.at(-1).out, 9);
});

test('classify returns a probability distribution over the digits 1..9', () => {
  const feat = Float32Array.from({ length: FEAT }, (_, i) => ((i * 7919) % 13) / 13);
  const p = classify(feat);
  assert.equal(p.length, 9);
  assert.ok(p.every((v) => v >= 0 && v <= 1));
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-5);
});

test('classifyCells: empty cells are 0 with full confidence, others the argmax', () => {
  const feat = new Float32Array(FEAT).fill(0.5);
  const { digits, conf, probs } = classifyCells([null, { feat }]);
  assert.deepEqual([digits[0], conf[0], probs[0]], [0, 1, null]);
  const p = classify(feat);
  const k = p.indexOf(Math.max(...p));
  assert.equal(digits[1], k + 1);
  assert.equal(conf[1], p[k]);
});
