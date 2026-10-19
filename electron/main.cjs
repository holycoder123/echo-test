const {app, BrowserWindow, ipcMain, dialog, protocol, net, shell, globalShortcut, Tray, Menu, screen} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const {pathToFileURL} = require('node:url');
const {PythonBridge} = require('./bridge.cjs');
const {GameHandoff, grantForeground} = require('./handoff.cjs');
const {RunState}=require('./run-state.cjs');
const {McpAutomation}=require('./automation.cjs');
const {StartGate}=require('./start-gate.cjs');
const startGate=new StartGate();
const runState=new RunState();
let currentCaseName='当前编辑用例';
let automation,mcpServer,backendAdmin=false;
let editRevision=0;
const mcpEnabled=!process.argv.includes('--disable-mcp');
const mcpStartupSmoke=process.argv.includes('--mcp-startup-smoke');
const {authorize}=require('./window-access.cjs');

const {ROOT, runtimeFile, artifactFile} = require('./paths.cjs');
const RENDERER = path.join(__dirname, 'renderer');
app.setName('echo test');
app.setPath('userData',path.join(app.getPath('appData'),'echo-test'));
const gameSmoke=process.argv.includes('--game-smoke');
if (process.env.ECHO_TEST_SMOKE_TEST === '1' || gameSmoke) app.setPath('userData', path.join(app.getPath('temp'), gameSmoke?'echo-test-game-smoke':'echo-test-smoke-'+process.pid));
if(mcpStartupSmoke)app.setPath('userData',path.join(app.getPath('temp'),'echo-test-mcp-startup-smoke'));
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
if (primaryInstance) {
  try {
    const outcome=require('./elevation.cjs').ensureAdministrator({
      executable:process.execPath,argv:process.argv.slice(1),cwd:ROOT,
      releaseLock:()=>app.releaseSingleInstanceLock(),
    });
    if(outcome==='relaunched')app.exit(0);
  } catch(error) {
    dialog.showErrorBox('管理员启动未完成',error.message);
    app.exit(1);
  }
}
protocol.registerSchemesAsPrivileged([{scheme: 'echo-test', privileges: {standard: true, secure: true, supportFetchAPI: true}}]);
let window, bridge, handoff, currentPath, busy = '', dirty = false, closing = false;
let recent = [];
const knownCases=new Set();
const CASES=path.join(ROOT,'test_cases');
const {defaultCasePath}=require('./case-path.cjs');
let tray;
let gameWindow,gameLoaded,gameClosing=false;
let toolbarLinked=false,toolbarLinkWanted=true;
let recordStart=0,recordCount=0,recordPending=false;
let continuousRole='';
let selectedGame=null,connectingGame=false;
const {AuditLog}=require('./audit.cjs');
let audit,recordStarting=false;
const critical=new Set(['bootstrap','game_connect','game_disconnect','game_focus','capture','save_template','import_template','preview','run','stop','record_start','record_stop','record_reviewed','save_project','load_project','open_project','open_recent','open_case','case_list','game_action','game_open','shutdown']);
function auditContext(){return {handle:selectedGame?.handle,busy,recordStarting,recordPending,recordCount};}
function auditWrite(level,operation,stage,details={}){try{return audit?.write(level,operation,stage,{context:auditContext(),...details});}catch(error){console.error('[Audit write failed]',error.message);send({kind:'notice',message:'错误日志写入失败：'+error.message});}}
function auditError(operation,error,details={},throttle=false){try{return audit?.error(operation,error,{context:auditContext(),...details},throttle);}catch(failure){console.error('[Audit write failed]',failure.message);send({kind:'notice',message:'错误日志写入失败：'+failure.message});}}
function errorMessage(error){return `${error.message}${error.auditId?` [日志 #${error.auditId}]`:''}`;}

function publishConnection(){send({kind:'game_connection',connection:selectedGame});sendGameState();}
function gameState(){return {connection:selectedGame,toolbarLinked,busy,recordStart,recordCount,recordPending,recordStarting,run:runState.snapshot(),caseName:currentCaseName,casePath:currentPath};}
function publishRun(){send({kind:'run_state',run:runState.snapshot()});sendGameState();}
function sendGameState(){
  if(automation)send({kind:'workbench_state',busy,recordStarting,mcpOperation:automation.active||''});
  if(gameWindow&&!gameWindow.isDestroyed())gameWindow.webContents.send('studio:event',{kind:'game_state',...gameState()});
}
function nativeHandle(win){const bytes=win.getNativeWindowHandle();return bytes.length===8?Number(bytes.readBigUInt64LE()):bytes.readUInt32LE();}
function secureWindow(win){
  win.webContents.on('render-process-gone',(_event,details)=>{auditError('renderer.crash',new Error(details.reason),{exitCode:details.exitCode});send({kind:'notice',message:'界面进程异常退出，详情已写入错误日志。'});});
  win.on('unresponsive',()=>auditError('window.unresponsive',new Error('窗口无响应')));
  win.webContents.on('did-fail-load',(_event,code,message,url,isMainFrame)=>{if(isMainFrame&&code!==-3)auditError('renderer.load',new Error(message),{code,url});});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
}
async function unlinkToolbar(){
  await bridge.call('toolbar_pair_detach');toolbarLinked=false;
  if(gameWindow&&!gameWindow.isDestroyed())gameWindow.setSkipTaskbar(false);
}
async function linkToolbar(){
  if(!selectedGame||!gameWindow||gameWindow.isDestroyed())return;
  if(!toolbarLinked)gameWindow.setBounds(gameToolbarBounds());
  const result=await bridge.call('toolbar_pair_attach',{handle:selectedGame.handle,game_pid:selectedGame.pid,toolbar:nativeHandle(gameWindow),toolbar_pid:process.pid});
  toolbarLinked=Boolean(result.linked);gameWindow.setSkipTaskbar(toolbarLinked);
  if(!result.fits)send({kind:'notice',level:'warning',message:'当前屏幕无法同时容纳目标应用和工具栏，可拖动窗口组到更大的屏幕或点击解绑。'});
}
function gameToolbarBounds(){
  const bounds=selectedGame?.window_bounds||selectedGame?.bounds;
  const physical=bounds?{x:bounds[0],y:bounds[1],width:bounds[2],height:bounds[3]}:null;
  const game=physical?screen.screenToDipRect(null,physical):{x:100,y:100,width:1040,height:730};
  const work=screen.getDisplayMatching(game).workArea;
  return require('./toolbar-layout.cjs').toolbarBounds(game,work);
}
async function openGameWindow(){
  if(!gameWindow||gameWindow.isDestroyed()){
    gameClosing=false;
    const initialBounds=gameToolbarBounds();
    gameWindow=new BrowserWindow({...initialBounds,minWidth:300,minHeight:Math.min(600,initialBounds.height),show:false,
      resizable:true,maximizable:false,fullscreenable:false,skipTaskbar:false,alwaysOnTop:false,
      backgroundColor:'#f8f8f9',title:'echo test · 窗口工具栏',icon:path.join(__dirname,'assets/studio.png'),
      titleBarStyle:'hidden',titleBarOverlay:{color:'#f8f8f9',symbolColor:'#55585e',height:42},
      webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}});
    gameWindow.setMenuBarVisibility(false);secureWindow(gameWindow);
    const current=gameWindow;
    current.once('closed',()=>{if(gameWindow===current){gameWindow=null;gameLoaded=null;toolbarLinked=false;}});
    current.on('close',event=>{
      if(closing)return;
      event.preventDefault();if(gameClosing)return;
      if(busy==='running'){send({kind:'notice',message:'请先停止用例，再关闭工具栏。'});return;}
      gameClosing=true;
      (async()=>{if(busy==='recording')await bridge.call('stop');await unlinkToolbar();current.destroy();})()
        .catch(error=>{gameClosing=false;send({kind:'notice',message:error.message});});
    });
    gameLoaded=current.loadURL('echo-test://studio/game.html');
  }
  await gameLoaded;
  if(selectedGame&&toolbarLinkWanted&&!toolbarLinked){
    try{await linkToolbar();}catch(error){auditError('toolbar.pair',error);send({kind:'notice',message:'工具栏捆绑失败：'+errorMessage(error)});}
  }
  if(toolbarLinked)await bridge.call('toolbar_pair_show');
  if(gameWindow.isMinimized())gameWindow.restore();
  gameWindow.show();gameWindow.focus();sendGameState();
  return gameState();
}

async function connectSelectedGame(handle){
  if(busy)throw new Error('请先停止录制或执行');
  if(connectingGame)throw new Error('正在连接目标应用，请稍候');
  connectingGame=true;
  try{
    await detachGame();
    selectedGame=await bridge.call('game_info',{handle});
    publishConnection();await openGameWindow();
    return {connection:selectedGame};
  }finally{connectingGame=false;}
}

async function detachGame(){
  await unlinkToolbar();selectedGame=null;
  publishConnection();return {connection:null};
}

function showWorkbench() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.setSkipTaskbar(false);
  window.show();
  window.focus();
}

