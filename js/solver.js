// Sudoku as an 81-element array, row by row, 0 = empty.

const ROW = [],
  COL = [],
  BOX = [];
for (let i = 0; i < 81; i++) {
  ROW[i] = Math.floor(i / 9);
  COL[i] = i % 9;
  BOX[i] = Math.floor(ROW[i] / 3) * 3 + Math.floor(COL[i] / 3);
}

const popcount = (m) => {
  let n = 0;
  for (; m; m &= m - 1) n++;
  return n;
};

/** Indices of cells whose digit repeats in a row, column or box. */
export function conflicts(grid) {
  const bad = new Set();
  for (let i = 0; i < 81; i++) {
    if (!grid[i]) continue;
    for (let j = i + 1; j < 81; j++) {
      if (grid[j] !== grid[i]) continue;
      if (ROW[i] === ROW[j] || COL[i] === COL[j] || BOX[i] === BOX[j]) {
        bad.add(i);
        bad.add(j);
      }
    }
  }
  return bad;
}

/**
 * Solves by depth-first search on the most constrained cell.
 * Returns { solution, count } where count is 0, 1 or 2 (2 = at least two
 * solutions, i.e. the puzzle is not unique); solution is the first one found.
 */
export function solve(grid, limit = 2) {
  if (grid.length !== 81 || conflicts(grid).size) return { solution: null, count: 0 };
  const g = grid.slice();
  const rows = new Array(9).fill(0),
    cols = new Array(9).fill(0),
    boxes = new Array(9).fill(0);
  for (let i = 0; i < 81; i++) {
    if (!g[i]) continue;
    const b = 1 << g[i];
    rows[ROW[i]] |= b;
    cols[COL[i]] |= b;
    boxes[BOX[i]] |= b;
  }
  let solution = null,
    count = 0;
  const FULL = 0x3fe;

  const search = () => {
    let best = -1,
      bestFree = 0,
      bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const free = FULL & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]);
      const n = popcount(free);
      if (n < bestN) {
        best = i;
        bestFree = free;
        bestN = n;
        if (n <= 1) break;
      }
    }
    if (best < 0) {
      count++;
      solution ??= g.slice();
      return count >= limit;
    }
    for (let d = 1; d <= 9; d++) {
      const b = 1 << d;
      if (!(bestFree & b)) continue;
      g[best] = d;
      rows[ROW[best]] |= b;
      cols[COL[best]] |= b;
      boxes[BOX[best]] |= b;
      const stop = search();
      rows[ROW[best]] &= ~b;
      cols[COL[best]] &= ~b;
      boxes[BOX[best]] &= ~b;
      g[best] = 0;
      if (stop) return true;
    }
    return false;
  };
  search();
  return { solution, count };
}
