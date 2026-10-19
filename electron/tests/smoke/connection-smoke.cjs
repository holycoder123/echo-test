// Reproduce discovery after startup using a fake target; no application input.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
async function verify(window){
  const result=await window.webContents.executeJavaScript(`(async()=>{
    const original=api,saved={windows:S.windows,handle:S.handle,connection:S.connection,view:S.view};
    const target={handle:99123,pid:88,width:1024,height:700,title:'连接回归目标应用'};
    let discovered=[target],attaches=0,detaches=0,rejectAttach=false;
    api=async(method,args)=>{
      if(method==='windows')return {windows:discovered,admin:S.admin};
      if(method==='game_connect'){attaches++;if(rejectAttach)throw new Error('测试窗口已关闭');return {connection:target};}
      if(method==='game_disconnect'){detaches++;return {connection:null};}
      if(method==='game_focus')return {focused:true};
      return original(method,args);
    };
    const result={};
    try{
      S.connection=null;S.handle=null;S.view='game';
      await handleAction('refresh',{dataset:{}});
      const brandImages=[...document.querySelectorAll('.app-mark img,.brand-icon img')];
      await Promise.all(brandImages.map(image=>image.decode()));
      result.brandLoaded=brandImages.length===2&&brandImages.every(image=>image.naturalWidth>0);
      result.discoveryDoesNotConnect=S.handle===null&&S.connection===null&&attaches===0&&document.querySelector('#connection').value===''&&!document.querySelector('.topbar-right>.status-dot.green');
      result.disconnectedMessage=document.querySelector('.empty strong').textContent==='尚未连接目标应用';
      await handleAction('game-connect',{dataset:{}});
      result.singleWindowConnect=attaches===1&&S.connection.handle===target.handle&&document.querySelector('#connection').value===String(target.handle);
      await handleAction('game-connect',{dataset:{}});
      result.sameWindowReconnect=attaches===2;
      await connectGame(null);rejectAttach=true;
      try{await connectGame(target.handle);}catch(error){result.failedError=error.message;}
      result.failedConnectionClearsSelection=S.handle===null&&S.connection===null&&document.querySelector('#connection').value==='';
      rejectAttach=false;await connectGame(target.handle);discovered=[];await refreshGameWindows();
      result.closedTargetClearsConnection=S.handle===null&&S.connection===null&&detaches>=2;
      discovered=[target,{...target,handle:99124,pid:89}];const before=attaches;await refreshGameWindows();
      await reconnectGame();result.multipleWindowsRequireSelection=attaches===before&&S.handle===null;
      const select=document.querySelector('#connection');select.value=String(target.handle);select.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,60));
      result.dropdownTriggersAttach=attaches===before+1&&S.connection?.handle===target.handle&&!S.connecting;
      return result;
    }finally{api=original;Object.assign(S,saved);S.connecting=false;render();}
  })()`);
  for(const [key,value] of Object.entries(result))if(key!=='failedError')assert.equal(value,true,key);
  result.passed=true;
  fs.writeFileSync(artifactFile('smoke','connection-smoke.json'),JSON.stringify(result,null,2));
  return result;
}
module.exports={verify};
