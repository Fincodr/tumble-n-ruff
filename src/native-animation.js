// Same eighth-frame counter and loop/done words as $4EE8C.
export function setAnimation(object,address,counter=0) {
  object.anim=address;object.animCounter=counter;object.animDone=false;
}
export function advanceAnimation(object,steps) {
  object.animDone=false;
  if(!object.anim)return;
  for(let guard=0;guard<8;guard++) {
    const step=steps[object.anim+((object.animCounter||0)>>3)*4];
    if(!step) {object.parts=[];object.animationMissing=true;return;}
    if(step.loop!==undefined) {object.animCounter=step.loop*8;continue;}
    object.parts=step.parts;
    object.animDone=!!(step.flags&32)&&!(object.animCounter&7);
    object.animCounter+=step.flags&15;
    return;
  }
  throw new Error(`Animation loop without a frame at ${object.anim.toString(16)}`);
}
