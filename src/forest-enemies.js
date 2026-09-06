// Control flow translated from the World 1 overlay; see extracted/code/FOREST_ENEMIES.md.
// Shared entity activation, damage delivery, and drops still belong to the JS engine.
import {setAnimation} from './native-animation.js';
import {createEntity,killEntity} from './entities.js';
const signed=v=>(v<<16)>>16;
const pixels=v=>Math.trunc(v/32);
const face=(x,target)=>target<x?-1:1; // $4F0C2: equality faces right.
const gravity=e=>{if(e.vy<448)e.vy=signed(e.vy+30);};
const animate=(e,left,right)=>setAnimation(e,e.facing<0?left:right);
const distance=(a,b)=>Math.abs(signed(a-b));
const word=(bytes,at)=>(bytes[at]<<8)|bytes[at+1];
const freeSlot=game=>game.entities.filter(e=>!e.dead).length+game.projectiles.length<128;
const moveX=e=>{e.x=signed(e.x+pixels(e.vx));};
const moveY=e=>{e.y=signed(e.y+pixels(e.vy));};

export function floorProbe(game,e) { // $4F2EC / Mines $54736: first recognized probe owns the result.
  for(const oy of [-16,0]) {
    const y=e.y+oy,type=game.typeAt(e.x,y);
    if(oy===-16&&type===2||!game.level.collision.floor[type])continue;
    const floor=(y&~15)+game.level.collision.heights[type][e.x&15];
    return floor&&floor<=e.y?floor:null;
  }
  return null;
}

// $4EFF0/$4F014 clamp against the facing side only, including existing overspeed.
export function nativeAcceleration(velocity,direction,step,limit) {
  const next=signed(velocity+direction*step);
  return direction<0?Math.max(next,-limit):Math.min(next,limit);
}

export function moveGyro(game,e) {moveNativeEnemy(game,e,16);}
export function moveNativeEnemy(game,e,shortBody=0) { // $4F1B8 / Mines $54602; $9B shortens the body.
  e.hit=0;e.grounded=false;
  const dy=pixels(e.vy);e.y=signed(e.y+dy);
  if(dy<0) { // $4F36E: head at y - (33 - $9B), two horizontal probes.
    const head=33-shortBody;
    for(const ox of [-7,7]) {
      if(!game.level.collision.ceiling[game.typeAt(e.x+ox,e.y-head)])continue;
      const y=((e.y-head)&~15)+16+head;
      if(y){e.y=y;e.vy=30;e.vx=0;e.hit|=1;}
      break;
    }
  } else { // $4F2EC: centre probes at y-16 then y; no look-ahead ledge test.
    const floor=floorProbe(game,e);
    if(floor!==null){e.y=floor;e.vy=0;e.hit|=2;e.grounded=true;}
  }
  const dx=pixels(e.vx);e.x=signed(e.x+dx);
  if(dx) { // $4F23E/$4F296: full-height bodies also probe above the chest.
    const side=dx<0?-1:1,edge=e.x+side*8;
    if((shortBody?[-16]:[-16,-32]).some(oy=>game.level.collision.enemyWall[game.typeAt(edge,e.y+oy)])) {
      const x=(edge&~15)+(side<0?24:-8);
      if(x){e.x=x;e.vx=0;e.hit|=side<0?4:8;}
    }
  }
}

