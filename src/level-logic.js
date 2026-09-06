import {overlaps,playerBox,equipWeapon} from './weapons.js';
import {setAnimation,advanceAnimation} from './native-animation.js';
import {groundMove} from './entities.js';
import {pickupSound} from './audio.js';
const word=(bytes,at)=>(bytes[at]<<8)|bytes[at+1];
const DROP_CYCLE=[0,0,0,0,2,1,2,5,4,7,3,6];
const DROP_ANIM=[0x503a0,0x503b4,0x503b8,0x503cc,0x503c8,0x503c4,0x503bc,0x503c0];
const DROP_ITEMS=[0x8009,12,11,9,0x800d,8,0x8008,10];

export function trigger(game,index) {
  for(const entry of game.level.triggers||[])if(entry.cell===index)game.flags[entry.flag]=entry.value;
}
function put(game,x,y,value) {
  if(x>=0&&y>=0&&x<game.level.width&&y<game.level.height)game.cells[y*game.level.width+x]=value;
}
function patch(game,tx,ty,values) {values.forEach((v,i)=>put(game,tx+(i&1),ty+(i>>1),v));}
export function unlockTile(game,index,type) { // $4D4E6 / $4D4F6
  const key=type===25?0:1;
  if(!game.keys[key])return false;
  game.keys[key]--;game.cells[index]=(game.cells[index]&0x83ff)+1;
  trigger(game,index);game.events.push('door');game.sound(0x4d);return true;
}
export function roomTile(game,index) {
  const entry=(game.level.triggers||[]).find(t=>t.cell===index);
  if(entry&&entry.flag!==game.zone){game.zone=entry.flag&7;game.waterLevel=game.level.zones?.[game.zone]?.words[4]||0;}
}
function finishScript(game,e) {
  e.dead=true;
  if(e.deathFlag)game.flags[e.deathFlag>>8]=(game.flags[e.deathFlag>>8]+(e.deathFlag&255))&255;
}

