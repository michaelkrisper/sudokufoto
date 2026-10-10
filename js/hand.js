// Tells printed digits from handwritten ones (pencil or pen entries of
// someone already working on the puzzle). Printed digits share one height,
// are the darkest marks on the page and have the colour of the print;
// handwriting varies in size, pencil is lighter, pen is usually coloured.
import { CELL } from './detect.js';
import { solve } from './solver.js';

const median = (v) => {
  const s = v.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
};

/** Darkness, colour and height of every cut-out digit (null for empty cells). */
export function digitStats(cells, rect, view) {
  const n = rect.width;
  return cells.map((c, i) => {
    if (!c) return null;
    const ox = (i % 9) * CELL,
      oy = Math.floor(i / 9) * CELL;
    const around = [];
    for (let y = oy + 6; y < oy + CELL - 6; y += 2)
      for (let x = ox + 6; x < ox + CELL - 6; x += 2) around.push(rect.data[y * n + x]);
    const paper = Math.max(1, median(around));
    // only the darker half of the stroke: its edges are blurred into the paper
    const ink = c.pix.map((p) => rect.data[p]).sort((a, b) => a - b);
    const core = ink.slice(0, Math.max(1, ink.length >> 1));
    const g = core.reduce((a, b) => a + b, 0) / core.length;
    let sat = 0;
    if (view) {
      for (const p of c.pix) {
        const r = view[p * 4],
          gg = view[p * 4 + 1],
          b = view[p * 4 + 2];
        sat += Math.max(r, gg, b) - Math.min(r, gg, b);
      }
      sat /= c.pix.length;
    }
    return { dark: (paper - g) / paper, sat, h: (c.box[3] - c.box[1]) / CELL };
  });
}

/** How unlike print each digit is; above 1 means probably handwritten. */
export function handScores(stats) {
  const idx = stats.flatMap((s, i) => (s ? [i] : []));
  if (idx.length < 8) return stats.map(() => 0);
  // print reference: the darkest of the digits in the dominant colour
  const satMed = median(idx.map((i) => stats[i].sat));
  const neutral = idx.filter((i) => stats[i].sat <= satMed + 12);
  const byDark = neutral.slice().sort((a, b) => stats[b].dark - stats[a].dark);
  const ref = byDark.slice(0, Math.max(5, Math.ceil(byDark.length * 0.3)));
  const D = median(ref.map((i) => stats[i].dark)),
    S = median(ref.map((i) => stats[i].sat)),
    H = median(ref.map((i) => stats[i].h));
  return stats.map((s) => {
    if (!s) return 0;
    return Math.max((D - s.dark) / (D * 0.35), (s.sat - S) / 35, Math.abs(s.h - H) / (H * 0.16));
  });
}

/**
 * Splits recognised digits into printed givens and handwritten entries. Only
 * done when the printed digits alone make a puzzle with exactly one solution:
 * the most print-like suspects are moved back until they do. Otherwise
 * everything counts as given and the suspects are just reported.
 */
export function separate(digits, scores) {
  const flagged = digits
    .flatMap((d, i) => (d && scores[i] > 1 ? [i] : []))
    .sort((a, b) => scores[a] - scores[b]);
  const none = { givens: digits.slice(), hand: new Array(81).fill(0), flagged };
  if (!flagged.length) return none;
  const givens = digits.slice();
  const hand = new Array(81).fill(0);
  for (const i of flagged) {
    hand[i] = digits[i];
    givens[i] = 0;
  }
  for (const i of [null, ...flagged]) {
    if (i !== null) {
      givens[i] = digits[i];
      hand[i] = 0;
    }
    if (givens.filter(Boolean).length < 17) continue;
    const { count } = solve(givens);
    if (count === 1) return { givens, hand, flagged };
    // contradicts the rest: a wrong entry, keep it as handwriting
    if (count === 0 && i !== null) {
      givens[i] = 0;
      hand[i] = digits[i];
    } else if (count === 0) return none;
  }
  return none;
}
