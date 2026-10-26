// Capture the real UI with in-memory demonstration data, only in isolated smoke mode.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function capture(main,toolbar){
  if(process.env.ECHO_TEST_SMOKE_TEST!=='1')throw new Error('Documentation screenshots require isolated smoke mode');
  const output=path.join(root,'docs/images');fs.mkdirSync(output,{recursive:true});
  const mainSize=main.getSize(),barSize=toolbar.getSize();
  try{
    main.setSize(1440,1000);
    await main.webContents.executeJavaScript(`(()=>{
      const keys=['project','view','path','dirty','selected','libraryOpen','library','recent','windows','connection','handle','caseDirectory','controls','targetCategory','targetSearch','stepStatus','busy','recordPending','caseSearch','pythonControlSearch','pythonControlSelected','modeSource','iterations','android','runState','recordReplayRun'];
      window.__brandScreenshotSaved=Object.fromEntries(keys.map(key=>[key,S[key]]));
      const definitions=[['新建订单',.86,.12],['订单名称输入框',.38,.3],['保存订单',.76,.78],['创建成功提示',.5,.2,'创建成功'],['订单列表',.5,.55,'回归测试订单'],['查询订单',.82,.18]];
      const selectors=definitions.map(([name,x,y,text],index)=>({...defaultSelector(),name,x,y,kind:text?'image':'coordinate',recognition:text?'ocr':'template',text:text||'',library_id:'demo-'+index}));
      const steps=[['单击「新建订单」','click','新建订单',{}],['输入订单名称','text','',{text:'回归测试订单'}],['单击「保存订单」','click','保存订单',{}],['等待创建成功提示','wait_image','创建成功提示',{}],['验证订单已出现在列表','assert_image','订单列表',{}],['保存结果截图','screenshot','',{}]].map(([name,action,target,params])=>({name,action,target,params,enabled:true,timeout:5,delay:.3,repeat:1}));
      Object.assign(S,{project:{name:'订单创建与结果校验',schema_version:1,selectors,steps},view:'cases',path:null,dirty:false,selected:2,libraryOpen:false,library:[],recent:[],caseDirectory:'D:/echo-test/test_cases',stepStatus:{},busy:'',recordPending:null,caseSearch:'',targetCategory:'all',targetSearch:'',pythonControlSearch:'',pythonControlSelected:'',modeSource:null,iterations:1,runState:null,recordReplayRun:null});
      S.connection={handle:1001,pid:100,title:'本地示例应用',process_name:'demo.exe',width:1280,height:800};S.windows=[S.connection];S.handle=1001;
      S.controls={total:6,uncategorized:0,warnings:[],categories:[{id:'operations',name:'基础操作',count:4},{id:'feedback',name:'断言与反馈',count:2}],entries:selectors.map((selector,index)=>({id:selector.library_id,category_id:index===3||index===4?'feedback':'operations',selector}))};
      document.querySelector('#toasts').replaceChildren();render();
    })()`);
    await pause(200);
    fs.writeFileSync(path.join(output,'workbench.png'),(await main.webContents.capturePage()).toPNG());
    await main.webContents.executeJavaScript("S.view='targets';render()");await pause(150);
    fs.writeFileSync(path.join(output,'controls.png'),(await main.webContents.capturePage()).toPNG());
    await main.webContents.executeJavaScript(`(()=>{
      S.view='cases';S.pythonControlSelected='demo-2';
      S.project={name:'订单创建与结果校验 · Python',schema_version:1,mode:'python',script_timeout:600,selectors:[],steps:[],code:''};
      S.project.code=${JSON.stringify('# 使用共享控件编排测试\ndef click_and_wait(target, seconds=1):\n    window.click(target)\n    window.sleep(seconds)\n\nwindow.click(controls.by_id("demo-0"))\nwindow.text("回归测试订单")\nclick_and_wait(controls.by_id("demo-2"))\nwindow.assert_image(controls.by_id("demo-3"), timeout=5)\nwindow.screenshot()\nprint("订单创建测试完成")\n')};
      render();
    })()`);
    await pause(700);
    fs.writeFileSync(path.join(output,'python-editor.png'),(await main.webContents.capturePage()).toPNG());
    main.setSize(1440,1160);
    await main.webContents.executeJavaScript(`(()=>{
      window.__brandScreenshotApi=api;api=async(method,args)=>method.startsWith('android_')?{}:window.__brandScreenshotApi(method,args);
      initializeAndroid();
      const device={serial:'ANDROID-DEMO',model:'安卓演示设备',state:'device',transport:'usb',width:360,height:640};
      Object.assign(S.android,{connection:device,devices:[device],frame:{width:360,height:640},videoStatus:'streaming'});
      S.handle=null;S.connection=null;S.view='android';
      const canvas=document.createElement('canvas');canvas.width=360;canvas.height=640;const ctx=canvas.getContext('2d');
      ctx.fillStyle='#f2f5fa';ctx.fillRect(0,0,360,640);ctx.fillStyle='#16334a';ctx.fillRect(0,0,360,135);
      ctx.fillStyle='white';ctx.font='14px sans-serif';ctx.fillText('09:41',22,29);ctx.font='bold 26px sans-serif';ctx.fillText('EchoTest',24,85);ctx.font='15px sans-serif';ctx.fillText('Android 演示画面',24,112);
      ctx.fillStyle='white';ctx.fillRect(20,160,320,170);ctx.fillRect(20,350,320,190);ctx.fillStyle='#203c53';ctx.font='bold 20px sans-serif';ctx.fillText('设备测试',40,200);ctx.font='15px sans-serif';ctx.fillText('点击、长按、滑动',40,240);ctx.fillText('通过工作台操作并录制为用例',40,272);ctx.fillText('原生 UI / 图片 / OCR 定位',40,395);ctx.fillText('示例数据 · 非真实设备',40,432);
      ctx.fillStyle='#25856d';ctx.fillRect(40,470,280,42);ctx.fillStyle='white';ctx.fillText('开始测试',145,497);
      Object.assign(AndroidVideo,{token:'documentation-demo',id:'documentation-demo',serial:device.serial,hasFrame:true,controlReady:true,geometryReady:true,geometry:[360,640],backing:canvas,fps:0,maxFps:30});
      render();document.querySelector('#toasts').replaceChildren();
    })()`);
    await pause(200);
    fs.writeFileSync(path.join(output,'android.png'),(await main.webContents.capturePage()).toPNG());
    await main.webContents.executeJavaScript('AndroidVideo.stop(true);S.view="cases";S.android=window.__brandScreenshotSaved.android;api=window.__brandScreenshotApi;delete window.__brandScreenshotApi;');
    toolbar.setSize(380,760);
    await toolbar.webContents.executeJavaScript(`(()=>{
      window.__brandScreenshotSaved={...G};
      const names=['单击「新建订单」','输入订单名称','单击「保存订单」','等待创建成功提示','验证订单已出现在列表','保存结果截图'];
      Object.assign(G,{connection:{title:'本地示例应用',width:1280,height:800},toolbarLinked:true,busy:'running',recordStarting:false,recordPending:false,caseName:'订单创建与结果校验',caseChoice:'',library:[],run:{case:'订单创建与结果校验',status:'running',iterations:1,total:6,completed:3,passed:3,failed:0,stopped:0,current:{index:3,name:names[3],iteration:1,repeat:1,status:'running',started:Date.now()},steps:names.map((name,index)=>({index,name,repeatTotal:1,status:index<3?'passed':index===3?'running':'pending'}))}});renderState();
    })()`);
    await pause(150);
    fs.writeFileSync(path.join(output,'toolbar.png'),(await toolbar.webContents.capturePage()).toPNG());
  }finally{
    await main.webContents.executeJavaScript('if(window.__brandScreenshotApi){AndroidVideo.stop(true);api=window.__brandScreenshotApi;delete window.__brandScreenshotApi;}Object.assign(S,window.__brandScreenshotSaved);delete window.__brandScreenshotSaved;render()');
    await toolbar.webContents.executeJavaScript('if(window.__brandScreenshotSaved){Object.assign(G,window.__brandScreenshotSaved);delete window.__brandScreenshotSaved;renderState()}');
    main.setSize(...mainSize);toolbar.setSize(...barSize);
  }
}
module.exports={capture};
