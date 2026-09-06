import {setAnimation} from './native-animation.js';
import {createEntity,groundMove} from './entities.js';
const N=0x1000000;
export const BOSS_TYPES={1:0x8e,2:0x9b,3:0x98,4:0x92};
export const BOSS_NAMES={1:'Owl',2:'Crawler',3:'SOD',4:'DD Copter'};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const approach=(v,target,step)=>v+clamp(target-v,-step,step);
const A={1:{idle:0x50c10,land:0x50d08,attack:0x50d30,fly:0x50c3c,hover:0x50ca4},
  2:{idle:N+0x57edc,attack:N+0x57f4c,fly:N+0x57edc},
  3:{idle:N+0x50cf8,attack:N+0x50df4,fly:N+0x50cfc},
  4:{idle:N+0x4e7fa,attack:N+0x4e82a,fly:N+0x4e82a}};
function phase(e,name,animation){e.phase=name;e.phaseTime=0;setAnimation(e,animation);}
function projectile(game,e,vx,vy,anim,gravity=0) {
  game.projectiles.push({owner:'enemy',x:e.x-32,y:e.y-36,vx,vy,life:180,age:0,damage:1,
    anim,animCounter:0,parts:[],gravity});
  game.sound(0x3e,e.x,0.55);
}
function egg(game,e) {
  if(game.entities.filter(e=>!e.dead).length>=128)return;
  const child=createEntity({id:game.nextEntityId++,kind:2,subtype:0x8f,x:e.x-10,y:e.y-12,health:1,bytes:Array(62).fill(0)});
  child.bossHelper='egg';child.dropChoice=game.tickNumber%8;
  setAnimation(child,0x50dc4);game.entities.push(child);game.sound(0x50,e.x,0.5);
}
export function updateBossHelper(game,e) {
  e.hazard=true;e.box={x:-4,y:-8,w:8,h:8};
  if(e.vy<448)e.vy+=30;
  groundMove(game,e,{ledges:false});
  if(e.grounded) {
    e.hazard=false;
    if((e.hatchTimer=(e.hatchTimer||0)+1)>=20) {
      e.dead=true;
      if(e.dropChoice===3||e.dropChoice===7)game.spawnDrop(e.x,e.y);
      else game.entities.push(createEntity({id:game.nextEntityId++,kind:2,subtype:0x80,x:e.x,y:e.y,health:1,bytes:Array(62).fill(0)}));
    }
  }
}
export function updateBoss(game,e) {
  const world=game.level.worldNumber||1,p=game.player,a=A[world];
  if(!e.boss) {
    e.boss=true;e.health=e.maxHealth=160;e.name=BOSS_NAMES[world];e.state=1;e.shootable=true;
    e.box=world===1?{x:-36,y:-80,w:53,h:78}:world===2?{x:-57,y:-32,w:114,h:32}:world===3?{x:-46,y:-60,w:92,h:58}:{x:-30,y:-56,w:60,h:54};
    e.eggTimer=100;e.attackCooldown=50;e.phaseTime=0;
    if(world===1){e.y=0;phase(e,'descend',a.idle);}
    else phase(e,'pursue',a.idle);
    game.boss=e;
  }
  if(e.phase==='defeated') {
    e.shootable=false;
    if(e.phaseTime++%8===0) {
      game.effects.push({x:e.x+Math.sin(e.phaseTime)*30,y:e.y-20-(e.phaseTime%60),age:0,life:24,kind:'explosion',native:0x5040c});
      game.sound(0x3d,e.x,0.45);
    }
    if(e.phaseTime>=260) {
      e.dead=true;e.parts=[];game.bossDefeated=true;game.flags[0x14]=255;
      if(world===4){game.flags[0x20]=255;game.flags[0x21]=255;}
      game.weapon=0;game.altEnergy=0;game.energy=game.energyCap;
    }
    return;
  }
  e.phaseTime++;
  const width=game.level.width*16;
  if(world===1) { // $55274: descend, ground attack, rising sweep, hover/eggs.
    const floor=176;
    if(e.phase==='descend') {
      e.vy=Math.min(448,e.vy+30);e.y+=Math.trunc(e.vy/32);
      if(e.y>=floor){e.y=floor;e.vy=0;phase(e,'land',a.land);}
    } else if(e.phase==='land'&&e.phaseTime>=24)phase(e,'ground',a.attack);
    else if(e.phase==='ground') {
      if(e.phaseTime===16)projectile(game,e,-6,0,0x50dbc,0.25);
      if(e.phaseTime>=64){e.fromX=e.x;e.fromY=e.y;phase(e,'swoop',a.fly);}
    } else if(e.phase==='swoop') {
      const t=clamp(e.phaseTime/64,0,1);
      e.x=Math.round(e.fromX+(Math.min(304,width-40)-e.fromX)*t);
      e.y=Math.round(e.fromY+(112-e.fromY)*t-50*Math.sin(t*Math.PI));
      if(t===1)phase(e,'hover',a.hover);
    } else if(e.phase==='hover') {
      e.x=Math.min(294,width-40)+Math.round(5*Math.cos(e.phaseTime*Math.PI/32));
      e.y=112+Math.round(10*Math.sin(e.phaseTime*Math.PI/32));
      if(e.phaseTime%40===16)projectile(game,e,-6,1,0x50dbc,0.25);
      if(--e.eggTimer<=0){egg(game,e);e.eggTimer=e.health+10;}
      if(e.phaseTime>=64+Math.floor(e.health/2)) {
        e.fromX=e.x;e.targetX=clamp(p.x+80,100,width-48);phase(e,'dive',a.fly);
      }
    } else if(e.phase==='dive') {
      const t=clamp(e.phaseTime/64,0,1);
      e.x=Math.round(e.fromX+(e.targetX-e.fromX)*t);
      e.y=Math.round(112+64*Math.sin(t*Math.PI/2));
      if(e.phaseTime===24)egg(game,e);
      if(t===1){e.y=floor;phase(e,'land',a.land);}
    }
  } else if(world===2) { // Crawler: charge, leap, then ranged volley.
    if(e.phase==='pursue') {
      e.facing=p.x<e.x?-1:1;e.vx=e.facing*96;if(e.vy<448)e.vy+=30;
      groundMove(game,e,{ledges:false});
      if(e.phaseTime>=60){e.vy=-320;e.vx=e.facing*160;phase(e,'leap',a.fly);}
    } else if(e.phase==='leap') {
      if(e.vy<448)e.vy+=20;groundMove(game,e,{ledges:false});
      if(e.grounded||e.phaseTime>60){e.vx=0;phase(e,'volley',a.attack);}
    } else if(e.phase==='volley') {
      if(e.phaseTime%16===0)projectile(game,e,(p.x<e.x?-1:1)*6,-2,N+0x57f34,0.12);
      if(e.phaseTime>=64)phase(e,'pursue',a.idle);
    }
  } else if(world===3) { // SOD: track around the arena, stop to fire a spread.
    if(e.phase==='pursue') {
      e.x=approach(e.x,clamp(p.x+90,64,width-64),3);
      e.y=approach(e.y,clamp(p.y-64,70,150),2);
      if(e.phaseTime>=80)phase(e,'volley',a.attack);
    } else {
      if(e.phaseTime%20===0)for(const vy of [-2,0,2])projectile(game,e,(p.x<e.x?-1:1)*5,vy,0x504b0);
      if(e.phaseTime>=60)phase(e,'pursue',a.fly);
    }
  } else { // $4FBAC: DD Copter tracking bounds and three 20-tick attack beats.
    const tx=clamp(p.x+128,80,Math.min(640,width-80)),ty=clamp(p.y-60,100,256);
    e.vx=approach(e.vx,Math.sign(tx-e.x)*160,16);e.vy=approach(e.vy,Math.sign(ty-e.y)*64,24);
    e.x+=Math.trunc(e.vx/32);e.y+=Math.trunc(e.vy/32);
    if(e.phase==='pursue'&&e.phaseTime>=20+e.health/2)phase(e,'volley',a.attack);
    else if(e.phase==='volley') {
      if(e.phaseTime%20===0)projectile(game,e,-4,1,N+0x4e8ee,0.2);
      if(e.phaseTime>=60)phase(e,'pursue',a.fly);
    }
  }
  e.x=clamp(e.x,40,width-32);e.y=clamp(e.y,0,game.level.height*16-16);
}
export function damageBoss(game,e) {
  if(e.phase==='defeated'||e.bossHitTick===game.tickNumber)return;
  e.bossHitTick=game.tickNumber;e.health=Math.max(0,e.health-((game.level.worldNumber||1)===4?2:1));
  e.hitFlash=4;game.sound(0x53,e.x,0.65);
  if(!e.health){e.shootable=false;phase(e,'defeated',e.anim);game.score+=1000;game.kills++;}
}
