(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WorkbenchModel=api;})(typeof window==='object'?window:globalThis,()=>{
  'use strict';
  function range(project,mode,selected,checked=[]){
    if(!['step','selection','to','from'].includes(mode))throw new Error('未知的局部运行方式');
    if(project.mode==='python')throw new Error('Python 用例请运行完整程序；局部调试用于低代码步骤。');
    const steps=project.steps;
    if(!steps.length)throw new Error('请先添加步骤');
    const indices=mode==='selection'?checked:[selected];
    if(!indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=steps.length))throw new Error('请先选择有效步骤');
    let start=mode==='to'?0:Math.min(...indices),end=mode==='from'?steps.length-1:Math.max(...indices);
    const stack=[],pairs=[];
    steps.forEach((step,i)=>{if(step.action==='loop')stack.push(i);if(step.action==='end_loop'){if(!stack.length)throw new Error('循环结构不完整');pairs.push([stack.pop(),i]);}});
    if(stack.length)throw new Error('循环结构不完整');
    let changed=true;
    while(changed){changed=false;for(const [a,b] of pairs){if(a<=end&&b>=start&&(a<start||b>end)){start=Math.min(start,a);end=Math.max(end,b);changed=true;}}}
    const copy=JSON.parse(JSON.stringify(project));
    copy.steps.forEach((step,i)=>{if(i<start||i>end)step.enabled=false;});
    const parents=[];let executable=false;
    copy.steps.forEach(step=>{if(step.action==='loop')parents.push(step.enabled!==false&&parents.every(Boolean));else if(step.action==='end_loop')parents.pop();else if(step.enabled!==false&&parents.every(Boolean))executable=true;});
    if(!executable)throw new Error('所选范围没有已启用的操作，请检查所属循环是否禁用');
    return {project:copy,start,end,expanded:start!==(mode==='to'?0:Math.min(...indices))||end!==(mode==='from'?steps.length-1:Math.max(...indices))};
  }
  function parseDraft(text){
    if(!text||text.length>4*1024*1024)return null;
    try{
      const d=JSON.parse(text),p=d?.project;
      if(d?.version!==1||!p||typeof p.name!=='string'||!Array.isArray(p.steps)||!Array.isArray(p.selectors)||d.path!=null&&typeof d.path!=='string'||typeof d.baseDir!=='string')return null;
      if(p.steps.length>10000||p.selectors.length>5000||p.steps.some(s=>!s||typeof s.action!=='string'||typeof s.name!=='string')||p.selectors.some(s=>!s||typeof s.name!=='string'||typeof s.kind!=='string'))return null;
      if(p.mode!=null&&!['lowcode','python'].includes(p.mode)||p.code!=null&&typeof p.code!=='string')return null;
      return d;
    }catch{return null;}
  }
  return {range,parseDraft};
});
