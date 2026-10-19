const MAIN_METHODS=new Set(['case_list','open_case','case_folder','bootstrap','windows','new_project','open_project','open_recent','save_project','capture','save_template','import_template','template_preview','preview','run','stop','record_start','record_stop','reports','open_report','dirty','game_connect','game_disconnect','game_focus','game_open','workbench_show','record_reviewed','game_state']);
const GAME_METHODS=new Set(['game_state','workbench_show','game_action','record_start','stop','game_disconnect','game_focus']);
function authorize(event,main,game,method,args) {
  if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('无效的操作参数');
  for(const [role,win,page,methods] of [['main',main,'/index.html',MAIN_METHODS],['game',game,'/game.html',GAME_METHODS]]) {
    if(!win||win.isDestroyed()||event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame)continue;
    const url=new URL(event.senderFrame.url);
    if(url.protocol==='echo-test:'&&url.host==='studio'&&url.pathname===page&&methods.has(method))return role;
  }
  throw new Error('当前窗口不允许此操作');
}
for(const method of ['audit_list','audit_delete','audit_export','audit_folder','renderer_error'])MAIN_METHODS.add(method);
GAME_METHODS.add('renderer_error');
GAME_METHODS.add('case_list');
MAIN_METHODS.add('game_bundle');GAME_METHODS.add('game_bundle');
MAIN_METHODS.add('script_import');MAIN_METHODS.add('reports_delete');
for(const method of ['control_list','control_save','control_delete','control_import','control_category_save','control_category_delete'])MAIN_METHODS.add(method);
module.exports={authorize};