export function updateLevelObject(game,e) {
  const p=game.player,tx=e.x>>4,ty=e.y>>4;
  if(e.subtype===0x40) { // $4F9AE: exit is unlocked by three marble quotas.
    if(game.level.isBoss&&!game.bossDefeated)return;
    if(!e.state){e.state=1;setAnimation(e,0x50368);}
    if(e.state===1&&game.marbles.every(n=>!n)) {
      e.state=2;put(game,tx,ty-3,0x800e);game.events.push('exit-open');
    }
    if(e.state===2&&Math.abs(p.x-e.x)<=80&&Math.abs(p.y-e.y)<=16) {
      e.state=3;e.animCounter=8;
      game.sound(0x4f,e.x);
      const left=tx-1,top=ty-2;
      for(let row=0;row<2;row++)for(let col=0;col<3;col++) {
        const index=(top+row)*game.level.width+left+col;
        if(index>=0&&index<game.cells.length)game.cells[index]=row===0&&col===1?0:game.cells[index]+(row===0&&col===0?6:5);
      }
    }
    if(e.state===3&&Math.abs(p.x-e.x)<=8&&Math.abs(p.y-e.y)<=2) {
      e.state=4;game.exitTimer=25;setAnimation(e,0x5037c);game.events.push('exit');
    }
  } else if(e.subtype===0x41) { // Checkpoint adopts a ZONE spawn record.
    if(p.vy>=0&&overlaps({x:e.x-16,y:e.y-32,w:32,h:32},playerBox(p))) {
      const zone=game.level.zones?.[e.bytes[27]&7];
      if(zone&&(zone.x||zone.y))game.checkpoint={spawn:{x:zone.x,y:zone.y},camera:{x:zone.cameraX,y:zone.cameraY}};
      patch(game,tx-1,ty-2,[38,39,40,41]);e.dead=true;game.events.push('checkpoint');game.sound(0x47,e.x);
    }
  } else if(e.subtype===0x43||e.subtype===0x44) { // $4FB22/$4FBFA vertical/horizontal gates.
    const on=!!game.flags[e.bytes[24]];
    if(!e.state){e.state=1;e.gateOpen=word(e.bytes,26)!==0xffff;e.gateFrame=e.gateOpen?10:0;}
    if(on&&!e.previousTrigger){e.gateOpen=!e.gateOpen;game.sound(e.gateOpen?0x4d:0x4c,e.x);}
    e.previousTrigger=on;
    e.gateFrame=Math.max(0,Math.min(10,e.gateFrame+(e.gateOpen?1:-1)));
    const frames=e.subtype===0x43?[0x8406,0x8406,46,46,47,47,48,48,49,49,0]:
      [0x8407,0x8407,0x432,0x432,0x433,0x433,0x434,0x434,0x435,0x435,0];
    const tile=frames[e.gateFrame];
    for(let offset=0;offset<(e.subtype===0x43?game.level.height-ty:game.level.width-tx);offset++) {
      const index=(ty+(e.subtype===0x43?offset:0))*game.level.width+tx+(e.subtype===0x44?offset:0);
      if((game.cells[index]&1023)===(e.subtype===0x43?55:57))break;
      game.cells[index]=tile;
    }
  } else if(e.subtype===0x45||e.subtype===0x46) {
    const strong=e.subtype===0x45;
    if(e.timer&&!--e.timer)patch(game,tx,ty,strong?[0,0,22,23]:[0,0,16,17]);
    if(p.vy>=0&&overlaps({x:e.x+8,y:e.y,w:16,h:32},playerBox(p))) {
      game.jump();p.vy=strong?-448:-384;p.y=Math.min(p.y,e.y);e.timer=8;
      patch(game,tx,ty,strong?[24,25,26,27]:[18,19,20,21]);
    }
  } else if([0x52,0x53,0x55,0x5a].includes(e.subtype)) {
    // $4FF7C: editor offsets specify a ping-pong path, with endpoint pauses.
    if(!e.state){e.state=1;e.timer=25;e.dx=word(e.bytes,28)<<16>>16;e.dy=word(e.bytes,30)<<16>>16;e.travel=0;e.direction=1;}
    const oldX=e.x,oldY=e.y;
    if(e.timer)e.timer--;
    else {
      const length=Math.max(Math.abs(e.dx),Math.abs(e.dy),1),speed=word(e.bytes,32)>=8?2:Math.max(1,word(e.bytes,32));
      e.travel=Math.max(0,Math.min(length,e.travel+speed*e.direction));
      e.x=e.originX+Math.round(e.dx*e.travel/length);e.y=e.originY+Math.round(e.dy*e.travel/length);
      if(e.travel===0||e.travel===length){e.direction*=-1;e.timer=20;}
    }
    const type=word(e.bytes,26)&15;
    const descriptor=game.level.platformFrames?.[type];
    e.parts=descriptor?.parts||[];
    e.platformWidth=descriptor?.width||32;e.platformX=descriptor?.x??-16;e.platformY=descriptor?.y??-8;
    if(p.vy>=0&&p.x+7>=oldX+e.platformX&&p.x-7<=oldX+e.platformX+e.platformWidth&&p.y>=oldY+e.platformY-2&&p.y<=oldY+e.platformY+8) {
      p.x+=e.x-oldX;p.y=e.y+e.platformY;p.vy=0;p.mode=0;p.onPlatform=e.id;
    }
  } else if(e.subtype===0x47) { // $53FDC: extending spring platform.
    if(!e.state){e.state=1;e.extension=0;}
    const stood=p.vy>=0&&p.x+7>=e.x-16&&p.x-7<=e.x+16&&p.y>=e.y-10&&p.y<=e.y+8;
    const descriptor=game.level.platformFrames?.[word(e.bytes,26)&15];e.parts=descriptor?.parts||[];
    e.platformWidth=32;e.platformX=-16;e.platformY=-8;
    if(e.state===1&&stood)e.state=2;
    else if(e.state===2&&stood) {
      put(game,tx-1,ty+1,0x800f);put(game,tx,ty+1,0x8010);
      e.y-=16;e.extension+=16;p.y=e.y-8;
      if(e.extension>=word(e.bytes,28)){game.jump();p.vy=-512;e.state=3;}
    } else if(e.state===2)e.state=3;
    else if(e.state===3) {
      e.extension=Math.max(0,e.extension-4);e.y=e.originY-e.extension;
      put(game,(e.x-16)>>4,(e.y+16)>>4,0);put(game,e.x>>4,(e.y+16)>>4,0);
      if(!e.extension)e.state=1;
    }
  } else if(e.subtype===0x49||e.subtype===0x4a) { // $540B0/$541A4 falling press and return.
    if(!e.state){e.state=1;e.timer=word(e.bytes,28);e.pressDepth=word(e.bytes,26);}
    e.parts=game.level.platformFrames?.[2]?.parts||[];e.hazard=true;e.box={x:-16,y:-8,w:e.subtype===0x4a?64:32,h:24};
    if(e.state===1&&--e.timer<=0&&Math.abs(p.x-e.x)<80){e.state=2;e.vy=0;}
    if(e.state===2){e.vy=Math.min(480,e.vy+24);e.y+=Math.trunc(e.vy/32);if(e.y>=e.originY+e.pressDepth){e.y=e.originY+e.pressDepth;e.state=3;}}
    else if(e.state===3){e.y=Math.max(e.originY,e.y-2);if(e.y===e.originY){e.state=1;e.timer=word(e.bytes,28);}}
  } else if(e.subtype===0x4b) { // Rising ladder: mark a climbable column until a ceiling.
    if(!e.state){e.state=1;e.buildRow=ty;}
    if(e.age%3===0) {
      if(e.buildRow<0||((game.cell(tx,e.buildRow)>>10)&31)===1){finishScript(game,e);return;}
      put(game,tx,e.buildRow,0xc4a);e.buildRow--;
    }
  } else if([0x4d,0x4e,0x4f,0x96,0x97,0x98].includes(e.subtype)) {
    // Rotating/swinging platforms use editor radius and phase ($53E4E onward).
    if(!e.state){e.state=1;e.angle=word(e.bytes,30);e.angleSpeed=word(e.bytes,32)||2;}
    const radiusWord=word(e.bytes,28),radius=radiusWord&0x8000?radiusWord&0x7fff:(radiusWord+1)*8;
    const oldX=e.x,oldY=e.y;e.angle+=(e.subtype===0x4e||e.subtype===0x97?-1:1)*Math.min(4,e.angleSpeed);
    const angle=e.angle*Math.PI/128;
    e.x=e.originX+Math.round(Math.sin(angle)*radius);e.y=e.originY+Math.round(Math.cos(angle)*radius);
    const descriptor=game.level.platformFrames?.[e.subtype>=0x96?4:word(e.bytes,26)%5];e.parts=descriptor?.parts||[];
    e.platformWidth=descriptor?.width||32;e.platformX=descriptor?.x??-16;e.platformY=descriptor?.y??-8;
    if(p.vy>=0&&p.x+7>=oldX+e.platformX&&p.x-7<=oldX+e.platformX+e.platformWidth&&p.y>=oldY+e.platformY-2&&p.y<=oldY+e.platformY+8){p.x+=e.x-oldX;p.y=e.y+e.platformY;p.vy=0;p.mode=0;}
  } else if(e.subtype>=0x5b&&e.subtype<=0x5e) { // Native timed 1x1 through 4x4 map copies.
    if(!e.state){e.timer=word(e.bytes,30);e.state=1;}
    if(--e.timer<0) {
      const x=word(e.bytes,26),y=word(e.bytes,28);
      const size=e.subtype-0x5a,values=[];
      for(let row=0;row<size;row++)for(let col=0;col<size;col++)values.push(game.cell(x+col,y+row));
      values.forEach((v,i)=>put(game,tx+i%size,ty+Math.floor(i/size),v));
      finishScript(game,e);
    }
  }
}

