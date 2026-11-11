export const SIZE = 8;
export const KINDS = 6;
export const MOVES = 24;
export const TARGET = 1800;
export const RULES = 1;

export function normalizeSeed(seed) {
  if (typeof seed !== 'string' || !/^[a-zA-Z0-9-]{1,48}$/.test(seed)) throw new Error('Use 1–48 letters, numbers or hyphens for a garden code.');
  return seed;
}

function hash(seed) {
  let value = 2166136261;
  for (const char of seed) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

function random(state, max) {
  state.rng = (state.rng + 0x6D2B79F5) >>> 0;
  let n = state.rng;
  n = Math.imul(n ^ n >>> 15, n | 1);
  n ^= n + Math.imul(n ^ n >>> 7, n | 61);
  return Math.floor(((n ^ n >>> 14) >>> 0) / 4294967296 * max);
}

export const adjacent = (a, b) => Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && a < 64 && b < 64 && Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE)) + Math.abs(a % SIZE - b % SIZE) === 1;
export const clone = state => structuredClone(state);

export function matches(board) {
  const found = new Set();
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE;) {
      const start = col, kind = board[row * SIZE + col]?.kind;
      while (col < SIZE && board[row * SIZE + col]?.kind === kind) col++;
      if (kind !== undefined && col - start >= 3) for (let n = start; n < col; n++) found.add(row * SIZE + n);
    }
  }
  for (let col = 0; col < SIZE; col++) {
    for (let row = 0; row < SIZE;) {
      const start = row, kind = board[row * SIZE + col]?.kind;
      while (row < SIZE && board[row * SIZE + col]?.kind === kind) row++;
      if (kind !== undefined && row - start >= 3) for (let n = start; n < row; n++) found.add(n * SIZE + col);
    }
  }
  return [...found].sort((a, b) => a - b);
}

function swapped(board, a, b) {
  const result = board.slice();
  [result[a], result[b]] = [result[b], result[a]];
  return result;
}

export function legalMoves(board) {
  const moves = [];
  for (let a = 0; a < 64; a++) {
    for (const b of [a + 1, a + SIZE]) {
      if (adjacent(a, b) && matches(swapped(board, a, b)).length) moves.push([a, b]);
    }
  }
  return moves;
}

function fillFresh(state) {
  state.board = [];
  for (let i = 0; i < 64; i++) {
    const choices = [];
    for (let kind = 0; kind < KINDS; kind++) {
      if (i % SIZE >= 2 && state.board[i - 1].kind === kind && state.board[i - 2].kind === kind) continue;
      if (i >= SIZE * 2 && state.board[i - SIZE].kind === kind && state.board[i - SIZE * 2].kind === kind) continue;
      choices.push(kind);
    }
    state.board.push({ id: state.nextId++, kind: choices[random(state, choices.length)] });
  }
}

export function ensurePlayable(state) {
  if (legalMoves(state.board).length) return false;
  // Bounded shuffles preserve pieces; a fresh board is a deterministic fallback.
  for (let attempt = 0; attempt < 80; attempt++) {
    for (let i = 63; i > 0; i--) {
      const j = random(state, i + 1);
      [state.board[i], state.board[j]] = [state.board[j], state.board[i]];
    }
    if (!matches(state.board).length && legalMoves(state.board).length) return true;
  }
  do { fillFresh(state); } while (!legalMoves(state.board).length);
  return true;
}

export function createGame(seed) {
  normalizeSeed(seed);
  const state = { seed, rng: hash(seed), board: [], nextId: 1, score: 0, moves: MOVES, history: [], harvest: Array(KINDS).fill(0), bestCombo: 0 };
  fillFresh(state);
  ensurePlayable(state);
  return state;
}

function frame(state, phase, extra = {}) {
  return { phase, board: state.board.map(tile => tile && { ...tile }), score: state.score, moves: state.moves, harvest: [...state.harvest], ...extra };
}

export function play(state, a, b, { frames = true } = {}) {
  if (!adjacent(a, b) || state.moves <= 0) return { valid: false, state, frames: [] };
  const next = clone(state), sequence = [];
  next.board = swapped(next.board, a, b);
  const add = (phase, extra) => { if (frames) sequence.push(frame(next, phase, extra)); };
  add('swap');
  if (!matches(next.board).length) {
    if (frames) sequence.push(frame(state, 'return'));
    return { valid: false, state, frames: sequence };
  }
  next.moves--;
  next.history.push([a, b]);
  let combo = 0;
  let found;
  while ((found = matches(next.board)).length) {
    if (++combo > 128) throw new Error('Cascade limit exceeded.');
    const gain = found.length * 20 * combo;
    next.score += gain;
    next.bestCombo = Math.max(next.bestCombo, combo);
    for (const slot of found) next.harvest[next.board[slot].kind]++;
    add('clear', { cleared: found, combo, gain });
    for (const slot of found) next.board[slot] = null;
    const origins = {};
    for (let col = 0; col < SIZE; col++) {
      const remaining = [];
      for (let row = 0; row < SIZE; row++) {
        const tile = next.board[row * SIZE + col];
        if (tile) remaining.push(tile);
      }
      const missing = SIZE - remaining.length;
      const fresh = Array.from({ length: missing }, (_, i) => {
        const tile = { id: next.nextId++, kind: random(next, KINDS) };
        origins[tile.id] = (i - missing) * SIZE + col;
        return tile;
      });
      const column = [...fresh, ...remaining];
      for (let row = 0; row < SIZE; row++) next.board[row * SIZE + col] = column[row];
    }
    add('fall', { origins, combo });
  }
  if (next.moves > 0 && ensurePlayable(next)) add('shuffle');
  add('settled', { combo });
  return { valid: true, state: next, frames: sequence, combo, gain: next.score - state.score };
}

export function replayRecord(record) {
  if (!record || record.v !== RULES || !Array.isArray(record.moves) || record.moves.length > MOVES) throw new Error('This replay is not supported.');
  let state = createGame(record.seed);
  for (const pair of record.moves) {
    if (!Array.isArray(pair) || pair.length !== 2) throw new Error('Invalid replay move.');
    const result = play(state, pair[0], pair[1], { frames: false });
    if (!result.valid) throw new Error('Replay contains an invalid move.');
    state = result.state;
  }
  return state;
}

export const recordOf = state => ({ v: RULES, seed: state.seed, moves: state.history.map(pair => [...pair]) });
export const dailySeed = (date = new Date()) => `daily-${date.toISOString().slice(0, 10)}`;