function turnGyro(e) { // $55214: keep the old-facing animation for the turn frames.
  e.facing=-e.facing;e.state=5;e.animCounter=72;
}
export function updateGyro(game,e) { // $5511A–$55268, subtype $98.
  e.shootable=true;e.killScore=50;e.box={x:-8,y:-28,w:16,h:26};
  if(e.state!==2&&e.state!==5) {
    e.facing=face(e.x,game.player.x);animate(e,0x50b50,0x50b88);
    e.state=2;e.patrolOrigin=e.x;e.health=2;e.timer=0;
    return; // Native initialization does not integrate movement on this tick.
  }
  if(e.state===5) {
    e.vx=Math.sign(e.vx)*Math.max(0,Math.abs(e.vx)-24);
    gravity(e);moveGyro(game,e);
    if(e.animDone) {
      animate(e,0x50b50,0x50b88);e.state=2;e.vx=0;e.timer=32;
    }
    return;
  }
  let speed=96,range=32;
  if(e.timer)e.timer--;
  else if(Math.abs(signed(e.y-game.player.y))<=32) {
    if(face(e.x,game.player.x)!==e.facing){turnGyro(e);return;}
    speed=128;range=160;
  }
  e.vx=nativeAcceleration(e.vx,e.facing,8,speed);
  gravity(e);moveGyro(game,e);
  if(e.timer)return;
  if(e.hit&12){turnGyro(e);return;}
  if(Math.abs(signed(e.patrolOrigin-e.x))>=range&&face(e.x,e.patrolOrigin)!==e.facing)turnGyro(e);
}

function waspShot(game,e) { // $5473E: muzzle ±10, horizontal speed 256/32, no shot SFX write.
  if(game.entities.filter(entity=>!entity.dead).length+game.projectiles.length>=128)return;
  game.projectiles.push({owner:'enemy',nativeBullet:true,x:signed(e.x+e.facing*10),y:e.y,
    vx:e.facing*8,vy:0,age:0,damage:1,anim:0x50810,animCounter:0,parts:[]});
}
export function updateGunwasp(game,e) { // $545EC–$5478C, subtypes $83/$9C/$9D.
  e.shootable=true;e.killScore=50;e.box={x:-12,y:-32,w:24,h:30};
  if(e.state!==1&&e.state!==2) {
    e.state=1;
    e.flightBounds={left:signed(e.x-e.rangeLeft),right:signed(e.x+e.rangeRight),
      top:signed(e.y-e.rangeUp),bottom:signed(e.y+e.rangeDown)};
    e.facing=face(e.x,game.player.x);animate(e,0x505fc,0x50638);
    // $2A is the independent firing timer, initially zero in the native record.
    e.timer=(e.bytes[42]<<24|e.bytes[43]<<16)>>16;
  }
  if(e.state===2) {
    if(e.animDone) {
      const dx=Math.abs(signed(e.x-game.player.x)),dy=Math.abs(signed(e.y-game.player.y));
      e.timer=((dx+dy)&65535)>>>2;e.timer+=8;
      waspShot(game,e);e.state=1;
    }
    return;
  }
  if(e.animDone) {
    e.facing=face(e.x,game.player.x);
    const animation=e.facing<0?0x505fc:0x50638;
    if(e.anim!==animation)setAnimation(e,animation);
  }
  const below=signed(game.player.y-10-e.y)>=0;
  const direction=below?1:-1;
  e.vy=nativeAcceleration(e.vy,direction,below?32:16,below?128:32);
  const bounds=e.flightBounds;
  let verticalDistance;
  if(e.vy<0?e.y<bounds.top:e.y>bounds.bottom) {
    // $5470A deliberately toggles the low Y bit, retaining velocity and d3=±1.
    e.y^=1;verticalDistance=direction;
  } else {
    e.y=signed(e.y+pixels(e.vy));
    const dx=Math.abs(signed(e.x-game.player.x));verticalDistance=Math.abs(signed(e.y-game.player.y));
    if(dx>180||verticalDistance>=24)return;
  }
  const boundary=e.facing<0?bounds.left:bounds.right;
  if(e.x!==boundary){e.x=signed(e.x+e.facing);return;}
  if(verticalDistance>12)return;
  e.timer=signed(e.timer-1);
  if(e.timer>=0)return;
  e.animDone=false;e.animCounter=72;e.state=2;
}

