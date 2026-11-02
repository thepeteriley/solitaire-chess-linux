const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { Chess } = require('chess.js');

function parseInfo(line, turn = 'w') {
  if (!line.startsWith('info ') || !/\bpv\s/.test(line)) return null;
  const depth = line.match(/\bdepth (\d+)/);
  const score = line.match(/\bscore (cp|mate) (-?\d+)(?: (lowerbound|upperbound))?/);
  const pv = line.match(/\bpv (.+)$/);
  if (!depth || !score || !pv) return null;
  const sign = turn === 'b' ? -1 : 1;
  let bound = score[3];
  if (turn === 'b' && bound) bound = bound === 'lowerbound' ? 'upperbound' : 'lowerbound';
  return {
    rank: Number(line.match(/\bmultipv (\d+)/)?.[1] || 1),
    depth: Number(depth[1]),
    score: { type: score[1], value: Number(score[2]) * sign, ...(bound ? { bound } : {}) },
    pv: pv[1].trim().split(/\s+/).filter(m => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m)),
    nodes: Number(line.match(/\bnodes (\d+)/)?.[1] || 0),
    timeMs: Number(line.match(/\btime (\d+)/)?.[1] || 0),
  };
}

function normalizePosition(position) {
  const obj = typeof position === 'string' ? { fen: position } : position;
  if (!obj || typeof obj.fen !== 'string' || /[\r\n]/.test(obj.fen)) throw new Error('A valid FEN position is required.');
  const board = new Chess(obj.fen);
  let command = `position fen ${board.fen()}`;
  if (obj.initialFen && Array.isArray(obj.moves) && obj.moves.length) {
    if (typeof obj.initialFen !== 'string' || /[\r\n]/.test(obj.initialFen)) throw new Error('Invalid starting position.');
    const history = new Chess(obj.initialFen);
    for (const move of obj.moves) {
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) throw new Error('Invalid move history.');
      history.move({ from: move.slice(0, 2), to: move.slice(2, 4), ...(move[4] ? { promotion: move[4] } : {}) });
    }
    if (history.fen().split(' ').slice(0, 4).join(' ') !== board.fen().split(' ').slice(0, 4).join(' ')) throw new Error('Move history does not match the position.');
    command = `position fen ${obj.initialFen} moves ${obj.moves.join(' ')}`;
  }
  return { fen: board.fen(), turn: board.turn(), legal: board.moves().length, command };
}

class Engine {
  constructor(binaryPath = path.join(__dirname, '..', 'resources', 'engine', 'stockfish'), options = {}) {
    this.binaryPath = binaryPath;
    this.threads = options.threads || 1;
    this.hash = options.hash || 32;
    this.proc = null;
    this.events = new EventEmitter();
    this._generation = 0;
    this._queue = Promise.resolve();
    this._initPromise = null;
    this._search = null;
    this._closed = false;
    this._metadata = { name: 'Stockfish', options: {}, eloMin: 1320, eloMax: 3190 };
  }

  metadata() { return { ...this._metadata, options: { ...this._metadata.options } }; }

  async init() {
    if (this._closed) throw new Error('Engine is closed.');
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._initialize().catch(error => {
      this._initPromise = null;
      this._destroy(error);
      throw error;
    });
    return this._initPromise;
  }

