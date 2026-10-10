// Cuts the digits out of synthetic photos with the app's own pipeline and
// appends them to a training file: per sample one label byte (1..9) and
// FEAT*FEAT bytes (0..255).
//
//   tools/synth.py - --n 300 --fonts train | node tools/extract.mjs OUT.bin

import { appendFileSync } from 'node:fs';
import { analyse, FEAT } from '../js/detect.js';

const out = process.argv[2];

async function* cases(stream) {
  let buf = Buffer.alloc(0);
  let head = null;
  for await (const chunk of stream) {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (!head) {
        const nl = buf.indexOf(10);
        if (nl < 0) break;
        head = JSON.parse(buf.subarray(0, nl).toString());
        buf = buf.subarray(nl + 1);
      }
      const size = head.width * head.height;
      if (buf.length < size) break;
      yield {
        ...head,
        img: { data: new Uint8Array(buf.subarray(0, size)), width: head.width, height: head.height },
      };
      buf = buf.subarray(size);
      head = null;
    }
  }
}

let n = 0,
  grids = 0,
  total = 0;
for await (const c of cases(process.stdin)) {
  total++;
  const r = analyse(c.img);
  if (!r) continue;
  const side = Math.hypot(c.corners[1][0] - c.corners[0][0], c.corners[1][1] - c.corners[0][1]);
  const err = Math.max(
    ...r.corners.map((p, i) => Math.hypot(p[0] - c.corners[i][0], p[1] - c.corners[i][1])),
  );
  if (err > side / 30) continue;
  grids++;
  const chunks = [];
  for (let i = 0; i < 81; i++) {
    const want = +c.givens[i];
    if (!want || !r.cells[i]) continue;
    const rec = Buffer.alloc(1 + FEAT * FEAT);
    rec[0] = want;
    for (let k = 0; k < FEAT * FEAT; k++) rec[1 + k] = Math.round(r.cells[i].feat[k] * 255);
    chunks.push(rec);
    n++;
  }
  appendFileSync(out, Buffer.concat(chunks));
}
console.log(`${grids}/${total} grids, ${n} digits`);