const friction=(e,amount)=>{e.vx=signed(Math.sign(e.vx)*Math.max(0,Math.abs(e.vx)-amount));};
function tinheadWalk(e) { // $54852; animation pointer writes also clear hit flash.
  if(e.subtype===0x89)animate(e,0x509c4,0x509e8);
  else animate(e,0x50868,0x5088c);
  e.hitFlash=0;e.state=2;
  if(e.subtype===0x9e){animate(e,0x508b0,0x508d4);e.state=3;e.timer=0;}
}
function tinheadAttack(game,e) { // $548BE/$54B4C: face Ruff and select the attack.
  e.facing=face(e.x,game.player.x);
  if(e.subtype===0x89)animate(e,0x50a0c,0x50a28);
  else animate(e,0x508b0,0x508d4);
  e.hitFlash=0;e.state=3;e.timer=0;
}
function tinheadHit(game,e) {
  if((e.health&3)===0) { // $54988: tumble on remaining health divisible by four.
    e.facing=face(e.x,game.player.x);
    if(e.subtype===0x89)animate(e,0x50a84,0x50ab8);
    else animate(e,0x508f8,0x50928);
    e.state=10;e.vy=-128;e.vx=e.facing<0?192:-161;
  } else { // $549B8: preserve facing and freeze the current pose while sliding.
    game.sound(0x52,e.x);e.savedAnimCounter=e.animCounter;e.hitFlash=4;
    e.vy=0;e.vx=e.facing<0?64:-64;e.state=11;e.animDone=false;
  }
}
export function updateHeavyTinhead(game,e) {updateTinhead(game,e);}
export function updateLightTinhead(game,e) {updateTinhead(game,e);}
function updateTinhead(game,e) { // $547BA/$54A44; common movement and hit helpers.
  const heavy=e.subtype===0x89;
  e.shootable=true;e.killScore=heavy?250:100;e.deathAnimation=0x503e8;e.deathOffsetY=0;
  e.box={x:-8,y:-30,w:16,h:28};
  if(![2,3,5,10,11].includes(e.state)) {
    e.health=8;e.facing=face(e.x,game.player.x);
    e.pendingHit=false;tinheadWalk(e);return;
  }
  // $547C2/$547CA dispatch hit states before looking at the incoming hit flag.
  if(e.pendingHit&&e.state!==10&&e.state!==11)tinheadHit(game,e);
  e.pendingHit=false;
  if(e.state===10) { // $548F2/$549EA: no collision box until the tumble marker.
    if(e.animDone){tinheadWalk(e);e.hitFlash=10;return;}
    e.shootable=false;e.hitFlash=0;friction(e,9);gravity(e);moveNativeEnemy(game,e);
    if(e.hit&2)e.vy=(-Math.abs(e.vx))>>1;
    return;
  }
  if(e.state===11) { // $5490A: test velocity before friction, without gravity.
    e.animCounter=e.savedAnimCounter;
    if(!e.vx){tinheadAttack(game,e);return;}
    friction(e,16);moveNativeEnemy(game,e);return;
  }
  if(e.state===5){if(e.animDone)tinheadWalk(e);return;}
  if(e.state===3) {
    if(!heavy) { // $54B6E: call the walk state, then reconsider facing at its marker.
      tinheadStep(game,e);
      if(e.animDone&&distance(e.x,game.player.x)>=64) {
        const facing=face(e.x,game.player.x);
        if(facing!==e.facing)tinheadAttack(game,e);
      }
      return; // No projectile allocation anywhere in the light Tinhead routine.
    }
    if(e.animDone) { // $54934; same $4F510 shot controller as the Gunwasp.
      nativeShot(game,e,-7);
    } else if(e.animCounter===48)tinheadWalk(e);
    return;
  }
  tinheadStep(game,e);
}
function tinheadStep(game,e) {
  // $4F498 accepts inclusive 100×16 range only when already facing Ruff.
  if(e.animDone&&Math.abs(signed(e.x-game.player.x))<=100&&
    Math.abs(signed(e.y-game.player.y))<=16&&face(e.x,game.player.x)===e.facing) {
    tinheadAttack(game,e);return;
  }
  // $4F470: walk four pixels only on counter multiples of eight; no ledge test.
  e.vx=(e.animCounter&7)?0:e.facing*128;gravity(e);moveNativeEnemy(game,e);
  if(e.hit&12) {
    e.facing=-e.facing;
    if(e.subtype===0x89)animate(e,0x50a64,0x50a44);
    else animate(e,0x50958,0x5096c);
    e.hitFlash=0;e.state=5;
  }
}