export function givePickup(game,id) {
  if(id>=0x8000&&id<=0x8002) {
    const color=id-0x8000;game.marbles[color]=Math.max(0,game.marbles[color]-1);game.score++;
    if(!game.marbles[color])for(let i=0;i<game.cells.length;i++)if((game.cells[i]&0x80ff)===id)game.cells[i]=0x8009;
  } else if(id>=0x800a&&id<=0x800c) {
    const color=[0,1,2][id-0x800a];game.marbles[color]=0;
    for(let i=0;i<game.cells.length;i++)if((game.cells[i]&0x80ff)===0x8000+color)game.cells[i]=0x8009;
  } else if(id===0x8009) {
    game.score++;if(++game.coins>=100){game.coins=0;game.lives++;}
  } else if(id===0x8008||id>=0x56&&id<=0x5d)game.lives++;
  else if(id===0x800d){game.maxHealth=Math.min(5*game.healthMultiplier,game.maxHealth+game.healthMultiplier);game.health=game.maxHealth;}
  else if(id===12)game.health=Math.min(game.maxHealth,game.health+game.healthMultiplier);
  else if(id===8||id===10){game.invulnerable=250;if(id===10){game.energy=game.energyCap;game.altEnergy=game.weapon?768:0;}}
  else if(id===14){game.invulnerable=250;game.speedBoost=250;}
  else if(id===11) {
    if(game.weapon)game.altEnergy=Math.min(768,game.altEnergy+128);
    else {game.energyCap=Math.min(768,game.energyCap+192);game.energy=game.energyCap;}
  } else if(id===0x8003||id===0x8004) {
    // $4D594/$4D5A0: pickup order is opposite the RAM key-counter order.
    game.keys[id===0x8004?0:1]++;
  }
  else if(game.level.weaponPickups?.[id]!==undefined)equipWeapon(game,game.level.weaponPickups[id]);
  else if(id===9){game.flags[0x18]=0;game.flags[0x1a]=0;}
  else return false;
  game.events.push('pickup');game.sound(pickupSound(id));return true;
}

export function spawnDrop(game,x,y) {
  game.dropChain=game.tickNumber-game.lastKillTick<=50?(game.dropChain+1)%12:0;
  game.lastKillTick=game.tickNumber;
  const type=DROP_CYCLE[game.dropChain];
  const drop={x,y,vx:0,vy:-384,box:{x:-8,y:-16,w:16,h:16},age:0,life:95,item:DROP_ITEMS[type],bounce:-384};
  setAnimation(drop,DROP_ANIM[type]);game.drops.push(drop);
}
export function updateDrops(game) {
  game.drops=game.drops.filter(drop=> {
    if(++drop.age>=drop.life)return false;
    if(drop.vy<448)drop.vy+=30;groundMove(game,drop,{ledges:false});
    if(drop.grounded){drop.bounce>>=1;drop.vy=drop.bounce;}
    advanceAnimation(drop,game.level.bobSteps||{});
    if(game.player.mode!==3&&overlaps({x:drop.x-8,y:drop.y-16,w:16,h:16},playerBox(game.player))) {givePickup(game,drop.item);return false;}
    return true;
  });
}
