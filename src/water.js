// Browser water cues use the same room water line as swimming physics.
// Colors and ripples are an approximation of the Amiga palette/copper effect.
export function drawWater(renderer,game,cx,cy) {
  const line=game.waterLevel,width=renderer.canvas.width,height=renderer.canvas.height;
  if(!(line>0)||line>=cy+height||line>=game.level.height*16)return;
  const top=Math.max(0,line-cy),bottom=Math.min(height,game.level.height*16-cy);
  if(bottom<=top)return;
  // Apply after the scene so opaque black tiles and submerged sprites are tinted.
  renderer.rect(0,top,width,bottom-top,[0.03,0.38,0.72,0.4]);
  const blocked=(x,y)=> {
    const type=game.typeAt(x,y),collision=game.level.collision;
    return collision.floor[type]||collision.wall[type]||collision.ceiling[type];
  };
  const phase=Math.floor(game.tickNumber/5);
  if(line>=cy) {
    for(let x=Math.floor(cx/8)*8;x<cx+width;x+=8) {
      if(blocked(x+4,line))continue;
      const left=Math.max(0,x-cx),right=Math.min(width,x+8-cx),y=line-cy;
      renderer.rect(left,y,right-left,1,[0.38,0.84,1,0.8]);
      renderer.rect(left,y+1,right-left,3,[0.08,0.6,0.9,0.3]);
      // Highlights move along the fixed physics boundary, without moving it.
      if(((x/8+phase)&3)===0)renderer.rect(left,y,right-left,1,[0.7,0.95,1,0.9]);
    }
  }
  // World-anchored bubbles remain recognizable when the surface is above view.
  for(let column=Math.floor(cx/48);column<=Math.floor((cx+width)/48);column++) {
    const x=column*48+16+(column&1)*9;
    const rise=(Math.floor(game.tickNumber/3)+column*17)&63;
    const first=Math.floor((Math.max(cy,line)-line)/64);
    for(let row=first;row<=Math.floor((cy+bottom-line)/64);row++) {
      const y=line+row*64+63-rise;
      if(x<cx||x+2>cx+width||y<Math.max(cy,line+6)||y+3>cy+bottom||blocked(x,y))continue;
      renderer.rect(x-cx,y-cy,2,1,[0.4,0.8,1,0.45]);
      renderer.rect(x-cx,y-cy+1,1,2,[0.3,0.7,0.95,0.3]);
    }
  }
}
