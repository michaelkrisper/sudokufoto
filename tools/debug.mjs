// Writes the rectified grid with the cut-out boxes and threshold as PGM.
//   node tools/debug.mjs DIR NAME OUT.pgm
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyse } from '../js/detect.js';
import { readPGM } from './pgm.js';

const [dir, name, out] = process.argv.slice(2);
const r = analyse(readPGM(join(dir, `${name}.pgm`)));
if (!r) throw new Error('no grid');
const n = r.rect.width;
const img = Uint8Array.from(r.rect.data);
for (const c of r.cells) {
  if (!c) continue;
  const [x0, y0, x1, y1] = c.box;
  for (let x = x0; x < x1; x++) img[y0 * n + x] = img[(y1 - 1) * n + x] = 128;
  for (let y = y0; y < y1; y++) img[y * n + x0] = img[y * n + x1 - 1] = 128;
}
writeFileSync(out, Buffer.concat([Buffer.from(`P5\n${n} ${n}\n255\n`), img]));
console.log(r.score.toFixed(3), r.corners.map((p) => p.map(Math.round).join(',')).join(' '));
