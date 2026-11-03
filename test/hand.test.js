import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handScores, separate } from '../js/hand.js';
import { solve } from '../js/solver.js';

const parse = (s) => [...s].map(Number);
// Wikipedia's example puzzle and its solution
const PUZZLE = parse('530070000600195000098000060800060003400803001700020006060000280000419005000080079');
const SOLUTION = parse('534678912672195348198342567859761423426853791713924856961537284287419635345286179');
// A 17-clue puzzle (Royle's list): removing any clue makes it ambiguous.
const MINIMAL = parse('000000010400000000020000000000050407008000300001090000300400200050100000000806000');

const print = { dark: 0.8, sat: 5, h: 0.6 };

test('handScores stays neutral with too few digits to compare', () => {
  const stats = [print, null, { dark: 0.1, sat: 90, h: 0.9 }, print];
  assert.deepEqual(handScores(stats), [0, 0, 0, 0]);
});

test('handScores flags light, coloured and off-size digits', () => {
  const stats = new Array(81).fill(null);
  for (let i = 0; i < 20; i++) stats[i] = { ...print, dark: 0.78 + (i % 5) * 0.01 };
  stats[30] = { ...print, dark: 0.35 }; // pencil
  stats[31] = { ...print, sat: 80 }; // blue pen
  stats[32] = { ...print, h: 0.8 }; // larger hand
  const s = handScores(stats);
  for (let i = 0; i < 20; i++) assert.ok(s[i] < 1, `print ${i}: ${s[i]}`);
  for (const i of [30, 31, 32]) assert.ok(s[i] > 1, `hand ${i}: ${s[i]}`);
  assert.equal(s[40], 0);
});

test('separate keeps everything as given when nothing is flagged', () => {
  const r = separate(PUZZLE, new Array(81).fill(0));
  assert.deepEqual(r.givens, PUZZLE);
  assert.ok(r.hand.every((d) => d === 0));
  assert.deepEqual(r.flagged, []);
});

test('separate moves handwritten entries out of the givens', () => {
  const digits = PUZZLE.slice();
  const scores = new Array(81).fill(0);
  // two correct entries and one wrong one, written by hand
  digits[2] = SOLUTION[2];
  digits[3] = SOLUTION[3];
  digits[5] = SOLUTION[5] === 1 ? 2 : 1;
  for (const i of [2, 3, 5]) scores[i] = 3;
  const r = separate(digits, scores);
  assert.deepEqual(r.givens, PUZZLE);
  assert.equal(r.hand[2], SOLUTION[2]);
  assert.equal(r.hand[3], SOLUTION[3]);
  assert.equal(r.hand[5], digits[5]);
  assert.equal(r.hand.filter(Boolean).length, 3);
});

test('separate moves print-like suspects back until the puzzle is unique', () => {
  assert.equal(solve(MINIMAL).count, 1);
  const clue = MINIMAL.findIndex(Boolean);
  const digits = MINIMAL.slice();
  const empty = MINIMAL.indexOf(0);
  const sol = solve(MINIMAL).solution;
  digits[empty] = sol[empty];
  const scores = new Array(81).fill(0);
  scores[clue] = 1.2; // a printed digit that merely looks a bit off
  scores[empty] = 4; // a clear handwritten entry
  const r = separate(digits, scores);
  assert.deepEqual(r.givens, MINIMAL);
  assert.equal(r.hand[empty], sol[empty]);
  assert.equal(r.hand[clue], 0);
});

test('separate gives up when the printed digits contradict each other', () => {
  const digits = PUZZLE.slice();
  digits[2] = 5; // clashes with the 5 in the top-left corner
  const scores = new Array(81).fill(0);
  scores[9] = 3;
  const r = separate(digits, scores);
  assert.deepEqual(r.givens, digits);
  assert.ok(r.hand.every((d) => d === 0));
  assert.deepEqual(r.flagged, [9]);
});
