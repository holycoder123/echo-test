// Render the checked-in SVG masters with Chromium; no network or application backend.
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '../..');
const profile = path.join(root, '.runtime/brand-render');
const reportFile = path.join(profile, 'export-result.json');
const outputs = [];
function report(status, error) {
  fs.mkdirSync(profile, {recursive:true});
  fs.writeFileSync(reportFile, JSON.stringify({status, outputs, ...(error ? {error:String(error.stack || error)} : {})}, null, 2));
}
function fail(error) {
  // This is a background build tool: leave diagnostics instead of Electron's
  // uncaught-exception dialog, which can trap unattended GUI processes.
  try { report('failed', error); } catch {}
  app.exit(1);
}
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
for (const stream of [process.stdout, process.stderr]) {
  stream?.on('error', error => {
    if (error.code !== 'EPIPE' && error.code !== 'EOF') fail(error);
  });
}
report('running');
app.setPath('userData', profile);
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/brand/exports.json'), 'utf8'));
  const win = new BrowserWindow({show:false, transparent:true, frame:false,
    webPreferences:{offscreen:true, contextIsolation:true, nodeIntegration:false, sandbox:true}});
  try {
    for (const item of manifest) {
      win.setContentSize(item.width, item.height);
      await win.loadURL(pathToFileURL(path.join(root, item.source)).href);
      await win.webContents.executeJavaScript(`document.documentElement.setAttribute('width', ${item.width});document.documentElement.setAttribute('height', ${item.height});new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
      const png = await win.webContents.capturePage({x:0, y:0, width:item.width, height:item.height});
      fs.mkdirSync(path.dirname(path.join(root, item.output)), {recursive:true});
      fs.writeFileSync(path.join(root, item.output), png.toPNG());
      outputs.push(item.output);
    }
    report('complete');
    win.destroy(); app.quit();
  } catch (error) {fail(error);}
}).catch(fail);
