// Digit classifier: a small fully connected net trained by tools/train.py on
// digits cut out of synthetic photos by the same code the app uses.
import { MODEL } from './model.js';

function decode(layer) {
  const bytes = Uint8Array.from(atob(layer.w), (c) => c.charCodeAt(0));
  const w = new Float32Array(bytes.length);
  for (let o = 0; o < layer.out; o++) {
    for (let i = 0; i < layer.in; i++) {
      const k = o * layer.in + i;
      w[k] = ((bytes[k] << 24) >> 24) * layer.scale[o];
    }
  }
  return { ...layer, w };
}

let layers = null;

/** Probabilities for the digits 1..9 (index 0 = digit 1). */
export function classify(feat) {
  layers ??= MODEL.layers.map(decode);
  let x = feat;
  for (const [li, L] of layers.entries()) {
    const y = new Float32Array(L.out);
    for (let o = 0; o < L.out; o++) {
      let s = L.b[o];
      const row = o * L.in;
      for (let i = 0; i < L.in; i++) s += L.w[row + i] * x[i];
      y[o] = li < layers.length - 1 ? Math.max(0, s) : s;
    }
    x = y;
  }
  const max = Math.max(...x);
  const e = x.map((v) => Math.exp(v - max));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / sum);
}

/** Digits (0 = empty) and confidences for the 81 cells from detect.extractCells. */
export function classifyCells(cells) {
  const digits = [],
    conf = [],
    probs = [];
  for (const c of cells) {
    if (!c) {
      digits.push(0);
      conf.push(1);
      probs.push(null);
      continue;
    }
    if (!MODEL) {
      digits.push(-1);
      conf.push(0);
      probs.push(null);
      continue;
    }
    const p = classify(c.feat);
    let k = 0;
    for (let i = 1; i < 9; i++) if (p[i] > p[k]) k = i;
    digits.push(k + 1);
    conf.push(p[k]);
    probs.push(p);
  }
  return { digits, conf, probs };
}
