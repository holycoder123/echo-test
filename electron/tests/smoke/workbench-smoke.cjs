// All target input and persistence calls are intercepted; no real game is operated.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function verify(main){
  const js=code=>main.webContents.executeJavaScript(code),result={},size=main.getSize();
  try{
    await js(`window.__wbSaved={api,state:{...S},draft:localStorage.getItem(WB_DRAFT_KEY),discovery:windowDiscovery.enabled};windowDiscovery.stop();
      window.__wbCalls=[];window.__wbFixtureImage=(()=>{const c=document.createElement('canvas');c.width=640;c.height=360;const ctx=c.getContext('2d');ctx.fillStyle='#18334b';ctx.fillRect(0,0,640,360);ctx.fillStyle='#fff';ctx.font='24px sans-serif';ctx.fillText('GAME TEST · BACKPACK',35,60);return c.toDataURL();})();
      const fixture={name:'背包开关验证',schema_version:1,mode:'lowcode',selectors:[{name:'背包按钮',kind:'coordinate',x:.5,y:.5,normalized:true}],steps:[{name:'打开背包',action:'click',target:'背包按钮',enabled:true,timeout:5,delay:.1,repeat:1,params:{}},{name:'关闭背包',action:'key',enabled:true,timeout:5,delay:.1,repeat:1,params:{keys:'ESC'}}]};
      Object.assign(S,{project:fixture,path:null,baseDir:'C:/fixture',view:'cases',busy:'',recordStarting:false,recordPending:null,mcpOperation:'',gameRunStarting:false,windowPicking:false,connection:{handle:-42,pid:42,title:'游戏测试客户端 · Beta 验收',width:1280,height:720},handle:-42,library:[],controls:{entries:[],categories:[]},thumbnails:{},selected:0,stepStatus:{},dirty:false,runState:null,logs:[],lastResult:null});
      S.android={...S.android,connection:null};initializeWorkbench();S.wb.recovery=null;S.wb.draftReady=true;
      api=async(method,args={})=>{
        window.__wbCalls.push({method,args:clone(args)});
        if(['record_start','record_reviewed','dirty','run','stop'].includes(method))return {};
        if(method==='capture')return {id:'wb-capture',image:window.__wbFixtureImage,width:640,height:360};
        if(method==='save_template')return {image:'assets/wb-template.png'};
        if(method==='template_preview'||method==='report_image')return {image:window.__wbFixtureImage};
        if(method==='case_context')return {path:args.path||null,base_dir:args.base_dir};
        if(method==='preview')return {image:window.__wbFixtureImage,width:640,height:360,point:[120,40],box:[80,20,80,40],matched:true,score:.97,diagnostic:{method:'template',matched:true,reason:'模板匹配成功',candidate:{score:.97,scale:1,image:'assets/wb-template.png'}}};
        if(method==='control_import')return {project:args.project,controls:S.controls};
        if(method==='record_positions_localize'){const project=clone(args.project);for(const step of project.steps){if(step.target==='录制位置 99'){step.target='';step.params.position={x:.2,y:.3,normalized:true};}}project.selectors=project.selectors.filter(t=>t.name!=='录制位置 99');return {project,converted:1};}
        if(method==='control_list')return S.controls;
        if(method==='control_save'){const id=(S.controls.entries.length+1).toString(16).padStart(32,'0');return {entries:[...S.controls.entries,{id,selector:{...args.selector,library_id:id},category_id:'',source:'manual'}],categories:[]};}
        if(method==='reports')return [];
        throw new Error('Unexpected beta fixture method: '+method);
      };render();void 0;`);
    result.workspace=await js(`!!document.querySelector('.wb-projects')&&!!document.querySelector('.wb-run-drawer')&&!!document.querySelector('[data-act="wb-assert"]')`);
    result.recording=await js(`(async()=>{await workbenchStartRecord();S.recordCount=4;workbenchRecordingStatus();const stays=S.view==='cases'&&S.busy==='recording'&&!!S.wb.recordContext&&document.querySelector('#wb-record-status').textContent.includes('4 个事件');await workbenchAcceptRecording({raw_count:1,duration:1,project:{name:'recording',selectors:[],steps:[{name:'录制按键',action:'key',params:{keys:'B'},enabled:true,timeout:5,delay:0,repeat:1}]}});return stays&&S.view==='cases'&&S.project.steps.length===3&&!!S.wb.undoRecording&&!S.recordPending;})()`);
    result.undo=await js(`(async()=>{await workbenchAction('wb-undo-recording',{});return S.project.steps.length===2&&!S.wb.undoRecording;})()`);
    result.verification=await js(`(async()=>{S.selected=0;await workbenchCaptureVerification();S.modal.selection=[10,10,110,60];await acceptPick();S.modal.draft.name='背包标题';await workbenchSaveVerification();return S.project.steps.length===3&&S.project.steps[1].action==='assert_image'&&S.project.steps[1].target==='背包标题'&&S.selected===1;})()`);
    result.preview=await js(`(async()=>{await workbenchPreview();return !!document.querySelector('.wb-preview img')&&S.wb.preview.shot.matched;})()`);
    result.draft=await js(`(()=>{dirty();const d=WorkbenchModel.parseDraft(localStorage.getItem(WB_DRAFT_KEY));return d.project.steps.length===3&&d.project.name===S.project.name;})()`);
    result.partial=await js(`(async()=>{const before=JSON.stringify(S.project);await workbenchRun('step');const req=window.__wbCalls.filter(row=>row.method==='run').at(-1).args;return S.view==='cases'&&req.iterations===1&&req.project.steps[0].enabled===false&&req.project.steps[1].enabled&&req.project.steps[2].enabled===false&&JSON.stringify(S.project)===before;})()`);
    await js(`S.busy='';S.lastResult={id:'beta_fixture',status:'failed'};void 0;`);
    main.webContents.send('studio:event',{kind:'finished',directory:'C:/fixture/reports/beta_fixture',result:{status:'failed',error:'等待目标超时',steps:[{index:1,name:'验证背包标题',status:'failed',error:'5 秒内未找到图片控件',screenshot:'failure_2.png',recognition:{'背包标题':{reason:'最佳候选未达到阈值',threshold:.86,candidate:{score:.72}}}}]}});
    await pause(120);
    result.failure=await js(`S.view==='cases'&&S.selected===1&&!!document.querySelector('.wb-failure img')&&document.querySelector('.wb-failure').textContent.includes('0.720')`);
    result.repair=await js(`(async()=>{const original=clone(S.controls.entries);const old=S.project.steps[1].target;await workbenchCaptureVerification('assert_image',true);S.modal.selection=[10,10,110,60];await acceptPick();await workbenchSaveVerification();return S.project.steps[1].target!==old&&S.controls.entries.some(row=>row.selector.name===old)&&JSON.stringify(S.controls.entries.slice(0,original.length))===JSON.stringify(original);})()`);
    result.restore=await js(`(async()=>{dirty();const d=WorkbenchModel.parseDraft(localStorage.getItem(WB_DRAFT_KEY));const expected=JSON.stringify(d.project);S.project={name:'空白',steps:[],selectors:[]};S.dirty=false;S.wb.recovery=d;const protectedDraft=localStorage.getItem(WB_DRAFT_KEY);clearWorkbenchDraft();if(localStorage.getItem(WB_DRAFT_KEY)!==protectedDraft)throw new Error('Unreviewed recovery point was deleted');await workbenchAction('wb-restore',{});return JSON.stringify(S.project)===expected&&S.dirty&&!S.wb.recovery&&S.baseDir===d.baseDir;})()`);
    result.inlineRecording=await js(`(async()=>{S.busy='';const before=S.controls.entries.length;await workbenchStartRecord();await workbenchAcceptRecording({raw_count:2,duration:1,project:{name:'recording',selectors:[],steps:[{name:'点击背包入口',action:'click',target:'',params:{position:{x:.25,y:.5,normalized:true}},enabled:true,timeout:5,delay:0,repeat:1}]}});return S.controls.entries.length===before&&S.project.steps[S.selected].params.position.x===.25&&document.querySelector('.step-position-choice').textContent.includes('本步位置');})()`);
    result.inlineEditAndRecapture=await js(`(async()=>{const step=S.project.steps[S.selected],before=S.controls.entries.length;openStepPosition('target');S.modal.draft.x=.4;S.modal.draft.offset_x=3;saveStepPosition();openStepPosition('target');await handleAction('pick-target',{dataset:{}});S.modal.selection=[160,90];await acceptPick();if(S.modal.kind!=='selector'||!S.modal.stepPosition)throw new Error('Lost step position context');saveStepPosition();return !step.target&&Math.abs(step.params.position.x-160/639)<.000001&&step.params.position.offset_x===3&&S.controls.entries.length===before;})()`);
    result.inlinePreviewIsolation=await js(`(async()=>{await workbenchPreview();const step=S.project.steps[S.selected];const visible=!!document.querySelector('.wb-preview');S.project.steps.push({...clone(step),name:'其他位置'});S.selected++;render();return visible&&!document.querySelector('.wb-preview');})()`);
    result.positionPromotion=await js(`(async()=>{const step=S.project.steps[S.selected],before=S.controls.entries.length;promoteStepPosition('target');S.modal.name='背包入口复用';await savePositionPromotion();return step.target==='背包入口复用'&&!step.params.position&&S.controls.entries.length===before+1&&S.project.selectors.some(t=>t.name===step.target&&t.library_id);})()`);
    result.dragPositionAndSharedSwitch=await js(`(async()=>{const step=S.project.steps[S.selected];step.action='drag';step.end_target='';step.params.end_position={x:.7,y:.8};step.params.path=[[.2,.3],[.7,.8]];render();openStepPosition('end_target');saveStepPosition();if(!step.params.path)throw new Error('Unchanged endpoint must keep the recorded path');openStepPosition('end_target');S.modal.draft.y=.9;saveStepPosition();if(step.params.end_position.y!==.9||step.params.path)return false;step.params.path=[[.2,.3],[.7,.9]];await openControlPicker('end_target');S.modal.selectedId=S.controls.entries.find(e=>e.selector.name==='背包入口复用').id;await sharedControlAction('picker-accept',{dataset:{}});return !step.params.path&&step.end_target==='背包入口复用'&&!step.params.end_position;})()`);
    result.inlineImageRepair=await js(`(async()=>{const step=S.project.steps[S.selected];step.action='click';step.target='';step.end_target='';step.params={position:{x:.25,y:.5}};await workbenchCaptureVerification('assert_image',true);S.modal.selection=[10,10,110,60];await acceptPick();await workbenchSaveVerification();return !!step.target&&!step.params.position&&S.project.selectors.find(t=>t.name===step.target).kind==='image';})()`);
    result.historySeparation=await js(`(()=>{const before=clone(S.controls);const id='f'.repeat(32);S.controls.entries.push({id,legacy_recording:true,category_id:'',selector:{name:'录制位置 99',kind:'coordinate',x:.2,y:.3,library_id:id}});S.targetSearch='';S.targetCategory='all';S.view='targets';render();const hidden=!document.querySelector('[data-control-id="'+id+'"]')&&document.querySelector('[data-category="recording-history"]').textContent.includes('1');S.targetCategory='recording-history';render();const history=!!document.querySelector('[data-control-id="'+id+'"]');S.controls=before;S.view='cases';render();return hidden&&history;})()`);
    result.legacyConversion=await js(`(async()=>{const id='f'.repeat(32),selector={name:'录制位置 99',kind:'coordinate',x:.2,y:.3,library_id:id};S.controls.entries.push({id,legacy_recording:true,category_id:'',selector});S.project.selectors.push(clone(selector));S.project.steps.push({name:'旧录制点击',action:'click',target:selector.name,params:{},delay:0,timeout:5,repeat:1,enabled:true});S.selected=S.project.steps.length-1;const bank=JSON.stringify(S.controls);const pending=localizeRecordingPositions();await new Promise(r=>setTimeout(r,0));if(S.modal?.kind!=='confirm')throw new Error('Conversion must be reviewed first');await handleAction('confirm-yes',{dataset:{}});await pending;const step=S.project.steps[S.selected];return !step.target&&step.params.position.x===.2&&S.dirty&&JSON.stringify(S.controls)===bank;})()`);
    result.targetSetup=await js(`(async()=>{
      const original={project:S.project,selected:S.selected,controls:clone(S.controls),dirty:S.dirty,api};
      const check=(condition,message)=>{if(!condition)throw new Error(message);};
      try{
        S.project={name:'明确选择操作目标',schema_version:1,mode:'lowcode',selectors:[],steps:[]};S.selected=0;S.dirty=false;render();
        const before=JSON.stringify(S.project);addStep('click');
        check(S.modal.kind==='step-setup'&&!!modal.querySelector('[data-act="setup-coordinate"]')&&!!modal.querySelector('[data-act="setup-image"]'),'Missing positioning choices');
        check(JSON.stringify(S.project)===before&&!S.dirty,'Step was inserted before the user chose a target');
        await stepSetupAction('setup-coordinate');await stepSetupAction('setup-back');check(S.modal.kind==='step-setup','Coordinate editor cannot return to positioning choices');closeModal();check(JSON.stringify(S.project)===before&&!S.dirty,'Cancel changed the project');
        addStep('click');await stepSetupAction('setup-coordinate');S.modal.draft.x=.12;S.modal.draft.y=.34;saveStepPosition();
        check(S.project.steps.length===1&&!S.project.steps[0].target&&S.project.steps[0].params.position.x===.12&&S.project.selectors.length===0,'Coordinate was not explicitly configured');
        const image=S.controls.entries.findLast(e=>e.selector.kind==='image');check(!!image,'Missing fixture image');
        addStep('double_click');await stepSetupAction('setup-image');
        check(S.modal.imageOnly&&!S.modal.selectedId&&modal.querySelector('[data-act="picker-accept"]').disabled,'An image was preselected');
        check([...modal.querySelectorAll('.control-picker-card')].every(n=>S.controls.entries.find(e=>e.id===n.dataset.id).selector.kind==='image'),'Image picker includes coordinates');
        await sharedControlAction('picker-select',{dataset:{id:image.id}});await sharedControlAction('picker-accept',{dataset:{}});
        check(S.project.steps.length===2&&S.project.steps[1].action==='double_click'&&S.project.steps[1].target===image.selector.name,'Selected image was not used for the requested action');
        const withImage=JSON.stringify(S.project);addStep('drag');await stepSetupAction('setup-coordinate');saveStepPosition();
        check(S.modal.kind==='step-setup'&&S.modal.setup.key==='end_target'&&JSON.stringify(S.project)===withImage,'Drag was inserted without its endpoint');
        closeModal();check(JSON.stringify(S.project)===withImage,'Canceling drag left a partial step');
        addStep('drag');await stepSetupAction('setup-coordinate');S.modal.draft.x=.21;saveStepPosition();await stepSetupAction('setup-image');
        await sharedControlAction('picker-select',{dataset:{id:image.id}});await sharedControlAction('picker-accept',{dataset:{}});
        const drag=S.project.steps[2];check(drag.action==='drag'&&drag.params.position.x===.21&&drag.end_target===image.selector.name,'Drag endpoint selection failed');
        const selectors=S.project.selectors.length;addStep('key');check(S.project.steps[3].target===''&&S.project.selectors.length===selectors,'Keyboard step bound an unrelated control');
        addStep('assert_image');await stepSetupAction('setup-image');await stepSetupAction('setup-capture');
        check(S.modal.stepSetup.step.action==='assert_image','Image creation lost its pending operation');
        await captureTarget();S.modal.selection=[10,10,110,60];await acceptPick();S.modal.draft.name='新步骤图片';await saveStepSetupImage();
        check(S.project.steps.length===5&&S.project.steps[4].action==='assert_image'&&S.project.steps[4].target==='新步骤图片','Captured image did not complete the pending step');
        const fullBank=S.controls;S.controls={entries:[],categories:[]};const count=S.project.steps.length;addStep('right_click');await stepSetupAction('setup-image');
        check(!S.modal.selectedId&&modal.querySelectorAll('.control-picker-card').length===0&&!!modal.querySelector('[data-act="setup-capture"]'),'Empty image library has no creation path');
        await stepSetupAction('setup-back');await stepSetupAction('setup-coordinate');saveStepPosition();check(S.project.steps.length===count+1,'Empty library blocked coordinate steps');S.controls=fullBank;
        S.selected=0;render();const oldStep=clone(S.project.steps[0]),actionField=document.querySelector('[data-sfield="action"]');actionField.value='assert_image';actionField.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,0));
        check(!S.project.steps[0].target&&S.modal?.imageOnly&&!S.modal.selectedId,'Changing action silently chose the first image');closeModal();S.project.steps[0]=oldStep;
        const stable=JSON.stringify(S.project);let release;
        api=(method,args)=>method==='control_list'?new Promise(resolve=>release=()=>resolve(S.controls)):original.api(method,args);
        addStep('click');const loading=stepSetupAction('setup-image');closeModal();release();await loading;check(!S.modal&&JSON.stringify(S.project)===stable,'Canceled picker reopened after loading');api=original.api;
        addStep('click');await stepSetupAction('setup-capture');S.modal.draft.image='assets/wb-template.png';
        api=async(method,args)=>{if(method==='control_save')await new Promise(resolve=>release=resolve);return original.api(method,args);};
        const saving=saveStepSetupImage();closeModal();release();await saving;check(!S.modal&&JSON.stringify(S.project)===stable,'Canceled image save inserted a step');api=original.api;
        addStep('click');await stepSetupAction('setup-coordinate');
        api=async(method,args)=>{if(method==='capture')await new Promise(resolve=>release=resolve);return original.api(method,args);};
        const capture=captureTarget();closeModal();release();await capture;check(!S.modal&&JSON.stringify(S.project)===stable,'Canceled capture reopened its dialog');api=original.api;
        addStep('click');await stepSetupAction('setup-coordinate');S.project.steps[0].name+=' changed';let guarded=false;try{saveStepPosition();}catch(error){guarded=error.message.includes('已变化');}check(guarded&&S.project.steps.length===count+1,'Stale setup overwrote changed steps');closeModal();
        return true;
      }finally{api=original.api;S.project=original.project;S.controls=original.controls;S.selected=original.selected;S.dirty=original.dirty;closeModal();render();}
    })()`);
    await js(`addStep('click');document.querySelector('#toasts').replaceChildren();void 0;`);
    await pause(120);
    fs.writeFileSync(artifactFile('smoke','add-step-target-preview.png'),(await main.webContents.capturePage()).toPNG());
    await js(`closeModal();void 0;`);
    result.sizes=[];
    await js(`document.querySelector('#toasts').replaceChildren();void 0;`);
    for(const [width,height] of [[1120,740],[1440,900]]){
      main.setSize(width,height);await pause(100);
      const layout=await js(`({overflow:document.body.scrollWidth>innerWidth,inspector:(()=>{const r=document.querySelector('.inspector').getBoundingClientRect();return r.right<=innerWidth&&r.width>180;})()})`);
      assert.equal(layout.overflow,false);assert.equal(layout.inspector,true);result.sizes.push({width,height,...layout});
      if(width===1440)fs.writeFileSync(artifactFile('smoke','workbench-beta-preview.png'),(await main.webContents.capturePage()).toPNG());
    }
    for(const [key,value] of Object.entries(result))if(key!=='sizes')assert.equal(value,true,key);
    result.errors=await js('window.__studioErrors');assert.deepEqual(result.errors,[]);
    result.passed=true;
  }catch(error){result.error=error.stack;throw error;}
  finally{
    fs.writeFileSync(artifactFile('smoke','workbench-beta-smoke.json'),JSON.stringify(result,null,2));
    await js(`if(window.__wbSaved){api=window.__wbSaved.api;Object.assign(S,window.__wbSaved.state);if(window.__wbSaved.draft===null)localStorage.removeItem(WB_DRAFT_KEY);else localStorage.setItem(WB_DRAFT_KEY,window.__wbSaved.draft);render();if(window.__wbSaved.discovery)windowDiscovery.start();delete window.__wbSaved;}`);main.setSize(...size);
  }
}
module.exports={verify};
