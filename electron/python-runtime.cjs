const fs = require('node:fs');
const path = require('node:path');

function resolvePython(env = process.env, exists = fs.existsSync, root = path.resolve(__dirname, '..')) {
  if (env.NYCS_PYTHON) return env.NYCS_PYTHON;
  const bundled = path.join(root, 'runtime', 'python', 'python.exe');
  if (exists(bundled)) return bundled;
  const local = env.LOCALAPPDATA || '';
  // The installer and desktop service must use the same interpreter.
  const candidates = ['Python311','Python314','Python313','Python312'].map(name =>
    path.join(local, 'Programs', 'Python', name, 'python.exe'));
  return candidates.find(exists) || 'python';
}
module.exports = {resolvePython};
