// Electron geometry uses DIPs; native placement uses physical screen pixels.
function toolbarBounds(game, work) {
  const gap=8;
  const available=work.width-game.width-gap;
  const width=Math.max(300,Math.min(380,available));
  const height=Math.min(work.height,Math.max(600,game.height));
  return {width,height,x:Math.max(work.x,Math.min(game.x+game.width+gap,work.x+work.width-width)),
    y:Math.max(work.y,Math.min(game.y,work.y+work.height-height))};
}
module.exports={toolbarBounds};