function send(event) {
  if (window && !window.isDestroyed()) window.webContents.send('studio:event', event);
  if(['notice','service_error','record_error','run_error'].includes(event.kind)&&gameWindow&&!gameWindow.isDestroyed())gameWindow.webContents.send('studio:event',event);
}
async function caseList(){
  const data=await bridge.call('case_list',{known:[...knownCases,...recent,currentPath].filter(Boolean)});
  for(const entry of data.entries)if(entry.error)auditError('case_library.read',new Error(entry.error),{file:entry.path},true);
  return data;
}
function remember(file) {
  knownCases.add(path.resolve(file));
  try{fs.writeFileSync(path.join(app.getPath('userData'),'case-library.json'),JSON.stringify([...knownCases]));}catch(error){auditError('case_library.save',error);}
  recent = [file, ...recent.filter(p => p !== file)].slice(0, 8);
  try { fs.writeFileSync(path.join(app.getPath('userData'), 'recent.json'), JSON.stringify(recent)); } catch(error){auditError('recent.save',error);}
}
function registerStop() {
  globalShortcut.unregister('F12');
  if ((busy||['echo_test_run_case','echo_test_record_start'].includes(automation?.active)) && !globalShortcut.register('F12', () => stopCurrent().catch(error => send({kind: 'notice', message: error.message})))) {
    auditWrite('warning','stop.shortcut','unavailable',{message:'F12 快捷键被占用，请使用停止按钮'});
    send({kind: 'notice',level:'warning', message: 'F12 快捷键被占用，请使用停止按钮'});
  }
}
function receive(event) {
  automation?.receive(event);
  if(['toolbar_pair_error','toolbar_pair_closed'].includes(event.kind)){
    toolbarLinked=false;
    if(gameWindow&&!gameWindow.isDestroyed())gameWindow.setSkipTaskbar(false);
    if(event.kind==='toolbar_pair_error'){auditError('toolbar.pair',new Error(event.message));send({kind:'notice',message:'工具栏捆绑已中断：'+event.message});}
    else if(event.game_closed&&selectedGame?.handle===event.handle){
      selectedGame=null;publishConnection();if(busy)stopCurrent().catch(error=>auditError('toolbar.pair.stop',error));
    }
  }
  if(event.kind==='step')runState.step(event);
  if(event.kind==='finished')runState.finish(event.result,event.directory);
  if(['run_error','service_error'].includes(event.kind))runState.fail(event.message);
  if(['step','finished','run_error','service_error'].includes(event.kind))publishRun();
  if(['record_error','run_error'].includes(event.kind)){
    const error=new Error(event.message);error.backendTrace=event.traceback;
    auditError(event.kind,error);event={...event,message:errorMessage(error),auditId:error.auditId};
  }
  if(event.kind==='step'&&event.status==='failed')auditError('run.step',new Error(event.message||event.error||'测试步骤失败'),{stepIndex:event.index});
  if(event.kind==='record_started')auditWrite('info','record','listening',{diagnostics:event.diagnostics});
  if(event.kind==='record_stopped'){
    if(!event.raw_count)event={...event,hint:require('./recording-health.cjs').recordingHint(event.diagnostics)};
    auditWrite(event.raw_count?'info':'warning','record','stopped',{diagnostics:event.diagnostics,rawCount:event.raw_count,duration:event.duration,stepCount:event.project?.steps?.length,message:event.raw_count?'录制已保存':event.hint});
    if(!event.raw_count)send({kind:'notice',level:'warning',message:event.hint});
  }

  if (event.kind === 'record_started') { recordStarting=false; busy = 'recording';recordStart=Date.now();recordCount=0; registerStop(); }
  if(event.kind==='record_event')recordCount=event.count;
  if(event.kind==='record_stopped')recordPending=true;
  if (['record_stopped', 'record_error', 'finished', 'run_error'].includes(event.kind)) {
    const keepGameForeground=continuousRole==='mcp'&&event.kind==='finished'&&event.result?.status==='passed';
    continuousRole='';
    busy = ''; recordStarting=false; registerStop();
    if (!keepGameForeground&&window?.isMinimized()) window.restore();
    if (event.kind==='record_stopped')showWorkbench();
  }
  send(event);
  sendGameState();
}
function createBridge() {
  const python = require('./python-runtime.cjs').resolvePython();
  bridge = new PythonBridge(python, ['-X', 'utf8', '-u', '-m', 'echo_test.service'], {
    cwd: ROOT, env: {...process.env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1', ECHO_TEST_HOST_PID:String(process.pid),
      ...((process.env.ECHO_TEST_SMOKE_TEST === '1' || gameSmoke || mcpStartupSmoke) ? {ECHO_TEST_CONTROL_LIBRARY_ROOT:path.join(app.getPath('userData'),'control-data')} : {}),
      ECHO_TEST_EMBED_RECOVERY:gameSmoke?path.join(app.getPath('userData'),'.embed-recovery.json'):runtimeFile('embed-recovery.json')}
  });
  bridge.on('event', receive);
  bridge.audit=(stage,method,details,error)=>{
    if(stage==='error')auditError(method,error,{source:'python',...details},false);
    else if(critical.has(method))auditWrite('info',method,stage,{source:'python',...details});
  };
  bridge.on('diagnostic', message => {console.error('[Python]',message.trim());auditWrite('error','python.stderr','diagnostic',{message:message.trim()});});
  bridge.on('unavailable', message => {auditError('python.service',new Error(message));busy = '';continuousRole='';recordStarting=false;runState.fail(message);publishRun(); registerStop(); handoff?.restore(); send({kind: 'service_error', message});sendGameState();});
}

