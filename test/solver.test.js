import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conflicts, solve } from '../js/solver.js';

const parse = (s) => [...s].map(Number);
// Wikipedia's example puzzle and its solution
const PUZZLE = parse('530070000600195000098000060800060003400803001700020006060000280000419005000080079');
const SOLUTION = '534678912672195348198342567859761423426853791713924856961537284287419635345286179';

test('solves a unique puzzle', () => {
  const r = solve(PUZZLE);
  assert.equal(r.count, 1);
  assert.equal(r.solution.join(''), SOLUTION);
});

test('hard puzzle (Arto Inkala)', () => {
  const r = solve(parse('800000000003600000070090200050007000000045700000100030001000068008500010090000400'));
  assert.equal(r.count, 1);
  assert.equal(
    r.solution.join(''),
    '812753649943682175675491283154237896369845721287169534521974368438526917796318452',
  );
});

test('reports ambiguous puzzles', () => {
  const g = PUZZLE.slice();
  g[0] = 0;
  g[1] = 0;
  g[4] = 0;
  g[9] = 0;
  const r = solve(g);
  assert.ok(r.count >= 1);
  assert.equal(solve(new Array(81).fill(0)).count, 2);
});

test('reports conflicts and unsolvable puzzles', () => {
  const g = PUZZLE.slice();
  g[2] = 5;
  assert.deepEqual(
    [...conflicts(g)].sort((a, b) => a - b),
    [0, 2],
  );
  assert.equal(solve(g).count, 0);
  const h = PUZZLE.slice();
  h[2] = 2; // no conflict, but the unique solution has a 4 there
  assert.equal(conflicts(h).size, 0);
  assert.equal(solve(h).count, 0);
});
