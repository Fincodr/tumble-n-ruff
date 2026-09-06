import {overlaps,playerBox} from './weapons.js';
import {setAnimation,advanceAnimation} from './native-animation.js';
import {worldProfile,updateWorldEnemy} from './world-enemies.js';
import {BOSS_TYPES,updateBoss,updateBossHelper,damageBoss} from './bosses.js';
import {updateGyro,updateGunwasp,updateHeavyTinhead,updateLightTinhead,
  updateBombot,updateGatling,updateBee,updateBeeLauncher,updateCrusher,updateForestGenerator} from './forest-enemies.js';
const px=v=>Math.trunc(v/32), sign=v=>v<0?-1:1;
const word=(bytes,at)=>(bytes[at]<<8)|bytes[at+1];
const signed=(bytes,at)=>(word(bytes,at)<<16)>>16;
const SPAWNERS=new Map([[0x92,0x89],[0x94,0x89],[0x96,0x89],[0x93,0x8b],[0x95,0x8b],[0x97,0x8b],[0x99,0x98],[0x9a,0x98],[0x9b,0x98]]);
export const LEVEL_TYPES=new Set([0x40,0x41,0x43,0x44,0x45,0x46,0x47,0x49,0x4a,0x4b,0x4d,0x4e,0x4f,0x52,0x53,0x55,0x5a,0x5b,0x5c,0x5d,0x5e]);
export const SUPPORTED_TYPES=new Set([...LEVEL_TYPES,0x80,0x81,0x82,0x83,0x85,0x89,0x8b,0x8c,0x8d,0x8e,0x98,0x9c,0x9d,0x9e,0x9f,...SPAWNERS.keys()]);

export function createEntity(record) {
  const b=record.bytes||Array(62).fill(0);
  return {...record,bytes:b,originX:record.x,originY:record.y,vx:0,vy:0,state:0,
    active:record.kind===2,dead:false,parts:[],anim:0,animCounter:0,animDone:false,
    timer:0,age:0,hitFlash:0,shootable:false,box:{x:-8,y:-28,w:16,h:26},
    activation:word(b,10),despawn:word(b,16),deathFlag:word(b,18),respawns:b[14],
    rangeLeft:signed(b,26),rangeRight:signed(b,28),rangeUp:signed(b,30),rangeDown:signed(b,32),
    remaining:Math.max(1,signed(b,34)),template:record};
}
export function entityBox(e) {return {x:e.x+e.box.x,y:e.y+e.box.y,w:e.box.w,h:e.box.h};}
function visible(game,e) {
  const dx=e.x-game.camera.x,dy=e.y-game.camera.y;
  return dx>=-64&&dx<528&&dy>=-96&&dy<400;
}
function condition(game,value){return value!==0&&game.flags[value>>8]>=(value&255);}

export function groundMove(game,e,{ledges=true}={}) {
  const oldY=e.y;
  e.y+=px(e.vy);e.x+=px(e.vx);
  let wall=false,landed=false;
  const side=sign(e.vx),edge=e.x+side*8;
  if(e.vx&&[-8,-24].some(oy=>game.level.collision.wall[game.typeAt(edge,e.y+oy)])) {
    e.x=(edge&~15)+(side<0?24:-8);e.vx=0;wall=true;
  }
  if(e.vy>=0) {
    for(const dy of [-8,0,8]) {
      const y=e.y+dy,type=game.typeAt(e.x,y),heights=game.level.collision.heights[type];
      if(!game.level.collision.floor[type]||!heights)continue;
      const floor=(y&~15)+heights[e.x&15];
      if(floor<=e.y+4&&floor>=oldY-12) {e.y=floor;e.vy=0;landed=true;break;}
    }
  }
  let ledge=false;
  if(ledges&&landed&&e.vx) {
    const ahead=e.x+side*12;
    ledge=![0,8,16].some(dy=>game.level.collision.floor[game.typeAt(ahead,e.y+dy)]);
  }
  e.grounded=landed;
  return wall||ledge;
}
export function generator(game,e,profile=null) { // Later-world approximation; Forest uses $4F88C translation.
  if(!e.state){e.state=1;setAnimation(e,profile?.anim||(SPAWNERS.get(e.subtype)===0x98?0x50bc0:0x5081c));}
  if(e.child&&!e.child.dead)return;
  if(e.child&&(Math.abs(game.player.x-e.x)<=Math.abs(e.rangeLeft)&&Math.abs(game.player.y-e.y)<=Math.abs(e.rangeRight)))return;
  if(e.remaining<=0)return;
  if(e.state===1&&Math.abs(game.player.x-e.x)>=16){e.state=2;e.animCounter=8;}
  if(e.state===2&&e.animDone&&game.entities.filter(x=>!x.dead).length<128) {
    const record={...e.template,id:game.nextEntityId++,subtype:profile?.child||SPAWNERS.get(e.subtype),kind:2,x:e.x,y:e.y,bytes:Array(62).fill(0)};
    e.child=createEntity(record);game.entities.push(e.child);e.remaining--;e.state=1;
    if(!e.remaining) {
      const tx=e.x>>4,ty=e.y>>4;
      for(let dx=-1;dx<=0;dx++){const index=ty*game.level.width+tx+dx;if(index>=0&&index<game.cells.length)game.cells[index]=(game.cells[index]&0x7c00)+(dx===-1?0x54:0x55);}
      e.dead=true;e.parts=[];
    } else setAnimation(e,e.anim);
  }
}