async function studioCall(event, method, args = {}) {
  const role=authorize(event,window,gameWindow,method,args);
  if(automation?.active&&!['dirty','stop','record_stop','game_state','audit_list','control_list','renderer_error'].includes(method))throw new Error('MCP 正在操作工作台，请稍候');
  return dispatchStudioCall(role,method,args);
}
function stopCurrent(method='stop'){
  automation?.cancelStart();
  startGate.cancel();
  return bridge.call(method);
}
async function dispatchStudioCall(role, method, args = {}) {
  if(['stop','record_stop'].includes(method))return stopCurrent(method);
  if(method==='renderer_error'){
    const error=new Error(String(args.message||'未知界面错误').slice(0,4000));error.stack=String(args.stack||'').slice(0,12000);
    const existing=error.message.match(/\[日志 #([^\]]+)\]/)?.[1];
    if(existing)error.auditId=existing;else auditError('renderer.'+role,error,{action:String(args.action||'').slice(0,100)});
    if(['game-pick-coordinate','game-pick-image','run'].includes(args.action))send({kind:'notice',message:existing?error.message:errorMessage(error),level:'error'});
    return {id:error.auditId};
  }
  if(method==='audit_delete'){if(busy||recordStarting)throw new Error('请先停止录制或执行再删除日志');return audit.delete(args.ids);}
  if(method==='reports_delete'){
    if(busy||recordStarting)throw new Error('请先停止录制或执行再删除报告');
    const result=await bridge.call(method,args);
    if(runState.value&&result.ids.includes(runState.value.reportId)){runState.value.reportId=null;publishRun();}
    return result;
  }
  if(method==='audit_list')return {entries:audit.read(args),directory:audit.directory};
  if(method==='audit_folder'){const error=await shell.openPath(audit.directory);if(error)throw new Error(error);return {};}
  if(method==='audit_export'){
    const result=await dialog.showSaveDialog(window,{title:'导出错误日志',defaultPath:path.join(app.getPath('documents'),'echo test 诊断日志.jsonl'),filters:[{name:'诊断日志',extensions:['jsonl']}]});
    if(result.canceled)return null;
    fs.writeFileSync(result.filePath,audit.read({limit:1000}).reverse().map(row=>JSON.stringify(row)).join('\n')+'\n','utf8');return {path:result.filePath};
  }
  if(method==='case_list')return caseList();
  if(method==='case_folder'){const error=await shell.openPath(CASES);if(error)throw new Error(error);return {};}
  if(method==='game_state')return gameState();
  if(method==='game_bundle'){
    if(typeof args.linked!=='boolean')throw new Error('无效的工具栏捆绑状态');
    if(busy)throw new Error('请先停止录制或执行再调整捆绑');
    if(!selectedGame)throw new Error('请先连接目标窗口');
    if(args.linked)await linkToolbar();else await unlinkToolbar();
    toolbarLinkWanted=args.linked;sendGameState();return gameState();
  }
  if(method==='game_open')return openGameWindow();
  if(method==='workbench_show'){showWorkbench();return {};}
  if(method==='record_reviewed'){recordPending=false;sendGameState();return {};}
  if(method==='game_action'){
    if(!['game-pick-coordinate','game-pick-image','run','view-record','view-diagnostics','view-help'].includes(args.action))throw new Error('不支持的目标窗口操作');
    const readOnly=['view-diagnostics','view-help'].includes(args.action);
    if(busy&&!readOnly)throw new Error('请先停止录制或执行');
    if(!selectedGame&&!readOnly)throw new Error('请先连接目标应用');
    if(['view-record','view-diagnostics','view-help'].includes(args.action))showWorkbench();
    if(args.action==='run'){
      if(args.casePath!=null&&typeof args.casePath!=='string')throw new Error('无效的用例路径');
      if(args.casePath){const entry=(await caseList()).entries.find(item=>item.path.toLowerCase()===path.resolve(args.casePath).toLowerCase());if(!entry||entry.error)throw new Error('用例无法运行，请刷新用例列表');}
    }
    send({kind:'game_action',action:args.action,casePath:args.casePath||'',iterations:args.iterations});return {};
  }
  if(role==='game'&&['record_start','game_focus'].includes(method)){
    if(!selectedGame||Number(args.handle)!==selectedGame.handle)throw new Error('请先连接所选目标应用');
  }
  if (method === 'dirty') { dirty = Boolean(args.value);if(dirty)editRevision++;if(typeof args.caseName==='string')currentCaseName=args.caseName;sendGameState(); return {}; }
  if (method === 'game_focus') {
    if(!selectedGame||selectedGame.handle!==Number(args.handle))throw new Error('请先连接所选目标应用');
    await openGameWindow();await grantForeground(bridge,ROOT);
    return bridge.call('game_focus',args);
  }
  if (method === 'game_connect')return connectSelectedGame(args.handle);
  if (method === 'game_disconnect') {
    if (busy) throw new Error('请先停止录制或执行');
    return detachGame();
  }
  if (method === 'bootstrap') {
    const gameIndex=process.argv.indexOf('--game');
    const preferredHandle=gameIndex>=0?Number(process.argv[gameIndex+1]):null;
    const data = await bridge.call('bootstrap',{preferred_handle:preferredHandle});
    currentPath = data.path;
    currentCaseName=data.project.name;sendGameState();
    return {...data, recent,library:await caseList(), autoConnect:gameIndex>=0&&process.env.ECHO_TEST_SMOKE_TEST !== '1'&&!mcpStartupSmoke, preferredHandle:gameIndex>=0?Number(process.argv[gameIndex+1]):null};
  }
  if(method==='windows'){
    const data=await bridge.call(method);
    auditWrite('info','game.windows','discovered',{count:data.windows.length,handles:data.windows.map(item=>item.handle),connectedHandle:selectedGame?.handle||null});
    return data;
  }
  if (['open_project','open_recent','open_case'].includes(method)) {
    if (busy) throw new Error('请先停止录制或执行');
    let file;
    if(method==='open_case'){
      if(typeof args.path!=='string')throw new Error('无效的用例路径');
      const entry=(await caseList()).entries.find(item=>item.path.toLowerCase()===path.resolve(args.path).toLowerCase());
      if(!entry)throw new Error('用例文件不存在，请刷新本地用例列表');
      if(entry.error)throw new Error('用例无法打开：'+entry.error);
      file=entry.path;
    } else if (method === 'open_recent') {
      file = recent[args.index];
      if (!file) throw new Error('最近用例不存在');
    } else {
      const result = await dialog.showOpenDialog(window, {title: '打开测试用例',defaultPath:CASES, properties: ['openFile'], filters: [{name: 'echo test 用例', extensions: ['json']}]});
      if (result.canceled) return null;
      file = result.filePaths[0];
    }
    const data = await bridge.call('load_project', {path: file});
    currentPath = data.path; remember(file); dirty = false;
    currentCaseName=data.project.name;sendGameState();
    return {...data, recent,library:await caseList()};
  }
  if (method === 'new_project') {const data = await bridge.call(method); currentPath = null; dirty = false;currentCaseName=data.project.name;sendGameState(); return data;}
  if (method === 'save_project') {
    if (busy) throw new Error('请先停止录制或执行');
    let file = currentPath;
    if (!file || args.as_new) {
      const result = await dialog.showSaveDialog(window, {title: '保存测试用例', defaultPath: !args.as_new&&file?file:defaultCasePath(CASES,args.project?.name), filters: [{name: 'echo test 用例', extensions: ['echo.json']}]});
      if (result.canceled) return null;
      file = result.filePath;
    }
    const data = await bridge.call('save_project', {path: file, project: args.project});
    currentPath = data.path; remember(file); dirty = false;
    currentCaseName=data.project.name;sendGameState();
    return {...data, recent,library:await caseList()};
  }
  if (method === 'script_import') {
    if(busy)throw new Error('请先停止录制或执行');
    const result=await dialog.showOpenDialog(window,{title:'导入 Python 脚本',properties:['openFile'],filters:[{name:'Python 脚本',extensions:['py']}]});
    if(result.canceled)return null;
    return bridge.call('script_import',{path:result.filePaths[0]});
  }
  if (method === 'import_template') {
    const result = await dialog.showOpenDialog(window, {title: '导入控件模板', properties: ['openFile'], filters: [{name: '图片', extensions: ['png', 'jpg', 'jpeg', 'bmp']}]});
    if (result.canceled) return null;
    return bridge.call(method, {path: result.filePaths[0]});
  }
  if (method === 'open_report') {
    if (typeof args.id !== 'string' || !/^[a-zA-Z0-9_]+$/.test(args.id)) throw new Error('无效的报告编号');
    const file = path.join(ROOT, 'reports', args.id, 'report.html');
    if (!fs.existsSync(file)) throw new Error('报告文件不存在');
    const error = await shell.openPath(file);
    if (error) throw new Error(error);
    return {};
  }
  if (['run', 'record_start', 'capture', 'preview','automation_capture','automation_preview'].includes(method)) {
    if(busy&&method==='automation_capture')return bridge.call(method,args);
    if (busy) throw new Error('请先停止录制或执行');
    if(method==='record_start'&&recordPending)throw new Error('请先在工作台处理上一段录制结果');
    const continuous = ['run', 'record_start'].includes(method);
    const generation=continuous?startGate.begin():0;
    if(continuous)continuousRole=role;
    const begin=()=>{
      // There is no await between cancellation checking and writing the backend request.
      return continuous?startGate.submit(generation,()=>bridge.call(method,args)):bridge.call(method,args);
    };
    if(method==='run'){
      const source=args.source==='recording'?'recording':'case';
      runState.start(args.project,args.iterations||1,source==='recording'?null:currentPath,source);publishRun();
    }
    if (continuous) {if(method==='record_start'){recordStarting=true;recordStart=0;recordCount=0;}busy = method === 'run' ? 'running' : 'recording'; registerStop();sendGameState();}
    try {
      // MCP observations leave the game foreground so the next authorized
      // operation can reuse it; manual renderer captures still return to the UI.
      return await handoff.call(begin, continuous || role === 'mcp');
    }
    catch (error) {if(method==='run'){if(error.cancelled)runState.finish({status:'stopped',error:error.message});else runState.fail(error.message);publishRun();}if (continuous) {busy = '';continuousRole='';recordStarting=false; registerStop();sendGameState();} throw error;}
    finally{if(continuous)startGate.finish();}
  }
  const data = await bridge.call(method, args);
  return data;
}
async function enableMcp(){
  const {startMcpServer,projectSchema,selectorSchema}=require('./mcp-server.cjs');
  const descriptor=runtimeFile('mcp-connection.json');
  if(fs.existsSync(descriptor)){
    const old=JSON.parse(fs.readFileSync(descriptor,'utf8'));
    if(path.resolve(old.root)!==ROOT||!Number.isSafeInteger(old.pid))throw new Error('MCP 连接文件身份无效');
    let alive=true;
    try{process.kill(old.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
    if(alive)throw new Error('已有 MCP 工作台连接，请关闭旧实例');
    fs.unlinkSync(descriptor);
  }
  backendAdmin=Boolean((await bridge.call('windows')).admin);
  automation=new McpAutomation({root:ROOT,state:()=>({...gameState(),dirty,editRevision,closing,admin:backendAdmin}),
    backend:(method,args)=>bridge.call(method,args),dispatch:(method,args)=>dispatchStudioCall('mcp',method,args),
    connect:connectSelectedGame,validateProject:project=>projectSchema.parse(project),validateSelector:selector=>selectorSchema.parse(selector),
    onOperation:async operation=>{
      registerStop();
      sendGameState();
      if(operation&&window&&!window.isDestroyed())await window.webContents.executeJavaScript('new Promise(resolve=>setTimeout(resolve,0))');
    },
    onProject:async(data,revision)=>{
      if(dirty||revision!==editRevision){
        if(currentPath&&fs.existsSync(currentPath))await bridge.call('load_project',{path:currentPath});
        throw new Error('界面有新的未保存修改，已保留编辑内容，请保存后重试 MCP 操作');
      }
      currentPath=data.path;currentCaseName=data.project.name;dirty=false;remember(data.path);sendGameState();
      send({kind:'project_loaded',...data,recent,library:await caseList()});
    }});
  mcpServer=await startMcpServer({root:ROOT,runtimePath:descriptor,invoke:(tool,args)=>automation.invoke(tool,args),
    status:()=>automation.status(),audit:auditWrite});
  auditWrite('info','mcp','listening',{url:mcpServer.url,admin:backendAdmin});
  send({kind:'notice',message:'MCP 已启用，可通过项目的 mcp-proxy 连接；F12 可停止执行。'});
}
let ipcSequence=0;
ipcMain.handle('studio:call',async(event,method,args={})=>{
  const requestId=`ipc-${++ipcSequence}`,started=Date.now();
  if(critical.has(method))auditWrite('info',method,'requested',{source:'ipc',requestId});
  try{const result=await studioCall(event,method,args);if(critical.has(method))auditWrite('info',method,'completed',{source:'ipc',requestId,elapsedMs:Date.now()-started});return result;}
  catch(error){auditError(String(method),error,{source:'ipc',requestId,elapsedMs:Date.now()-started},false);throw new Error(errorMessage(error));}
});
process.on('uncaughtException',error=>{auditError('electron.uncaughtException',error);send({kind:'service_error',message:errorMessage(error)});});
process.on('unhandledRejection',reason=>{const error=reason instanceof Error?reason:new Error(String(reason));auditError('electron.unhandledRejection',error);send({kind:'service_error',message:errorMessage(error)});});

app.on('second-instance', showWorkbench);
app.on('activate', showWorkbench);
app.whenReady().then(async () => {
  if (!primaryInstance) return;
  audit=new AuditLog(path.join(app.getPath('userData'),'logs'),{onEntry:entry=>send({kind:'audit_entry',entry})});
  auditWrite('info','application','started',{electron:process.versions.electron});
  fs.mkdirSync(CASES,{recursive:true});
  try{const saved=JSON.parse(fs.readFileSync(path.join(app.getPath('userData'),'case-library.json'),'utf8'));if(Array.isArray(saved))for(const file of saved)if(typeof file==='string')knownCases.add(file);}catch(error){if(error.code!=='ENOENT')auditError('case_library.load',error);}
  app.setAppUserModelId('local.echo-test');
  try { recent = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'recent.json'), 'utf8')); if (!Array.isArray(recent)) recent = []; } catch {}
  protocol.handle('echo-test', request => {
    const url = new URL(request.url);
    const filename = path.resolve(RENDERER, '.' + decodeURIComponent(url.pathname));
    if (url.host !== 'studio' || !filename.startsWith(RENDERER + path.sep)) return new Response('Not found', {status: 404});
    return net.fetch(pathToFileURL(filename).href);
  });
  createBridge();
  const caseIndex = process.argv.indexOf('--case');
  if (caseIndex >= 0 && process.argv[caseIndex + 1]) {
    try { const data = await bridge.call('load_project', {path: path.resolve(process.argv[caseIndex + 1])}); remember(data.path); }
    catch (error) { dialog.showErrorBox('无法打开用例', error.message); }
  }
  window = new BrowserWindow({
    width: 1440, height: 1000, minWidth: 1120, minHeight: 740, backgroundColor: '#ffffff', show: false,skipTaskbar:false,
    icon:path.join(__dirname,'assets/studio.png'),
    title: 'echo test', titleBarStyle: 'hidden', titleBarOverlay: {color: '#f8f8f9', symbolColor: '#55585e', height: 42},
    webPreferences: {preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true,backgroundThrottling:false}
  });
  secureWindow(window);
  window.setMenuBarVisibility(false);
  window.setSkipTaskbar(false);
  if(!gameSmoke&&process.env.ECHO_TEST_SMOKE_TEST!=='1'){
    const statePath=runtimeFile('workbench-state.json');
    fs.writeFileSync(statePath,JSON.stringify({host:nativeHandle(window),host_pid:process.pid}));
    window.once('closed',()=>{try{if(JSON.parse(fs.readFileSync(statePath,'utf8')).host_pid===process.pid)fs.unlinkSync(statePath);}catch{}});
  }
  tray=new Tray(path.join(__dirname,'assets/studio.png'));
  tray.setToolTip('echo test · 点击恢复窗口');
  tray.on('click',showWorkbench);
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:'显示工作台',click:showWorkbench},
    {label:'显示目标窗口',click:()=>openGameWindow().catch(error=>send({kind:'notice',message:error.message}))},
    {type:'separator'},
    {label:'退出工作台',click:()=>window.close()}
  ]));
  handoff = new GameHandoff(window, () => grantForeground(bridge, ROOT));
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.once('ready-to-show', () => {if(!mcpStartupSmoke)window.show();});
  let checkedRecording=0,recordHealthPending=false;
  const healthTimer=setInterval(async()=>{
    if(closing||busy!=='recording'||recordStarting||!recordStart||recordCount||Date.now()-recordStart<8000||checkedRecording===recordStart||recordHealthPending)return;
    checkedRecording=recordStart;recordHealthPending=true;
    try{
      const diagnostics=await bridge.call('record_status');
      if(busy==='recording'&&!recordCount){const message=require('./recording-health.cjs').recordingHint(diagnostics);auditWrite('warning','record','no_events',{diagnostics,message});send({kind:'notice',level:'warning',message});}
    }catch(error){auditError('record_status',error);}finally{recordHealthPending=false;}
  },1000);
  window.once('closed',()=>clearInterval(healthTimer));
  window.on('close', event => {
    if (closing) return;
    event.preventDefault();
    if (busy) {dialog.showMessageBoxSync(window, {type: 'info', message: '请先停止录制或执行，再关闭工作台。', buttons: ['知道了']}); return;}
    if (dirty && dialog.showMessageBoxSync(window, {type: 'question', message: '当前用例有未保存的修改。', detail: '可以取消关闭，保存后再退出。', buttons: ['继续编辑', '放弃修改并退出'], defaultId: 0, cancelId: 0}) === 0) return;
    closing = true;
    detachGame().then(()=>mcpServer?.close()).then(() => bridge.shutdown()).then(() => {gameWindow?.destroy();window.destroy();}).catch(error => {
      closing=false;
      dialog.showErrorBox('无法断开窗口工具栏',error.message);
    });
  });
  window.loadURL('echo-test://studio/index.html');
  if(mcpEnabled)window.webContents.once('did-finish-load',()=>enableMcp().catch(error=>{
    auditError('mcp.start',error);send({kind:'notice',level:'error',message:'MCP 启动失败：'+error.message});
  }));
  if(process.argv.includes('--record-diagnose')&&!gameSmoke&&process.env.ECHO_TEST_SMOKE_TEST!=='1'){
    window.webContents.once('did-finish-load',()=>require('./tools/recording-probe.cjs').probe(window,()=>bridge.call('record_status'))
      .catch(error=>auditError('record.diagnose',error)));
  }
  if (gameSmoke) {
    window.webContents.once('did-finish-load',async()=>{
      let result;
      try{
        result=await require('./tests/smoke/native-game-smoke.cjs').verify({root:ROOT,main:window,toolbar:()=>gameWindow,bridge,
          connect:connectSelectedGame,open:openGameWindow,nativeHandle});
      }catch(error){result={...error.results,error:error.stack};}
      finally{
        fs.writeFileSync(artifactFile('smoke', 'native-game-smoke.json'),JSON.stringify(result,null,2));
        try{await bridge.call('stop');await detachGame();await bridge.shutdown();closing=true;gameWindow?.destroy();window.destroy();}
        catch(error){dialog.showErrorBox('验证结束，请恢复目标应用',error.message);}
      }
    });
  } else if (process.env.ECHO_TEST_SMOKE_TEST === '1') {
    window.webContents.once('did-finish-load', async () => {
      try {
        const result = await window.webContents.executeJavaScript(`new Promise(resolve => { const started=Date.now(); const timer=setInterval(() => { if(window.__studioReady || Date.now()-started>15000) { clearInterval(timer); resolve({ready:!!window.__studioReady,title:document.title,steps:document.querySelectorAll('.step-row').length,nav:document.querySelectorAll('.nav-button').length,errors:window.__studioErrors||[]}); }},100); })`);
        fs.writeFileSync(artifactFile('smoke', 'electron-smoke.json'), JSON.stringify(result));
        await new Promise(resolve => setTimeout(resolve, 500));
        const image = await window.webContents.capturePage();
        fs.writeFileSync(artifactFile('smoke', 'electron-preview.png'), image.toPNG());
        const fixtureDirectory=path.join(app.getPath('userData'),'case-fixtures');
        fs.mkdirSync(fixtureDirectory,{recursive:true});
        const fixturePath=path.join(fixtureDirectory,'ui-smoke.echo.json');
        fs.writeFileSync(fixturePath,JSON.stringify({name:'界面验证用例',schema_version:1,selectors:[{name:'按钮',kind:'coordinate',x:.5,y:.5,normalized:true}],steps:[{name:'单击按钮',action:'click',target:'按钮',params:{}}]}));
        knownCases.add(fixturePath);
        const secondFixturePath=path.join(fixtureDirectory,'ui-smoke-second.echo.json');
        fs.writeFileSync(secondFixturePath,JSON.stringify({name:'第二个界面验证用例',schema_version:1,selectors:[{name:'按钮',kind:'coordinate',x:.4,y:.6,normalized:true}],steps:[{name:'单击按钮',action:'click',target:'按钮',params:{}}]}));
        knownCases.add(secondFixturePath);
        const interaction = await window.webContents.executeJavaScript(`(async () => {
          await refreshCases();
          const localCasesVisible=document.querySelectorAll('.library-list [data-act="case-open"]').length===S.library.length&&S.library.length>0;
          const caseDirectory=S.caseDirectory;
          const savedCase=S.library.find(item=>!item.error);
          await handleAction('case-open',{dataset:{path:savedCase.path}});
          const localCaseOpened=S.path===savedCase.path;
          S.caseSearch=savedCase.name;render();
          const caseSearch=document.querySelectorAll('.library-list [data-act="case-open"]').length>0;
          S.caseSearch='';render();
          addStep('long_press');
          const added = S.project.steps.at(-1)?.action === 'long_press' || S.project.steps[S.selected].action === 'long_press';
          S.view = 'targets'; render();
          await editTarget();
          const selectorDialog = document.querySelector('#modal').open && !!document.querySelector('[data-dfield="name"]');
          closeModal();
          S.view = 'record'; render();
          const recordButton = !!document.querySelector('[data-act="record-start"]');
          S.recordPending = {duration:2.5,project:{name:'测试录制',selectors:[{name:'录制位置 01',kind:'coordinate',x:.5,y:.5,normalized:true}],steps:[{name:'点击控件',action:'click',target:'录制位置 01',enabled:true,timeout:5,delay:.2,repeat:1,params:{}}]}};
          render();
          const stepCount = S.project.steps.length;
          const selectorCount = S.project.selectors.length;
          await acceptRecording(false);
          const converted = S.project.steps.length === stepCount + 1 && S.project.selectors.length === selectorCount + 1 && S.project.steps.at(-1).target === S.project.selectors.at(-1).name && !S.recordPending;
          return {localCasesVisible,localCaseOpened,caseSearch,caseDirectory,added,selectorDialog,recordButton,converted,errors:window.__studioErrors};
        })()`);
        fs.writeFileSync(artifactFile('smoke', 'electron-interaction.json'), JSON.stringify(interaction));
          await openGameWindow();
          const independent=await gameWindow.webContents.executeJavaScript(`({ready:window.__gameReady,recordButton:!!document.querySelector('#record'),disabled:document.querySelector('#record').disabled,errors:window.__gameErrors})`);
          independent.distinct=gameWindow!==window;
          independent.parent=gameWindow.getParentWindow();
          independent.alwaysOnTop=gameWindow.isAlwaysOnTop();
          await gameWindow.webContents.executeJavaScript("document.querySelector('#logs').click()");
          await new Promise(resolve=>setTimeout(resolve,350));
          independent.logsWithoutConnection=await window.webContents.executeJavaScript("S.view==='diagnostics'&&!!document.querySelector('#audit-search')");
          fs.writeFileSync(artifactFile('smoke', 'game-window-smoke.json'),JSON.stringify(independent));
          fs.writeFileSync(artifactFile('smoke', 'game-window-empty.png'),(await gameWindow.webContents.capturePage()).toPNG());
          await require('./tests/smoke/connection-smoke.cjs').verify(window);
          await require('./tests/smoke/window-search-smoke.cjs').verify(window);
          await require('./tests/smoke/recording-smoke.cjs').verify(window);
          await require('./tests/smoke/replay-smoke.cjs').verify(window);
          await require('./tests/smoke/game-run-smoke.cjs').verify(window,()=>gameWindow);
          await require('./tests/smoke/sidebar-smoke.cjs').verify(gameWindow);
          await require('./tests/smoke/script-smoke.cjs').verify(window);
          await require('./tests/smoke/recognition-smoke.cjs').verify(window);
          await require('./tests/smoke/help-smoke.cjs').verify(window,gameWindow);
          await require('./tests/smoke/shared-controls-smoke.cjs').verify(window);
          await require('./tests/smoke/control-picker-smoke.cjs').verify(window);
          await require('./tests/smoke/control-library-responsive-smoke.cjs').verify(window);
          await require('./tests/smoke/modal-buttons-smoke.cjs').verify(window);
          await require('./tests/smoke/history-delete-smoke.cjs').verify(window);
      } finally {closing = true; await bridge.shutdown();gameWindow?.destroy(); window.destroy();}
    });
  }
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {globalShortcut.unregisterAll();tray?.destroy();});