function spawnChild(game,parent,subtype,kind=4) {
  if(!freeSlot(game))return null;
  const child=createEntity({id:game.nextEntityId++,kind,subtype,x:parent.x,y:parent.y,
    health:1,facing:1,bytes:Array(62).fill(0)});
  child.active=true;child.transient=kind===4;game.entities.push(child);return child;
}
function changeFacingAnimation(e,left,right) { // $4EF86: preserve hit flash.
  const animation=e.facing<0?left:right;
  if(e.anim!==animation)setAnimation(e,animation);
}
function pairFacingAnimation(e,left,right) { // $4EF68: preserve counter within pair.
  if(e.anim!==left&&e.anim!==right)e.animCounter=0;
  e.anim=e.facing<0?left:right;e.hitFlash=0;
}
function nativeShot(game,e,yOffset) { // $54F6E / $54934.
  if(!freeSlot(game))return null;
  const shot={owner:'enemy',nativeBullet:true,x:signed(e.x+(e.facing<0?-14:12)),
    y:signed(e.y+yOffset),vx:e.facing*9,vy:0,age:0,damage:1,
    anim:e.facing<0?0x50aec:0x50af8,animCounter:0,parts:[]};
  game.projectiles.push(shot);return shot;
}

export function updateGatling(game,e) { // $54E34–$54FBE, subtype $85.
  e.shootable=true;e.killScore=250;e.hitSound=0x43;
  e.deathAnimation=0x503e8;e.deathOffsetY=0;e.box={x:-14,y:-33,w:28,h:32};
  if(![1,2,3,4,5].includes(e.state))e.health=12;
  if(e.state===2) {
    if(distance(e.y,game.player.y)>16||distance(e.x,game.player.x)>160)return;
    e.facing=face(e.x,game.player.x);animate(e,0x50674,0x506b0);
    e.hitFlash=0;e.animCounter=8;e.state=3;e.timer=0;e.burst=2;return;
  }
  if(e.state===3) {
    if(distance(e.y,game.player.y)>32||distance(e.x,game.player.x)>=180) {
      e.animCounter=80;e.state=2;return;
    }
    if(!e.animDone||++e.timer<4)return;
    e.animCounter=64;e.timer=0;nativeShot(game,e,-25);
    if(--e.burst<0){animate(e,0x506ec,0x5073c);e.hitFlash=0;e.state=4;}
    return;
  }
  if(e.state===4) {
    if(e.animDone) {
      const shot=nativeShot(game,e,-25);if(shot)shot.y=signed(shot.y+12);
      e.state=5;
    }
    return;
  }
  if(e.state===5){if(e.animDone)e.state=1;return;}
  e.facing=face(e.x,game.player.x);pairFacingAnimation(e,0x50674,0x506b0);e.state=2;
}

