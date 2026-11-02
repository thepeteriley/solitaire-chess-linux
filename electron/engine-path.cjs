const fs = require('node:fs');
const path = require('node:path');

function enginePath(platform = process.platform, env = process.env) {
  if (platform !== 'linux') return path.join(__dirname, '..', 'resources', 'engine', 'stockfish');
  if (env.SOLITAIRE_STOCKFISH_PATH) return env.SOLITAIRE_STOCKFISH_PATH;
  return ['/usr/games/stockfish', '/usr/bin/stockfish'].find(file => fs.existsSync(file)) || '/usr/games/stockfish';
}
module.exports = { enginePath };
