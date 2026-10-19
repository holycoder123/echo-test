const assert=require('node:assert/strict');
const fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function verify(bar) {
  const originalSize=bar.getSize(),saved=await bar.webContents.executeJavaScript('JSON.stringify(G)');
  const result={sizes:[],errors:[]};
  try {
    await bar.webContents.executeJavaScript(`Object.assign(G,{
      connection:{width:1024,height:700,title:'Server 4.137服一线 诺亚传说'},toolbarLinked:true,busy:'running',recordStarting:false,recordPending:false,
      run:{case:'新手任务 · 接受任务与交付奖励',status:'running',iterations:1,total:6,completed:3,passed:3,failed:0,stopped:0,
        current:{index:3,name:'打开任务详情，确认目标、奖励与完成条件',iteration:1,repeat:1,status:'running',started:Date.now()},
        steps:['打开任务列表','核对当前可接任务','前往任务 NPC 并接受任务','打开任务详情，确认目标、奖励与完成条件','完成任务后检查经验与奖励发放','返回任务列表，确认已完成的任务不再显示'].map((name,index)=>({index,name,repeatTotal:1,status:index<3?'passed':index===3?'running':'pending'}))}
    });renderState()`);
    for(const [width,height] of [[380,730],[300,600],[420,800]]) {
      bar.setSize(width,height);await pause(100);
      const layout=await bar.webContents.executeJavaScript(`({width:innerWidth,height:innerHeight,
        controls:['record','coordinate','image','logs','workbench','game-case','game-iterations','case-refresh','run','bundle','help'].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}),
        noHorizontalOverflow:document.body.scrollWidth<=innerWidth&&document.querySelector('.run-area').scrollWidth<=document.querySelector('.run-area').clientWidth,
        wrapsNames:getComputedStyle(document.querySelector('.run-step strong')).whiteSpace==='normal'&&getComputedStyle(document.querySelector('.execution-current>span')).whiteSpace==='normal',
        singleScroll:getComputedStyle(document.querySelector('.run-step-list')).overflowY==='visible',stepsExpanded:document.querySelector('.run-details').open,
        footer:document.querySelector('footer').getBoundingClientRect().bottom<=innerHeight,runArea:document.querySelector('.run-area').getBoundingClientRect().height>=90})`);
      for(const [key,value] of Object.entries(layout))if(!['width','height'].includes(key))assert.equal(value,true,`${width}x${height} ${key}`);
      result.sizes.push(layout);
      if(width===380)fs.writeFileSync(artifactFile('smoke','right-sidebar-running.png'),(await bar.webContents.capturePage()).toPNG());
    }
    bar.setSize(380,730);
    await bar.webContents.executeJavaScript(`G.busy='';G.run.status='failed';G.run.error='未找到任务完成提示：请确认任务对话框已打开。最佳匹配度 0.812，阈值 0.860；可在控件库预览定位并检查模板。';G.run.steps[3].status='failed';G.run.steps[3].error=G.run.error;renderState()`);
    await pause(100);
    result.errorsVisible=await bar.webContents.executeJavaScript("getComputedStyle(document.querySelector('.run-error')).maxHeight==='none'&&document.querySelector('.run-error').textContent===G.run.error");
    assert.equal(result.errorsVisible,true);
    fs.writeFileSync(artifactFile('smoke','right-sidebar-failure.png'),(await bar.webContents.capturePage()).toPNG());
    result.errors=await bar.webContents.executeJavaScript('window.__gameErrors');assert.deepEqual(result.errors,[]);result.passed=true;
  }finally {
    await bar.webContents.executeJavaScript(`Object.assign(G,${saved});renderState()`);bar.setSize(...originalSize);
    fs.writeFileSync(artifactFile('smoke','sidebar-smoke.json'),JSON.stringify(result,null,2));
  }
}
module.exports={verify};
