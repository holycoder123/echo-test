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
      const keys=['project','view','path','dirty','selected','libraryOpen','library','recent','windows','connection','handle','caseDirectory','controls','targetCategory','targetSearch','stepStatus','busy','recordPending','caseSearch'];
      window.__brandScreenshotSaved=Object.fromEntries(keys.map(key=>[key,S[key]]));
      const definitions=[['新建订单',.86,.12],['订单名称输入框',.38,.3],['保存订单',.76,.78],['创建成功提示',.5,.2,'创建成功'],['订单列表',.5,.55,'回归测试订单'],['查询订单',.82,.18]];
      const selectors=definitions.map(([name,x,y,text],index)=>({...defaultSelector(),name,x,y,kind:text?'image':'coordinate',recognition:text?'ocr':'template',text:text||'',library_id:'demo-'+index}));
      const steps=[['单击「新建订单」','click','新建订单',{}],['输入订单名称','text','',{text:'回归测试订单'}],['单击「保存订单」','click','保存订单',{}],['等待创建成功提示','wait_image','创建成功提示',{}],['验证订单已出现在列表','assert_image','订单列表',{}],['保存结果截图','screenshot','',{}]].map(([name,action,target,params])=>({name,action,target,params,enabled:true,timeout:5,delay:.3,repeat:1}));
      Object.assign(S,{project:{name:'订单创建与结果校验',schema_version:1,selectors,steps},view:'cases',path:null,dirty:false,selected:2,libraryOpen:false,library:[],recent:[],caseDirectory:'D:/echo-test/test_cases',stepStatus:{},busy:'',recordPending:null,caseSearch:'',targetCategory:'all',targetSearch:''});
      S.connection={handle:1001,pid:100,title:'本地示例应用',process_name:'demo.exe',width:1280,height:800};S.windows=[S.connection];S.handle=1001;
      S.controls={total:6,uncategorized:0,warnings:[],categories:[{id:'operations',name:'基础操作',count:4},{id:'feedback',name:'断言与反馈',count:2}],entries:selectors.map((selector,index)=>({id:selector.library_id,category_id:index===3||index===4?'feedback':'operations',selector}))};
      document.querySelector('#toasts').replaceChildren();render();
    })()`);
    await pause(200);
    fs.writeFileSync(path.join(output,'workbench.png'),(await main.webContents.capturePage()).toPNG());
    await main.webContents.executeJavaScript("S.view='targets';render()");await pause(150);
    fs.writeFileSync(path.join(output,'controls.png'),(await main.webContents.capturePage()).toPNG());
    toolbar.setSize(380,760);
    await toolbar.webContents.executeJavaScript(`(()=>{
      window.__brandScreenshotSaved={...G};
      const names=['单击「新建订单」','输入订单名称','单击「保存订单」','等待创建成功提示','验证订单已出现在列表','保存结果截图'];
      Object.assign(G,{connection:{title:'本地示例应用',width:1280,height:800},toolbarLinked:true,busy:'running',recordStarting:false,recordPending:false,caseName:'订单创建与结果校验',caseChoice:'',library:[],run:{case:'订单创建与结果校验',status:'running',iterations:1,total:6,completed:3,passed:3,failed:0,stopped:0,current:{index:3,name:names[3],iteration:1,repeat:1,status:'running',started:Date.now()},steps:names.map((name,index)=>({index,name,repeatTotal:1,status:index<3?'passed':index===3?'running':'pending'}))}});renderState();
    })()`);
    await pause(150);
    fs.writeFileSync(path.join(output,'toolbar.png'),(await toolbar.webContents.capturePage()).toPNG());
  }finally{
    await main.webContents.executeJavaScript('Object.assign(S,window.__brandScreenshotSaved);delete window.__brandScreenshotSaved;render()');
    await toolbar.webContents.executeJavaScript('if(window.__brandScreenshotSaved){Object.assign(G,window.__brandScreenshotSaved);delete window.__brandScreenshotSaved;renderState()}');
    main.setSize(...mainSize);toolbar.setSize(...barSize);
  }
}
module.exports={capture};
