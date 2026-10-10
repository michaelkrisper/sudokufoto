import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { homography, orderCorners, project } from '../js/detect.js';
import { readSudoku } from '../js/read.js';
import { readPGM } from '../tools/pgm.js';

test('homography maps the four corners', () => {
  const src = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  const dst = [
    [3, 4],
    [40, 9],
    [37, 51],
    [1, 44],
  ];
  const h = homography(src, dst);
  for (let i = 0; i < 4; i++) {
    const [x, y] = project(h, ...src[i]);
    assert.ok(Math.hypot(x - dst[i][0], y - dst[i][1]) < 1e-6);
  }
});

test('corners are ordered TL, TR, BR, BL', () => {
  const q = [
    [90, 95],
    [10, 12],
    [12, 88],
    [95, 8],
  ];
  assert.deepEqual(orderCorners(q), [
    [10, 12],
    [95, 8],
    [90, 95],
    [12, 88],
  ]);
});

// Synthetic photos need Python with Pillow and numpy (as in CI).
const py = spawnSync('python3', ['-c', 'import PIL, numpy'], { stdio: 'ignore' });
test('reads synthetic sudoku photos', {
  skip: py.status !== 0 && 'needs python3 with Pillow + numpy',
}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'sudokufoto-'));
  const gen = spawnSync('python3', [
    'tools/synth.py',
    dir,
    '--n',
    '16',
    '--seed',
    '3',
    '--fonts',
    'all',
    '--size',
    '1000',
  ]);
  assert.equal(gen.status, 0, String(gen.stderr));
  const cases = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8'));
  let grids = 0,
    exact = 0,
    cells = 0,
    right = 0;
  for (const c of cases) {
    const r = readSudoku(readPGM(join(dir, `${c.name}.pgm`)));
    if (!r) continue;
    grids++;
    const digits = r.digits.map((d, i) => d || r.hand[i]);
    let ok = 0;
    for (let i = 0; i < 81; i++) ok += digits[i] === +c.givens[i];
    cells += 81;
    right += ok;
    if (ok === 81) exact++;
  }
  console.info(`grids ${grids}/${cases.length}, exact ${exact}, cells ${right}/${cells}`);
  assert.ok(grids >= 15, `grid found in ${grids}/16`);
  assert.ok(right / cells > 0.995, `cell accuracy ${right}/${cells}`);
  assert.ok(exact >= 13, `${exact}/16 read without a single error`);
});