function bombotWalk(game,e) { // $54D22; facing changes reset the sequence only if needed.
  e.facing=face(e.x,game.player.x);changeFacingAnimation(e,0x5079c,0x507c4);e.state=1;
}
function explodeBombot(game,e) { // $54CC4: three ballistic sparks, no radial damage test.
  for(const [vx,vy] of [[128,-384],[-128,-384],[0,-448]]) {
    if(!freeSlot(game))break;
    game.projectiles.push({owner:'enemy',nativeArc:true,x:e.x,y:e.y,vx,vy,age:0,
      damage:1,anim:0x50810,animCounter:0,parts:[]});
  }
  killEntity(game,e);
}
export function updateBombot(game,e) { // $54BD2/$54C76/$54CBE: mother, buried, walking.
  e.shootable=false;e.hazard=false;e.killScore=0;e.dropOnDeath=false;
  e.deathAnimation=0x50430;e.deathOffsetY=0;e.deathSound=0x3e;
  if(e.subtype===0x81) {
    if(e.state===1) {
      if(distance(e.x,game.player.x)<=80){e.animCounter=8;e.state=2;}
    } else if(e.state===2) {
      if(e.animDone){e.subtype=0x80;e.state=0;}
    } else {setAnimation(e,0x507ec);e.state=1;}
    return;
  }
  e.deferDamage=true;e.nativeFlashTiming=true;
  if(e.subtype===0x82) { // Mother Bombot: exact LIST-flag match or proximity below Ruff.
    e.shootable=true;e.box={x:-12,y:-30,w:24,h:26};
    const hit=e.pendingHit;
    if(hit){e.pendingHit=false;e.hitFlash=4;game.sound(0x43,e.x);}
    if(hit&&e.health<=0||e.state===2&&!e.hitFlash) {
      killEntity(game,e);
      for(const [vx,counter] of [[0,0],[64,8],[-64,16]]) {
        const child=spawnChild(game,e,0x80);if(!child)continue;
        child.y=signed(child.y+10);child.vx=vx;child.vy=-256;child.state=3;
        setAnimation(child,0x50790,counter);
      }
      return;
    }
    if(e.state===1) {
      const flag=word(e.bytes,24);
      if(flag?game.flags[flag>>8]===(flag&255):signed(e.y-game.player.y)>=0&&distance(e.x,game.player.x)<60) {
        e.state=2;e.hitFlash=16;e.shootable=false; // $54C28 returns before box registration.
      }
    } else if(e.state!==2){setAnimation(e,0x5078c);e.state=1;e.health=4;e.shootable=false;}
    return;
  }
  e.box={x:-8,y:-14,w:16,h:12};
  if(e.pendingHit){e.pendingHit=false;explodeBombot(game,e);return;}
  if(e.state===2) {
    e.animCounter=16;
    if(distance(e.x,game.player.x)>80){bombotWalk(game,e);e.shootable=true;}
    else if(!e.hitFlash)explodeBombot(game,e);
    return;
  }
  e.shootable=true;
  if(e.state===3) { // $54D92: launched children integrate without wall/ceiling probes.
    gravity(e);moveX(e);moveY(e);
    if(e.vy>=0&&floorProbe(game,e)!==null){e.vy=0;bombotWalk(game,e);}
    return;
  }
  if(e.state!==1){e.health=1;bombotWalk(game,e);return;}
  e.vx=(e.animCounter&7)?0:e.facing*64;gravity(e);moveNativeEnemy(game,e);
  const dx=distance(e.x,game.player.x),dy=distance(e.y,game.player.y);
  if(dx>100){bombotWalk(game,e);return;}
  if(dx<80&&(game.level.id===7||dy<=32)) {
    e.state=2;e.timer=0;e.hitFlash=10;e.animCounter=80;e.shootable=false;return;
  }
  if(e.hit&12){e.facing=-e.facing;changeFacingAnimation(e,0x5079c,0x507c4);}
}

export function updateBeeLauncher(game,e) { // $543EA–$5447A, subtype $8D.
  e.shootable=true;e.killScore=50;e.countsAsKill=false;e.hitSound=0x43;
  e.nativeFlashTiming=true;e.deathAnimation=0x50430;e.deathOffsetY=8;e.deathSound=0x3e;
  e.box={x:-14,y:-30,w:28,h:30};
  if(e.state===1) {
    if(distance(e.y,game.player.y)>=100){e.animCounter=0;return;}
    if(e.animDone){e.hitFlash=10;e.state=2;}
  } else if(e.state===2) {
    if(!e.hitFlash){e.state=1;spawnChild(game,e,0x8c);}
  } else {setAnimation(e,0x50b04);e.state=1;e.health=3;}
}
export function updateBee(game,e) { // $5447A–$545A0, subtype $8C.
  e.shootable=true;e.killScore=0;e.dropOnDeath=false;e.hitSound=0x43;
  e.deathAnimation=0x50430;e.deathOffsetY=8;e.deathSound=0x3e;
  e.box={x:-8,y:-12,w:16,h:8};
  if(e.state===1){if(distance(e.x,game.player.x)<=200)e.state=2;return;}
  if(e.state===3) {
    e.timer=signed(e.timer-1);
    if(e.timer<0){e.state=4;e.vx=0;e.vy=0;}
    return;
  }
  if(e.state===4) {
    e.vx=nativeAcceleration(e.vx,e.facing,24,128);e.vy=signed(e.vy+20);
    moveY(e);moveX(e);return;
  }
  if(e.state===2) {
    e.facing=face(e.x,game.player.x);
    const dy=signed(e.y-game.player.y);
    if(distance(e.x,game.player.x)<=40&&dy<0&&dy>=-60) {
      animate(e,0x50b20,0x50b38);e.hitFlash=0;e.animCounter=24;e.timer=4;e.state=3;return;
    }
    const direction=signed(game.player.y-50-e.y)<0?-1:1;
    e.vy=nativeAcceleration(e.vy,direction,12,64);e.vx=nativeAcceleration(e.vx,e.facing,4,64);
    // $5457E–$5458E deliberately integrates twice, reducing vy by 2 between steps.
    moveX(e);moveY(e);e.vy=signed(e.vy-2);moveX(e);moveY(e);return;
  }
  e.facing=face(e.x,game.player.x);pairFacingAnimation(e,0x50b20,0x50b38);e.state=1;
}

