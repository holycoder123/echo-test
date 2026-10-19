const assert=require('node:assert/strict');
const fs=require('node:fs');
const {artifactFile}=require('../../paths.cjs');
async function verify(window){
  const result=await window.webContents.executeJavaScript(`(async()=>{
    const saved={project:S.project,dirty:S.dirty,mcpOperation:S.mcpOperation,busy:S.busy},result={};
    const click=async selector=>{modal.querySelector(selector).dispatchEvent(new MouseEvent('click',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,0));};
    const resolved=promise=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('弹窗未返回结果')),500))]);
    try{
      S.mcpOperation='';S.busy='';const bank=JSON.stringify(S.controls),project=JSON.stringify(S.project),dirtyBefore=S.dirty;
      await editTarget();const name=modal.querySelector('[data-dfield="name"]');name.value='取消后不得保存';name.dispatchEvent(new Event('input',{bubbles:true}));
      await click('.modal-footer [data-act="close-modal"]');result.cancelCloses=!modal.open&&S.modal===null;
      result.cancelLeavesData=JSON.stringify(S.controls)===bank&&JSON.stringify(S.project)===project&&S.dirty===dirtyBefore;
      await editTarget();await click('.modal-header [data-act="close-modal"] svg');result.crossCloses=!modal.open&&S.modal===null;
      await editTarget();S.mcpOperation='观察游戏';await click('.modal-footer [data-act="close-modal"]');result.closeDuringMcp=!modal.open&&S.modal===null;S.mcpOperation='';
      let answer=confirm('取消测试');await click('[data-act="confirm-no"]');result.confirmCancel=await resolved(answer)===false&&!modal.open;
      answer=confirm('关闭测试');await click('.modal-header [data-act="close-modal"]');result.confirmCross=await resolved(answer)===false&&!modal.open;
      answer=confirm('继续测试');await click('[data-act="confirm-yes"]');result.confirmContinue=await resolved(answer)===true&&!modal.open;
      answer=confirm('运行期间取消测试');S.mcpOperation='观察游戏';await click('[data-act="confirm-no"]');result.confirmCancelDuringMcp=await resolved(answer)===false&&!modal.open;S.mcpOperation='';
      await editTarget();modal.dispatchEvent(new Event('cancel',{cancelable:true}));result.escapeCloses=!modal.open&&S.modal===null;
      result.errors=window.__studioErrors;return result;
    }finally{closeModal();Object.assign(S,saved);render();}
  })()`);
  for(const [key,value] of Object.entries(result))if(key!=='errors')assert.equal(value,true,key);
  assert.deepEqual(result.errors,[]);result.passed=true;
  fs.writeFileSync(artifactFile('smoke','modal-buttons-smoke.json'),JSON.stringify(result,null,2));
}
module.exports={verify};