  async _initialize() {
    const proc = spawn(this.binaryPath, [], { cwd: path.dirname(this.binaryPath), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc = proc;
    let buffer = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', data => {
      buffer += data;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        this._line(line);
      }
    });
    proc.stderr.on('data', () => {});
    proc.stdin.on('error', error => this._destroy(error));
    proc.on('error', error => this._destroy(new Error(`Stockfish could not start: ${error.message}`)));
    proc.on('exit', (code, signal) => {
      if (this.proc === proc) this._destroy(new Error(`Stockfish stopped (${signal || code}).`));
    });
    const uci = this._waitFor(line => line === 'uciok', 10000);
    this._send('uci');
    await uci;
    this._send(`setoption name Threads value ${this.threads}`);
    this._send(`setoption name Hash value ${this.hash}`);
    await this._ready();
    return this.metadata();
  }

  _line(line) {
    if (line.startsWith('id name ')) this._metadata.name = line.slice(8);
    if (line.startsWith('option name ')) {
      const m = line.match(/^option name (.+?) type (\w+)(.*)$/);
      if (m) {
        const min = m[3].match(/\bmin (-?\d+)/);
        const max = m[3].match(/\bmax (-?\d+)/);
        this._metadata.options[m[1]] = { type: m[2], ...(min ? { min: Number(min[1]) } : {}), ...(max ? { max: Number(max[1]) } : {}) };
        if (m[1] === 'UCI_Elo') { this._metadata.eloMin = Number(min?.[1] || 1320); this._metadata.eloMax = Number(max?.[1] || 3190); }
      }
    }
    this.events.emit('line', line);
    if (this._search) this._search.onLine(line);
  }

  _send(command) {
    if (!this.proc || !this.proc.stdin.writable) throw new Error('Stockfish is not running.');
    this.proc.stdin.write(command + '\n');
  }

  _waitFor(predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.events.off('line', onLine); this.events.off('failure', onFail); };
      const onLine = line => { if (predicate(line)) { cleanup(); resolve(line); } };
      const onFail = error => { cleanup(); reject(error); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Stockfish did not respond in time.')); }, timeoutMs);
      this.events.on('line', onLine);
      this.events.on('failure', onFail);
    });
  }

  async _ready() { const ready = this._waitFor(line => line === 'readyok', 10000); this._send('isready'); await ready; }

  _destroy(error = new Error('Stockfish stopped.')) {
    const proc = this.proc;
    this.proc = null;
    this._initPromise = null;
    if (proc && !proc.killed) proc.kill();
    this.events.emit('failure', error);
    if (this._search) this._search.fail(error);
  }

  _cancelActive() {
    if (this._search && !this._search.stopping) {
      this._search.stopping = true;
      this._send('stop');
      this._search.cancelTimer = setTimeout(() => this._destroy(new Error('Stockfish did not stop in time.')), 2000);
    }
  }

  stop() {
    this._generation++;
    this._cancelActive();
    return this._queue.catch(() => {});
  }

  analyze(position, onUpdate = () => {}, options = {}) {
    const normalized = normalizePosition(position);
    return this._schedule(normalized, onUpdate, { ...options, mode: 'analysis' });
  }

  play(position, options = {}) {
    const normalized = normalizePosition(position);
    return this._schedule(normalized, () => {}, { ...options, mode: 'play' });
  }

  _schedule(position, onUpdate, options) {
    const generation = ++this._generation;
    this._cancelActive();
    const task = this._queue.catch(() => {}).then(async () => {
      if (generation !== this._generation || this._closed) return { cancelled: true, lines: [], bestmove: null };
      await this.init();
      if (generation !== this._generation || this._closed) return { cancelled: true, lines: [], bestmove: null };
      if (!position.legal) return { lines: [], bestmove: null, depth: 0, elapsedMs: 0, extended: false, cancelled: false };
      const playing = options.mode === 'play';
      const requestedElo = Number(options.elo ?? 1500);
      const elo = Math.round(Math.max(this._metadata.eloMin, Math.min(this._metadata.eloMax, Number.isFinite(requestedElo) ? requestedElo : 1500)));
      this._send(`setoption name MultiPV value ${playing ? 1 : Math.min(5, position.legal)}`);
      this._send(`setoption name UCI_LimitStrength value ${playing ? 'true' : 'false'}`);
      if (playing) this._send(`setoption name UCI_Elo value ${elo}`);
      this._send('setoption name Skill Level value 20');
      await this._ready();
      if (generation !== this._generation || this._closed) return { cancelled: true, lines: [], bestmove: null };
      return this._run(position, onUpdate, { ...options, elo }, generation);
    });
    this._queue = task;
    return task;
  }

  _run(position, onUpdate, options, generation) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const playing = options.mode === 'play';
      const expected = playing ? 1 : Math.min(5, position.legal);
      const byDepth = new Map();
      const observations = [];
      let lines = [], depth = 0, extended = false, lastEmit = 0;
      const timers = [];
      let search;
      const result = bestmove => ({ lines, bestmove, depth, elapsedMs: Date.now() - start, extended, cancelled: generation !== this._generation, ...(playing ? { elo: options.elo } : {}) });
      const cleanup = () => { timers.forEach(clearTimeout); if (search.cancelTimer) clearTimeout(search.cancelTimer); if (this._search === search) this._search = null; };
      const emit = () => {
        if (generation !== this._generation) return;
        try { onUpdate(result(null)); } catch (_) { /* UI callbacks must not strand an engine search. */ }
      };
      search = {
        stopping: false,
        fail: error => { cleanup(); reject(error); },
        onLine: line => {
          if (line.startsWith('bestmove ')) {
            const move = line.split(/\s+/)[1];
            const bestmove = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move) ? move : null;
            const final = result(bestmove);
            cleanup();
            if (generation === this._generation) { try { onUpdate(final); } catch (_) {} }
            resolve(final);
            return;
          }
          const parsed = parseInfo(line, position.turn);
          if (!parsed || !parsed.pv.length || parsed.rank > expected) return;
          if (!byDepth.has(parsed.depth)) byDepth.set(parsed.depth, new Map());
          const group = byDepth.get(parsed.depth);
          group.set(parsed.rank, parsed);
          if (group.size === expected && parsed.depth >= depth) {
            lines = [...group.values()].sort((a, b) => a.rank - b.rank);
            depth = parsed.depth;
            const best = lines[0];
            observations.push({ at: Date.now(), depth, move: best.pv[0], value: best.score.type === 'cp' ? best.score.value : Math.sign(best.score.value || 1) * 100000 });
            if (Date.now() - lastEmit > 75) { lastEmit = Date.now(); emit(); }
          }
        },
      };
      this._search = search;
      this._send(position.command);
      const moveTime = Math.max(100, Math.min(3000, Number(options.movetimeMs) || 600));
      this._send(playing ? `go movetime ${moveTime}` : `go depth ${Math.max(6, Math.min(18, Number(options.maxDepth) || 18))}`);
      if (!playing) {
        const initialMs = Math.max(250, Math.min(1500, Number(options.initialMs) || 1200));
        const maxMs = Math.max(initialMs, Math.min(4000, Number(options.maxMs) || 3000));
        timers.push(setTimeout(() => {
          if (this._search !== search || search.stopping) return;
          const recent = observations.filter(x => x.depth >= 7 && x.at >= Date.now() - 850);
          const unstable = recent.length < 2 || recent.some(x => x.move !== recent[0].move || Math.abs(x.value - recent[0].value) >= 65);
          if (unstable && maxMs > initialMs) { extended = true; emit(); }
          else { search.stopping = true; this._send('stop'); }
        }, initialMs));
        timers.push(setTimeout(() => { if (this._search === search && !search.stopping) { search.stopping = true; this._send('stop'); } }, maxMs));
        timers.push(setTimeout(() => { if (this._search === search) this._destroy(new Error('Stockfish analysis exceeded its time limit.')); }, maxMs + 2500));
      } else {
        timers.push(setTimeout(() => { if (this._search === search) this._cancelActive(); }, moveTime + 1000));
      }
    });
  }

  close() {
    this._generation++;
    this._closed = true;
    this._destroy(new Error('Engine closed.'));
  }
}

module.exports = { Engine, parseInfo, normalizePosition };
