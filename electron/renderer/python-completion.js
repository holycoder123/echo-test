'use strict';

const PythonCompletion=(()=>{
  const methods=[
    ['size','size()','返回目标窗口客户区的宽度和高度。',false],
    ['locate','locate(target, timeout=5)','定位控件，返回客户区坐标；target 可传控件引用或名称。',true],
    ['click',"click(target, button='left', count=1, interval=0.12, hold=0, timeout=5)",'点击控件或坐标。支持左右键、次数、间隔和按住时间。',true],
    ['drag',"drag(start, end, duration=1, timeout=5, path=None, button='left')",'在两个控件或坐标之间拖动，可指定轨迹和鼠标按钮。',true],
    ['scroll',"scroll(target, amount=-3, axis='vertical', timeout=5)",'在控件位置滚动。负数向下，正数向上。',true],
    ['key','key(keys)','发送按键或组合键，例如 "ENTER"、"CTRL+A"。',true],
    ['key_down','key_down(keys)','按住指定按键；与 key_up 配合使用。',true],
    ['key_up','key_up(keys)','松开指定按键。',true],
    ['text','text(text)','向当前目标窗口输入文本。输入前先聚焦目标输入框。',true],
    ['sleep','sleep(seconds)','等待指定秒数，支持停止按钮和 F12 中止。',true],
    ['assert_image','assert_image(target, timeout=5)','等待并断言图片或 OCR 控件出现；超时则失败。',true],
    ['assert_absent','assert_absent(target, timeout=5)','在指定时段内断言图片或 OCR 控件持续不存在。',true],
    ['screenshot','screenshot()','保存目标窗口截图到报告目录，返回文件路径。',false],
    ['capture','capture()','获取目标窗口截图，返回 PIL.Image.Image。',false],
  ].map(([name,signature,description,hasArguments])=>({name,signature,description,hasArguments}));

  function inCode(text){
    let quote='',triple=false,comment=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(comment){if(c==='\n')comment=false;continue;}
      if(quote){
        if(c==='\\'){i++;continue;}
        if(c===quote){if(!triple)quote='';else if(text.slice(i,i+3)===quote.repeat(3)){quote='';i+=2;}}
      }else if(c==='#')comment=true;
      else if(c==='"'||c==="'"){quote=c;triple=text.slice(i,i+3)===c.repeat(3);if(triple)i+=2;}
    }
    return !quote&&!comment;
  }
  function context(value,cursor,selectionEnd=cursor){
    if(cursor!==selectionEnd)return null;
    const before=value.slice(0,cursor),match=/(?:^|[^\p{L}\p{N}_.$])window\.([A-Za-z_]*)$/u.exec(before);
    if(!match||!inCode(before))return null;
    const prefix=match[1],tail=/^[A-Za-z_\d]*/.exec(value.slice(cursor))[0];
    return {prefix,start:cursor-prefix.length,end:cursor+tail.length};
  }
  function suggestions(prefix){return methods.filter(item=>item.name.startsWith(prefix));}
  function edit(value,position,item){
    const existingCall=/^\s*\(/.test(value.slice(position.end));
    const insert=item.name+(existingCall?'':'()');
    const selectionStart=position.start+item.name.length+(existingCall?0:item.hasArguments?1:2);
    return {value:value.slice(0,position.start)+insert+value.slice(position.end),selectionStart,selectionEnd:selectionStart};
  }
  return {context,suggestions,edit,methods};
})();

if(typeof module!=='undefined')module.exports=PythonCompletion;

