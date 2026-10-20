window.studio.onEvent(event=>{if(event.kind==='window_pick_hover')document.querySelector('#pick-title').textContent=event.window?.title||'选择目标窗口';});
