// A separate Electron profile keeps UI smoke tests away from the user's session.
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {ROOT} = require('../electron/paths.cjs');
const electron = require('electron');
const started = Date.now();
const result = spawnSync(electron, [ROOT, '--disable-mcp'], {
  cwd: ROOT,
  env: {...process.env, ECHO_TEST_SMOKE_TEST: '1'},
  stdio: 'inherit',
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
try {
  function read(name) {
    const file = path.join(ROOT, 'artifacts', 'smoke', name);
    assert.ok(fs.statSync(file).mtimeMs >= started - 1000, `${name} was not regenerated`);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(data.errors, [], `${name} contains UI errors`);
    return data;
  }
  assert.equal(read('electron-smoke.json').ready, true);
  const interaction = read('electron-interaction.json');
  for (const name of ['localCasesVisible', 'localCaseOpened', 'caseSearch', 'added', 'selectorDialog', 'recordButton', 'converted']) {
    assert.equal(interaction[name], true, `${name} failed`);
  }
  const toolbar = read('game-window-smoke.json');
  for (const name of ['ready', 'recordButton', 'disabled', 'distinct', 'logsWithoutConnection']) {
    assert.equal(toolbar[name], true, `${name} failed`);
  }
  assert.equal(toolbar.parent, null);
  assert.equal(toolbar.alwaysOnTop, false);
  assert.equal(read('game-run-smoke.json').passed, true);
  assert.equal(read('sidebar-smoke.json').passed,true);
  const connectionFile = path.join(ROOT, 'artifacts', 'smoke', 'connection-smoke.json');
  assert.ok(fs.statSync(connectionFile).mtimeMs >= started - 1000);
  assert.equal(JSON.parse(fs.readFileSync(connectionFile, 'utf8')).passed, true);
  const recordingFile=path.join(ROOT,'artifacts','smoke','recording-smoke.json');
  assert.ok(fs.statSync(recordingFile).mtimeMs>=started-1000);
  assert.equal(JSON.parse(fs.readFileSync(recordingFile,'utf8')).passed,true);
  assert.equal(read('replay-smoke.json').passed,true);
  assert.equal(read('script-smoke.json').passed,true);
  assert.equal(read('recognition-smoke.json').passed,true);
  assert.equal(read('help-smoke.json').passed,true);
  assert.equal(read('shared-controls-smoke.json').passed,true);
  assert.equal(read('control-picker-smoke.json').passed,true);
  assert.equal(read('control-library-responsive-smoke.json').passed,true);
  assert.equal(read('modal-buttons-smoke.json').passed,true);
  assert.equal(read('window-search-smoke.json').passed,true);
  console.log('UI smoke passed. Results: artifacts/smoke');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
