// Render the checked-in SVG masters with Chromium; no network or application backend.
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '../..');
app.setPath('userData', path.join(root, '.runtime/brand-render'));
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
      console.log(item.output);
    }
    win.destroy(); app.quit();
  } catch (error) {console.error(error); app.exit(1);}
});
