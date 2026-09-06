// Sequence words and half-sprite placements come from the original overlay.
// State selection is a first port; animation-lock and scripted transitions remain.
export class PlayerAnimation {
  constructor(sequences) {
    this.sequences=sequences;this.group='stand';this.counter=0;
    this.parts=sequences.standRight[0].parts;
  }

  tick(p) {
    let group='stand';
    if (p.mode===3 || p.mode===4) group='hurt';
    else if(p.inWater&&this.sequences.swimRight)group=p.vx?'swim':'swimIdle';
    else if (p.mode===2) group=p.vy?'climb':'climbIdle';
    else if (p.mode===1) group=p.vy<0?'rise':'fall';
    else if (p.duck) group='duck';
    else if (p.vx && !p.firing) group='run';
    if (group!==this.group) {
      this.counter=group==='rise'?8:0; // $4CC64 skips the standing jump step.
      this.group=group;
    }
    const key=group==='climb'?group:group+(p.facing<0?'Left':'Right');
    const steps=this.sequences[key];
    if (group==='stand') {
      this.parts=steps[p.aim || 0].parts;
      return;
    }
    if (group==='climb') {
      this.counter=(this.counter+(p.vy<0?4:-4)+48)%48;
      this.parts=steps[this.counter>>3].parts;
      return;
    }
    let step=steps[Math.min(steps.length-1,this.counter>>3)];
    if (step.loop!==undefined) {this.counter=step.loop<<3;step=steps[step.loop];}
    this.parts=step.parts;
    // The low nibble advances eighths of a frame; bit 6 selects walk/run speed.
    this.counter+=step.flags&64?(Math.abs(p.vx)>=168?4:2):step.flags&15;
  }
}
