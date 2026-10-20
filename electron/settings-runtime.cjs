// Helpers kept free of Electron so persistence and display recovery can be tested.
function visibleBounds(saved,displays){
  if(!saved||!['x','y','width','height'].every(key=>Number.isFinite(saved[key]))||saved.width<1120||saved.height<740||saved.width>10000||saved.height>10000)return null;
  const display=displays.find(({workArea:r})=>Math.min(saved.x+saved.width,r.x+r.width)-Math.max(saved.x,r.x)>=200&&Math.min(saved.y+saved.height,r.y+r.height)-Math.max(saved.y,r.y)>=100);
  if(!display)return null;
  const r=display.workArea,width=Math.max(1120,Math.min(saved.width,r.width)),height=Math.max(740,Math.min(saved.height,r.height));
  return {x:Math.max(r.x,Math.min(saved.x,r.x+r.width-width)),y:Math.max(r.y,Math.min(saved.y,r.y+r.height-height)),width,height};
}
module.exports={visibleBounds};
