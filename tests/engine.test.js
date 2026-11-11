import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, matches, legalMoves, play, clone, replayRecord, recordOf, adjacent, MOVES, dailySeed } from '../src/engine.js';

test('row boundaries cannot be swapped and invalid swaps do not mutate state', () => {
  assert.equal(adjacent(7, 8), false);
  const state = createGame('garden'), before = clone(state);
  for (const [a, b] of [[-1, 0], [0, 64], [0, 9], [1.5, 2.5], [7, 8]]) assert.equal(play(state, a, b).valid, false);
  let invalid;
  for (let a = 0; a < 63 && !invalid; a++) if (adjacent(a, a + 1) && !play(state, a, a + 1).valid) invalid = play(state, a, a + 1);
  assert.ok(invalid);
  assert.equal(invalid.state.moves, MOVES);
  assert.deepEqual(state, before);
});

test('crossed matches count each shared tile once', () => {
  const board = Array.from({ length: 64 }, (_, i) => ({ id: i, kind: (Math.floor(i / 8) + i % 8) % 6 }));
  for (const slot of [9, 10, 11, 2, 18]) board[slot].kind = 5;
  const found = matches(board);
  assert.ok([9, 10, 11, 2, 18].every(slot => found.includes(slot)));
  assert.equal(new Set(found).size, found.length);
});

test('200 seeded full games remain settled, playable, deterministic and replayable', () => {
  for (let seed = 0; seed < 200; seed++) {
    let state = createGame(`garden-${seed}`);
    assert.deepEqual(state, createGame(`garden-${seed}`));
    assert.equal(matches(state.board).length, 0);
    for (let n = 0; n < MOVES; n++) {
      const available = legalMoves(state.board);
      assert.ok(available.length);
      const old = clone(state), move = available[(seed + n) % available.length];
      const result = play(state, ...move);
      assert.equal(result.valid, true);
      assert.deepEqual(state, old);
      state = result.state;
      assert.equal(state.moves, MOVES - n - 1);
      assert.ok(state.score > old.score);
      assert.equal(state.board.length, 64);
      assert.equal(new Set(state.board.map(t => t.id)).size, 64);
      assert.ok(state.board.every(t => Number.isInteger(t.kind) && t.kind >= 0 && t.kind < 6));
      assert.equal(matches(state.board).length, 0);
      assert.deepEqual(result.frames.at(-1).board, state.board);
    }
    assert.deepEqual(replayRecord(recordOf(state)), state);
    assert.equal(play(state, 0, 1).valid, false);
  }
});

test('save/replay input is bounded and checked against the rules', () => {
  for (const record of [null, { v: 2, seed: 'a', moves: [] }, { v: 1, seed: '<script>', moves: [] }, { v: 1, seed: 'a', moves: [[0, 63]] }, { v: 1, seed: 'a', moves: Array(25).fill([0, 1]) }]) assert.throws(() => replayRecord(record));
  assert.equal(dailySeed(new Date('2026-11-11T23:00:00Z')), 'daily-2026-11-11');
});
