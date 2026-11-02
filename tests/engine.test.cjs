const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Chess } = require('chess.js');
const { Engine, parseInfo, normalizePosition } = require('../electron/engine.cjs');
const binary = require('../electron/engine-path.cjs').enginePath();
const start = new Chess().fen();

test('parses PV and normalizes black score and bounds to white', () => {
  const info = parseInfo('info depth 12 seldepth 17 multipv 3 score cp 74 lowerbound nodes 4183 nps 8000 time 205 pv e7e5 g1f3', 'b');
  assert.deepEqual(info.score, { type: 'cp', value: -74, bound: 'upperbound' });
  assert.equal(info.rank, 3);
  assert.deepEqual(info.pv, ['e7e5', 'g1f3']);
  assert.equal(parseInfo('info string NNUE loaded'), null);
  assert.deepEqual(parseInfo('info depth 8 score mate -3 pv h8h7', 'b').score, { type: 'mate', value: 3 });
});

test('rejects command injection and mismatched history; retains valid history', () => {
  assert.throws(() => normalizePosition(start + '\nquit'));
  const game = new Chess(); game.move('e4');
  const position = normalizePosition({ fen: game.fen(), initialFen: start, moves: ['e2e4'] });
  assert.match(position.command, / moves e2e4$/);
  assert.equal(position.turn, 'b');
  assert.throws(() => normalizePosition({ fen: start, initialFen: start, moves: ['e2e4'] }));
});

test('real Stockfish returns five complete legal variations and Elo metadata', { skip: !fs.existsSync(binary), timeout: 20000 }, async () => {
  const engine = new Engine(binary);
  try {
    const meta = await engine.init();
    assert.match(meta.name, /Stockfish/);
    assert(meta.eloMin < meta.eloMax);
    let updates = 0;
    const result = await engine.analyze(start, () => updates++, { initialMs: 400, maxMs: 900, maxDepth: 12 });
    assert.equal(result.cancelled, false);
    assert.equal(result.lines.length, 5);
    assert(result.elapsedMs < 4000);
    assert(updates > 0);
    for (const variation of result.lines) {
      const board = new Chess(start);
      for (const move of variation.pv) assert(board.move({ from: move.slice(0,2), to: move.slice(2,4), ...(move[4] ? { promotion: move[4] } : {}) }));
    }
    const play = await engine.play(start, { elo: 1, movetimeMs: 100 });
    assert.equal(play.elo, meta.eloMin);
    assert(new Chess(start).move({ from: play.bestmove.slice(0,2), to: play.bestmove.slice(2,4) }));
  } finally { engine.close(); }
});

test('replacement analysis cancels stale callbacks and terminal positions have no candidates', { skip: !fs.existsSync(binary), timeout: 20000 }, async () => {
  const engine = new Engine(binary);
  try {
    await engine.init();
    let oldUpdates = 0;
    const first = engine.analyze(start, () => oldUpdates++, { initialMs: 1000 });
    const g = new Chess(); g.move('e4');
    const second = engine.analyze(g.fen(), () => {}, { initialMs: 300, maxMs: 600, maxDepth: 10 });
    const a = await first;
    const b = await second;
    assert(a.cancelled);
    assert.equal(oldUpdates, 0);
    assert.equal(b.lines.length, 5);
    const terminal = await engine.analyze('7k/6Q1/5K2/8/8/8/8/8 b - - 0 1');
    assert.equal(terminal.bestmove, null);
    assert.deepEqual(terminal.lines, []);
  } finally { engine.close(); }
});

test('active cancellation drains previous search before replacement and handles one legal move', { skip: !fs.existsSync(binary), timeout: 20000 }, async () => {
  const engine = new Engine(binary);
  try {
    await engine.init();
    let updates = 0;
    let firstUpdate;
    const observed = new Promise(resolve => firstUpdate = resolve);
    const original = engine.analyze(start, () => { updates++; firstUpdate(); }, { initialMs: 1200, maxMs: 3000 });
    await observed;
    const before = updates;
    const forced = engine.analyze('7k/8/6K1/8/8/8/7R/8 b - - 0 1', () => {}, { initialMs: 250, maxMs: 400, maxDepth: 8 });
    const previous = await original;
    const replacement = await forced;
    assert(previous.cancelled);
    assert.equal(updates, before);
    assert.equal(replacement.lines.length, 1);
    assert.equal(replacement.lines[0].pv[0], 'h8g8');
  } finally { engine.close(); }
});

test('stop during initial UCI handshake cancels work without a stale result', { skip: !fs.existsSync(binary), timeout: 20000 }, async () => {
  const engine = new Engine(binary);
  try {
    let updates = 0;
    const first = engine.analyze(start, () => updates++);
    await new Promise(resolve => setImmediate(resolve));
    await engine.stop();
    assert((await first).cancelled);
    assert.equal(updates, 0);
    const fresh = await engine.play(start, { elo: 1800, movetimeMs: 100 });
    assert.equal(fresh.cancelled, false);
    assert.match(fresh.bestmove, /^[a-h][1-8][a-h][1-8]/);
  } finally { engine.close(); }
});
