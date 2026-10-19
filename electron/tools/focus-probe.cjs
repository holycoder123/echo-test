// Optional live diagnostic: activate/capture/listen only, never replay input.
// Run: electron electron/tools/focus-probe.cjs <selected-game-handle>
const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {PythonBridge} = require('../bridge.cjs');
const {GameHandoff, grantForeground} = require('../handoff.cjs');
const {ROOT:root, artifactFile}=require('../paths.cjs');
app.setPath('userData', path.join(app.getPath('temp'), 'echo-test-focus-probe'));
app.whenReady().then(async () => {
  const python = process.env.ECHO_TEST_PYTHON || path.join(process.env.LOCALAPPDATA, 'Programs/Python/Python313-32/python.exe');
  const bridge = new PythonBridge(python, ['-u','-m','echo_test.service'], {cwd: root, env:{...process.env,PYTHONUTF8:'1'}});
  const window = new BrowserWindow({width:600,height:240,title:'测试工作台 · 焦点验证',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  const result = {grants:[],capture:null,recording:null};
  const handoff = new GameHandoff(window, async () => {
    const grant = await grantForeground(bridge, root); result.grants.push(grant); return grant;
  });
  try {
    await window.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<h2>正在验证目标窗口切换</h2><p>仅激活、截图和短暂监听，不发送目标应用操作。</p>'));
    window.show(); window.focus();
    await new Promise(resolve=>setTimeout(resolve,500));
    const data = await bridge.call('bootstrap');
    const game = data.windows.find(w=>w.handle===Number(process.argv[2]));
    if (!game) throw new Error('请提供当前目标窗口句柄');
    try {
      const shot = await handoff.call(()=>bridge.call('capture',{handle:game.handle}));
      result.capture={ok:true,width:shot.width,height:shot.height};
    } catch(error) {result.capture={ok:false,error:error.message};}
    await new Promise(resolve=>setTimeout(resolve,300));
    try {
      await handoff.call(()=>bridge.call('record_start',{handle:game.handle}),true);
      await new Promise(resolve=>setTimeout(resolve,250));
      const recorded=await bridge.call('record_stop');
      result.recording={ok:true,count:recorded.raw_count};
      handoff.restore();
    } catch(error) {result.recording={ok:false,error:error.message};}
    // The initial probe launch may be behind another app. After the user's test
    // window has regained foreground, verify the screenshot handoff separately.
    if (!result.capture.ok && result.recording.ok) {
      result.initialCapture = result.capture;
      await new Promise(resolve=>setTimeout(resolve,300));
      try {
        const shot=await handoff.call(()=>bridge.call('capture',{handle:game.handle}));
        result.capture={ok:true,width:shot.width,height:shot.height};
      } catch(error) {result.capture={ok:false,error:error.message};}
    }
  } catch(error) {result.error=error.message;}
  finally {
    fs.writeFileSync(artifactFile('probes','focus-probe.json'),JSON.stringify(result,null,2));
    await bridge.shutdown(); window.destroy(); app.quit();
  }
});
