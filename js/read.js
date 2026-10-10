// The whole reading of a photo: grid, orientation, digits, handwriting, solution.
import { analyse, CELL, extractCells, rotateCorners, rotateRect, warpRGBA } from './detect.js';
import { digitStats, handScores, separate } from './hand.js';
import { classifyCells } from './ocr.js';
import { solve } from './solver.js';

// Upright print is read almost certainly; turned digits rarely are, and
// handwriting is unsure in any orientation, so count only crisp reads.
const legibility = ({ digits, conf }) => {
  let n = 0,
    sum = 0;
  for (let i = 0; i < 81; i++) {
    if (!digits[i]) continue;
    if (conf[i] >= 0.97) n++;
    sum += conf[i];
  }
  return n + sum / 100;
};

/**
 * gray: { data, width, height }; rgba (optional): the same photo in colour,
 * for the displayed picture and to tell coloured pen from print.
 */
export function readSudoku(gray, rgba = null) {
  const r = analyse(gray);
  if (!r) return null;
  let best = { k: 0, rect: r.rect, cells: r.cells, cls: classifyCells(r.cells) };
  // photo taken sideways or upside down: the digits are most legible upright
  // (always check, an upside-down 6 is a perfectly confident 9)
  for (let k = 1; k < 4; k++) {
    const rect = rotateRect(r.rect, k);
    const cells = extractCells(rect);
    const cls = classifyCells(cells);
    if (legibility(cls) > legibility(best.cls) + 1) best = { k, rect, cells, cls };
  }
  const corners = rotateCorners(r.corners, best.k);
  const view = rgba ? warpRGBA(rgba, gray.width, gray.height, corners, 9 * CELL) : null;
  const { givens, hand } = separate(best.cls.digits, handScores(digitStats(best.cells, best.rect, view)));
  const { solution, count } = solve(givens);
  return { corners, digits: givens, hand, conf: best.cls.conf, solution, count, view, viewSize: 9 * CELL };
}
