// Runs the recogniser over a folder made by tools/synth.py and reports
// grid, occupancy and digit accuracy.
//
//   node tools/eval.mjs DIR [--verbose]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSudoku } from '../js/read.js';
import { readPGM } from './pgm.js';

const dir = process.argv[2];
const verbose = process.argv.includes('--verbose');
const cases = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8'));
let found = 0,
  perfect = 0,
  cellsOk = 0,
  cellsAll = 0,
  missed = 0,
  extra = 0,
  wrong = 0,
  cornerErr = 0;
const t0 = performance.now();
for (const c of cases) {
  const img = readPGM(join(dir, `${c.name}.pgm`));
  const r = readSudoku(img);
  if (!r) {
    if (verbose) console.log(c.name, 'no grid');
    continue;
  }
  if (!c.corners) c.corners = r.corners;
  const side = Math.hypot(c.corners[1][0] - c.corners[0][0], c.corners[1][1] - c.corners[0][1]);
  const err = Math.max(
    ...r.corners.map((p, i) => Math.hypot(p[0] - c.corners[i][0], p[1] - c.corners[i][1])),
  );
  if (err > side / 18) {
    if (verbose) console.log(c.name, 'bad corners', (err / side).toFixed(3));
    continue;
  }
  found++;
  cornerErr = Math.max(cornerErr, err / side);
  // handwriting does not exist in synthetic photos; count everything that was read
  const digits = r.digits.map((d, i) => d || r.hand[i]);
  let bad = 0;
  const notes = [];
  for (let i = 0; i < 81; i++) {
    const want = +c.givens[i],
      got = digits[i];
    cellsAll++;
    if (want === got) {
      cellsOk++;
      continue;
    }
    bad++;
    if (!got) missed++;
    else if (!want) extra++;
    else wrong++;
    notes.push(`${i}:${want}->${got}`);
  }
  if (!bad) perfect++;
  else if (verbose) console.log(c.name, notes.join(' '));
}
const ms = (performance.now() - t0) / cases.length;
console.log(
  `grid ${found}/${cases.length}  perfect ${perfect}/${cases.length}  cells ${cellsOk}/${cellsAll}` +
    `  missed ${missed} extra ${extra} wrong ${wrong}  max corner err ${(cornerErr * 100).toFixed(1)}%  ${ms.toFixed(0)} ms/img`,
);