export function updateCrusher(game,e) { // $5505E–$550F4, subtype $9F.
  e.shootable=false;e.hazard=false;e.box={x:-10,y:-20,w:20,h:18};
  if(e.state!==18&&e.state!==2) {
    setAnimation(e,0x505b8);e.state=18;
    e.left=e.x;e.right=signed(e.x+e.rangeLeft);e.y=signed(e.y-5);e.timer=e.rangeRight;return;
  }
  if(e.state===18) {
    e.timer=signed(e.timer-1);if(e.timer>=0)return;
    e.state=2;e.animCounter=8;
  }
  e.x=signed(e.x+(e.facing<0?4:-4));
  if(e.facing<0?e.x>=e.right:e.x<=e.left) {
    e.facing=-e.facing;e.timer=e.rangeRight;e.state=18;e.animCounter=64;return;
  }
  e.hazard=true;
}

export function updateForestGenerator(game,e,subtype,animation) { // $4F88C / Mines $54CD6 and subtype wrappers.
  e.shootable=false;
  if(![1,2,3].includes(e.state)) {
    setAnimation(e,animation??(subtype===0x98?0x50bc0:subtype===0x89?0x50980:0x5081c));
    e.generatorFlag=game.nextGeneratorFlag;game.nextGeneratorFlag=0x80+((game.nextGeneratorFlag+1)&127);
    e.remaining=signed(word(e.bytes,34));e.generatorCell=(e.y>>4)*game.level.width+(e.x>>4);e.state=1;
  }
  if(e.state===1) {
    if(distance(e.x,game.player.x)>=16){e.state=2;e.animCounter=8;e.animDone=false;game.sound(0x50,e.x);}
    return;
  }
  if(e.state===2) {
    if(!e.animDone)return;
    const child=spawnChild(game,e,subtype,2);if(!child)return;
    child.bytes[12]=child.bytes[13]=2;child.deathFlag=(e.generatorFlag<<8)|255;
    game.flags[e.generatorFlag]=0;e.child=child;e.animDone=false;e.state=3;
    e.remaining=signed(e.remaining-1);
    if(e.remaining<=0) {
      const at=e.generatorCell;
      for(const [offset,tile] of [[0,0x55],[-1,0x54]]) {
        if(at+offset>=0&&at+offset<game.cells.length)game.cells[at+offset]=(game.cells[at+offset]&0x7c00)|tile;
      }
      e.dead=true;e.parts=[];game.score+=250;
      if(e.deathFlag)game.flags[e.deathFlag>>8]=(game.flags[e.deathFlag>>8]+(e.deathFlag&255))&255;
    }
    return;
  }
  if(game.flags[e.generatorFlag]&&(distance(e.x,game.player.x)>e.rangeLeft||distance(e.y,game.player.y)>e.rangeRight))e.state=1;
}
