// Project-local generated files live outside the source and user case folders.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

function runtimeFile(name, root = ROOT) {
  const directory = path.join(root, '.runtime');
  fs.mkdirSync(directory, {recursive: true});
  return path.join(directory, name);
}

function artifactFile(kind, name, root = ROOT) {
  const directory = path.join(root, 'artifacts', kind);
  fs.mkdirSync(directory, {recursive: true});
  return path.join(directory, name);
}

module.exports = {ROOT, runtimeFile, artifactFile};