export function initEntities(game) {
  game.entities=(game.level.objects||[]).map(createEntity);
  game.nextEntityId=game.entities.length;
  game.nextGeneratorFlag=0x80;
  game.mineSmokeCounter=0;
  const world=game.level.worldNumber||1;
  game.unsupportedTypes=[...new Set(game.entities.filter(e=>!(LEVEL_TYPES.has(e.subtype)||e.subtype===BOSS_TYPES[world]||(world===1?SUPPORTED_TYPES.has(e.subtype):worldProfile(world,e.subtype)))).map(e=>e.subtype))];
}

export function updateEntities(game) {
  const initial=[...game.entities];
  for(const e of initial) {
    const inView=visible(game,e);
    if(e.transient&&(e.x-game.camera.x< -64||e.x-game.camera.x>=464||e.y-game.camera.y< -96||e.y-game.camera.y>=304)) {
      e.dead=true;e.shootable=false;e.parts=[];continue;
    }
    if(e.dead) {
      if(e.respawns&&!inView) {const count=e.respawns-1;Object.assign(e,createEntity(e.template));e.respawns=count;}
      continue;
    }
    if(!e.active) {
      const b=e.bytes;
      if(!(inView&&(b[8]||b[9]||e.kind===2)||condition(game,e.activation)))continue;
      e.active=true;
    }
    if(e.despawn&&condition(game,e.despawn)){e.active=false;continue;}
    if(!inView&&e.subtype>=0x80&&!e.boss)continue;
    e.age++;if(e.hitFlash&&!e.nativeFlashTiming)e.hitFlash--;
    const world=game.level.worldNumber||1;
    if(e.bossHelper)updateBossHelper(game,e);
    else if(e.subtype===BOSS_TYPES[world])updateBoss(game,e);
    else if(e.subtype<0x80)game.updateLevelObject(e);
    else if(world>1) {const profile=worldProfile(world,e.subtype);if(profile)updateWorldEnemy(game,e,profile);}
    else if(SPAWNERS.has(e.subtype))updateForestGenerator(game,e,SPAWNERS.get(e.subtype));
    else if([0x83,0x9c,0x9d].includes(e.subtype))updateGunwasp(game,e);
    else if(e.subtype===0x98)updateGyro(game,e);
    else if(e.subtype===0x89)updateHeavyTinhead(game,e);
    else if([0x8b,0x9e].includes(e.subtype))updateLightTinhead(game,e);
    else if([0x80,0x81,0x82].includes(e.subtype))updateBombot(game,e);
    else if(e.subtype===0x85)updateGatling(game,e);
    else if(e.subtype===0x8d)updateBeeLauncher(game,e);
    else if(e.subtype===0x8c)updateBee(game,e);
    else if(e.subtype===0x9f)updateCrusher(game,e);
    else if(e.subtype<0x80)game.updateLevelObject(e);
    advanceAnimation(e,game.level.bobSteps||{});
    if(e.nativeFlashTiming&&e.hitFlash)e.hitFlash--;
    if((e.contactDamage??(e.shootable||e.hazard))&&!e.dead&&game.player.mode!==3&&overlaps(entityBox(e),playerBox(game.player)))game.hurt();
    if(e.y>game.level.height*16+64)e.dead=true;
  }
}

export function damageEntity(game,e,damage) {
  if(e.dead||!e.shootable)return;
  if(e.boss){damageBoss(game,e);return;}
  e.health=e.nativeHealthByte?(e.health-damage)<<24>>24:e.health-damage;
  if(!e.deferHitFlash)e.hitFlash=4;
  if(e.deferDamage){e.pendingHit=true;return;}
  if(e.hitSound)game.sound(e.hitSound,e.x);
  if(e.health>0) {
    if((game.level.worldNumber||1)===1) {
      if(e.subtype===0x98)e.vx=0;
      if([0x89,0x8b,0x9e].includes(e.subtype))e.pendingHit=true;
    }
    return;
  }
  killEntity(game,e);
}

export function killEntity(game,e) {
  if(e.dead)return;
  e.dead=true;e.shootable=false;e.hazard=false;e.parts=[];
  if(e.deathFlag)game.flags[e.deathFlag>>8]=(game.flags[e.deathFlag>>8]+(e.deathFlag&255))&255;
  if(e.countsAsKill!==false)game.kills++;
  game.score+=e.killScore??100;
  game.effects.push({x:e.x,y:e.y+(e.deathOffsetY??-12),age:0,life:24,kind:'explosion',native:e.deathAnimation??0x5040c});
  if(e.dropOnDeath!==false)game.spawnDrop(e.x,e.y);
  game.events.push('explosion');
  game.sound(e.deathSound??0x3d,e.x,0.9);
}
