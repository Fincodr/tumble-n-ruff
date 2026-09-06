// World-specific state-machine ports. Addresses refer to each original overlay.
// Factory/Castle primitives remain approximations; Mines uses individual source translations.
import {groundMove,generator} from './entities.js';
import {setAnimation} from './native-animation.js';
import {MINES_PROFILES,updateMinesEnemy} from './mines-enemies.js';
const N=0x1000000;
const walk=(name,hp,speed,left,right,attack=0,range=120)=>({name,hp,speed,left,right,attack,range,mode:'walk'});
const fly=(name,hp,speed,left,right,attack=0)=>({...walk(name,hp,speed,left,right,attack),mode:'fly'});
const turret=(name,hp,anim,attack=anim)=>({...walk(name,hp,0,anim,anim,attack,200),mode:'turret'});
const gen=(child,anim)=>({mode:'generator',child,anim});
const FACTORY={
  0x80:walk('Tank',6,64,0x50c68,0x50c7c,0x50c90),
  0x81:{...walk('Docker',10,64,0x50acc,0x50af0,0x50b14),attackRight:0x50b30,burst:3},
  0x83:{...walk('ED',50,32,0x50b8c,0x50bb0,0x50bd4,200),spread:true,box:{x:-38,y:-36,w:76,h:34}},
  0x85:gen(0x80,0x50cbc),
  0x88:fly('Rocket',10,128,0x509b8,0x509d4),
  0x89:turret('Rocket launcher',20,0x509f0),
  0x8a:walk('Gyromek',3,96,0x50be4,0x50c04),
  0x8b:gen(0x8a,0x50c24),0x8c:gen(0x8a,0x50c24),
  0x90:{...turret('Factory press',1,0x50924),mode:'hazard'},
  0x91:{...turret('Factory press',1,0x50968),mode:'hazard'},
  0x92:gen(0x81,0x50a7c),0x93:gen(0x81,0x50a7c),0x94:gen(0x81,0x50a7c),
  0x95:fly('Small rocket',1,128,0x50a70,0x50a70),
  0x96:turret('Rocket launcher',20,0x50a68),0x97:turret('Rocket launcher',20,0x50a60),
  0x99:fly('Rocket',1,128,0x509b8,0x509d4),
};
const CASTLE={
  0x80:{...walk('Wizard',8,64,0x4e592,0x4e592,0x4e5de,180),attackRight:0x4e612},
  0x82:walk('Rat',1,96,0x4e65a,0x4e676),
  0x83:fly('Skull bat',4,96,0x4e6c2,0x4e6ee,0x4e71a),
  0x85:{...walk('Jerry',12,64,0x4e31a,0x4e33e,0x4e3ba),attackRight:0x4e3d2,burst:3},
  0x86:gen(0x85,0x4e2d2),0x87:gen(0x85,0x4e2d2),0x88:gen(0x85,0x4e2d2),
  0x8a:{...walk('Knight',16,64,0x4e442,0x4e476,0x4e55a,80),attackRight:0x4e576,melee:true},
  0x8b:gen(0x8a,0x4e3fa),0x8c:gen(0x8a,0x4e3fa),0x8d:gen(0x8a,0x4e3fa),
  0x93:fly('Jouster',3,128,0x4e726,0x4e76e),
  0x94:gen(0x93,0x4e7b6),0x95:gen(0x93,0x4e7b6),
  0x96:{mode:'pendulum'},0x97:{mode:'pendulum'},0x98:{mode:'pendulum'},
};
export const WORLD_PROFILES={2:MINES_PROFILES,3:FACTORY,4:CASTLE};
export function worldProfile(world,type){return WORLD_PROFILES[world]?.[type];}
const approach=(v,target,step)=>v+Math.max(-step,Math.min(step,target-v));
function facingAnimation(e,profile,attacking=false) {
  const address=attacking?(e.facing>0&&profile.attackRight||profile.attack):e.facing<0?profile.left:profile.right;
  if(address&&e.anim!==address+N)setAnimation(e,address+N);
}
function shoot(game,e,profile) {
  const dx=game.player.x-e.x,dy=game.player.y-18-(e.y-20),length=Math.max(1,Math.hypot(dx,dy));
  for(const angle of profile.spread?[-0.35,0,0.35]:[0]) {
    const vx=(dx*Math.cos(angle)-dy*Math.sin(angle))/length*6;
    const vy=(dy*Math.cos(angle)+dx*Math.sin(angle))/length*6;
    game.projectiles.push({owner:'enemy',x:e.x+e.facing*14,y:e.y-20,vx,vy,life:100,age:0,damage:1,
      parts:[],anim:0x504b0,animCounter:0});
  }
  game.sound(0x52,e.x,0.5);
}
export function updateWorldEnemy(game,e,profile) {
  if(profile.nativeMines){updateMinesEnemy(game,e);return;}
  if(profile.mode==='generator'){generator(game,e,{child:profile.child,anim:N+profile.anim});return;}
  if(profile.mode==='pendulum'){game.updateLevelObject(e);return;}
  const p=game.player;
  if(!e.state) {
    e.state=1;e.health=profile.hp;e.name=profile.name;e.facing=p.x<e.x?-1:1;
    e.timer=20;e.attackTimer=0;e.burst=0;e.awake=!profile.sleep;
    facingAnimation(e,profile);
    if(profile.sleep)setAnimation(e,N+profile.sleep);
  }
  e.box=profile.box||{x:-10,y:-28,w:20,h:26};
  e.shootable=profile.mode!=='hazard';e.hazard=profile.mode==='hazard';
  const dx=p.x-e.x,dy=p.y-e.y;
  if(!e.awake) {
    if(Math.abs(dx)<112&&dy>=0&&dy<128)e.wakeTicks=(e.wakeTicks||0)+1;
    if(e.wakeTicks>=20){e.awake=true;facingAnimation(e,profile);}else return;
  }
  if(profile.mode==='hazard'){e.hazard=e.animCounter>=32;return;}
  if(e.hitFlash)return;
  if(e.attackTimer>0) {
    e.attackTimer--;
    if(!profile.melee&&e.attackTimer%8===0&&e.burst>0){shoot(game,e,profile);e.burst--;}
    if(profile.melee&&Math.abs(dx)<45&&Math.abs(dy)<32)game.hurt();
    if(!e.attackTimer){e.timer=50;facingAnimation(e,profile);}
    return;
  }
  if(profile.mode==='fly') {
    e.facing=dx<0?-1:1;facingAnimation(e,profile);
    e.vx=approach(e.vx,e.facing*profile.speed,4);
    e.vy=approach(e.vy,Math.sign(dy-20)*profile.speed,12);
    let x=e.x+Math.trunc(e.vx/32),y=e.y+Math.trunc(e.vy/32);
    if(profile.water) {
      x=Math.max(e.originX-(Math.abs(e.rangeLeft)||96),Math.min(e.originX+(Math.abs(e.rangeRight)||96),x));
      y=Math.max(e.originY-32,Math.min(e.originY+32,y));
    }
    e.x=x;e.y=y;
  } else if(profile.mode==='crusher') {
    if(!e.crushing&&Math.abs(dx)<32&&dy>0){e.crushing=true;e.vy=0;}
    if(e.crushing) {
      if(e.vy<448)e.vy+=24;
      groundMove(game,e,{ledges:false});
      if(e.grounded){e.crushing=false;e.timer=40;}
    } else if(e.timer<=0)e.y=Math.max(e.originY,e.y-2);
  } else if(profile.mode==='walk') {
    if(e.vy<448)e.vy+=30;
    e.vx=e.facing*profile.speed;
    if(profile.jump&&e.grounded&&e.age%40===0)e.vy=-256;
    const obstacle=groundMove(game,e);
    const range=Math.max(32,Math.abs(e.rangeLeft)||128);
    if(obstacle||Math.abs(e.x-e.originX)>range&&Math.sign(e.x-e.originX)===e.facing)e.facing*=-1;
    facingAnimation(e,profile);
  } else {e.facing=dx<0?-1:1;facingAnimation(e,profile);}
  if(e.timer)e.timer--;
  if(profile.attack&&!e.timer&&Math.abs(dx)<profile.range&&Math.abs(dy)<(profile.mode==='turret'?180:48)) {
    e.facing=dx<0?-1:1;e.burst=profile.burst||1;e.attackTimer=8*e.burst+16;
    facingAnimation(e,profile,true);
  }
}