if(typeof document!=='undefined')(()=>{
  let active=null;
  function editable(editor){return editor?.matches?.('textarea.python-editor')&&!editor.disabled&&!editor.readOnly;}
  function close(){
    if(active){active.popup.remove();active.editor.removeAttribute('aria-controls');active.editor.removeAttribute('aria-expanded');active.editor.removeAttribute('aria-activedescendant');active=null;}
  }
  function escape(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function caretPoint(editor){
    const mirror=document.createElement('div'),style=getComputedStyle(editor),rect=editor.getBoundingClientRect();
    for(const key of ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','textTransform','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','boxSizing','tabSize'])mirror.style[key]=style[key];
    Object.assign(mirror.style,{position:'fixed',visibility:'hidden',left:'-10000px',top:'0',whiteSpace:style.whiteSpace,overflowWrap:style.overflowWrap,wordBreak:style.wordBreak,width:rect.width+'px',borderStyle:'solid'});
    mirror.style.width=(editor.clientWidth+parseFloat(style.borderLeftWidth)+parseFloat(style.borderRightWidth))+'px';
    mirror.textContent=editor.value.slice(0,editor.selectionStart);
    const marker=document.createElement('span');marker.textContent=editor.value.slice(editor.selectionStart)||'.';mirror.append(marker);document.body.append(mirror);
    const point={left:rect.left+marker.offsetLeft-editor.scrollLeft,top:rect.top+marker.offsetTop-editor.scrollTop,height:parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.6};
    mirror.remove();return point;
  }
  function paint(){
    if(!active)return;
    const {popup,items,index,editor}=active,item=items[index];
    popup.innerHTML=`<div class="python-completion-heading">window · 可用函数 <span>${items.length}</span></div><div class="python-completion-items" role="listbox" aria-label="window 可用函数">${items.map((row,i)=>`<button type="button" role="option" id="python-completion-${i}" aria-selected="${i===index}" class="${i===index?'active':''}" data-completion-index="${i}"><span class="completion-function">ƒ</span><code>${escape(row.name)}</code><small>函数</small></button>`).join('')}</div><div class="python-completion-detail"><code>window.${escape(item.signature)}</code><p>${escape(item.description)}</p><small>↑ ↓ 选择 · Enter / Tab 插入 · Esc 关闭</small></div>`;
    editor.setAttribute('aria-activedescendant','python-completion-'+index);
    const point=caretPoint(editor),rect=editor.getBoundingClientRect();
    popup.style.maxWidth=Math.min(520,innerWidth-24)+'px';
    popup.style.left=Math.max(12,Math.min(point.left,innerWidth-popup.offsetWidth-12))+'px';
    let top=point.top+point.height+5;
    if(top+popup.offsetHeight>innerHeight-12)top=Math.max(12,point.top-popup.offsetHeight-5);
    popup.style.top=Math.min(Math.max(12,top),innerHeight-popup.offsetHeight-12)+'px';
    if(point.top<rect.top-2||point.top>rect.bottom){close();return;}
    popup.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});
  }
  function update(editor){
    if(!editable(editor)){close();return;}
    const position=PythonCompletion.context(editor.value,editor.selectionStart,editor.selectionEnd),items=position?PythonCompletion.suggestions(position.prefix):[];
    if(!items.length){close();return;}
    const previous=active?.editor===editor?active.items[active.index]?.name:null;
    if(active?.editor!==editor)close();
    if(!active){
      const popup=document.createElement('div');popup.className='python-completion';popup.id='python-completion';
      // A dialog's top layer is above body children, so append within that dialog.
      (editor.closest('dialog')||document.body).append(popup);
      active={editor,popup};editor.setAttribute('aria-controls',popup.id);editor.setAttribute('aria-expanded','true');
    }
    Object.assign(active,{position,items,index:Math.max(0,items.findIndex(row=>row.name===previous))});paint();
  }
  function accept(){
    if(!active||!editable(active.editor)){close();return;}
    const {editor,position,items,index}=active;
    const current=PythonCompletion.context(editor.value,editor.selectionStart,editor.selectionEnd);
    if(!current||current.start!==position.start||current.end!==position.end){close();return;}
    const before=editor.value,result=PythonCompletion.edit(before,current,items[index]);close();
    const insertion=result.value.slice(current.start,current.start+result.value.length-before.length+current.end-current.start);
    editor.focus();editor.setSelectionRange(current.start,current.end);
    // Chromium's native insertion retains undo history for both completion and earlier typing.
    const inserted=document.execCommand('insertText',false,insertion);
    if(!inserted){editor.setRangeText(insertion,current.start,current.end,'end');editor.dispatchEvent(new Event('input',{bubbles:true}));}
    editor.setSelectionRange(result.selectionStart,result.selectionEnd);close();
  }
  document.addEventListener('input',event=>{if(event.target.matches?.('textarea.python-editor')){if(event.isComposing){close();return;}update(event.target);}});
  document.addEventListener('keydown',event=>{
    const editor=event.target;if(!editable(editor)){if(active)close();return;}
    if(event.isComposing){close();return;}
    if(event.ctrlKey&&!event.altKey&&!event.metaKey&&(event.code==='Space'||event.key===' ')){
      event.preventDefault();event.stopImmediatePropagation();update(editor);return;
    }
    if(active?.editor!==editor)return;
    if(['ArrowDown','ArrowUp','Enter','Tab','Escape'].includes(event.key)){
      event.preventDefault();event.stopImmediatePropagation();
      if(event.key==='Escape'){close();return;}
      if(event.key==='Enter'||event.key==='Tab'){accept();return;}
      active.index=(active.index+(event.key==='ArrowDown'?1:-1)+active.items.length)%active.items.length;paint();
    }else if(['ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key))close();
  },true);
  document.addEventListener('pointerdown',event=>{
    if(!active)return;
    const item=event.target.closest?.('[data-completion-index]');
    if(item&&active.popup.contains(item)){event.preventDefault();active.index=Number(item.dataset.completionIndex);accept();return;}
    close();
  },true);
  document.addEventListener('focusout',event=>{if(active?.editor===event.target)close();});
  document.addEventListener('scroll',event=>{if(active&&!active.popup.contains(event.target))close();},true);
  document.addEventListener('selectionchange',()=>{
    if(active&&(document.activeElement!==active.editor||!PythonCompletion.context(active.editor.value,active.editor.selectionStart,active.editor.selectionEnd)))close();
  });
  document.addEventListener('close',close,true);
  new MutationObserver(()=>{if(active&&(!active.editor.isConnected||!editable(active.editor)))close();}).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly']});
  globalThis.addEventListener('resize',close);
})();
