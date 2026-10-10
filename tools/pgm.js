import { readFileSync } from 'node:fs';

/** Reads a binary (P5) PGM written by tools/synth.py. */
export function readPGM(path) {
  const buf = readFileSync(path);
  const head = buf.subarray(0, 64).toString('latin1');
  const m = head.match(/^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/);
  if (!m) throw new Error(`not a P5 pgm: ${path}`);
  const width = +m[1],
    height = +m[2];
  return { data: new Uint8Array(buf.subarray(m[0].length, m[0].length + width * height)), width, height };
}
