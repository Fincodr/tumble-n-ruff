// World 2 control flow. Addresses are overlay offsets, not the Forest equivalents.
// Evidence and shared-engine limits: extracted/code/MINES_ENEMIES.md.
import {setAnimation} from './native-animation.js';
import {createEntity,killEntity} from './entities.js';
import {nativeAcceleration,floorProbe,moveNativeEnemy,updateForestGenerator} from './forest-enemies.js';
import {overlaps,playerBox} from './weapons.js';
const N=0x1000000, signed=v=>v<<16>>16, pixels=v=>Math.trunc(v/32);
const face=(e,x)=>{e.facing=signed(x-e.x)<0?-1:1;};
const distance=(a,b)=>Math.abs(signed(a-b));
const gravity=e=>{if(e.vy<448)e.vy=signed(e.vy+30);};
const moveX=e=>{e.x=signed(e.x+pixels(e.vx));};
const moveY=e=>{e.y=signed(e.y+pixels(e.vy));};
const friction=(v,n)=>signed(Math.sign(v)*Math.max(0,Math.abs(v)-n));
const word=(e,n)=>(e.bytes[n]<<8)|e.bytes[n+1];
const room=game=>game.entities.filter(e=>!e.dead).length+game.projectiles.length<128;
const GENERATORS={0x92:[0x80,0x57ddc],0x93:[0x80,0x57ddc],0x94:[0x80,0x57ddc],
  0x95:[0x83,0x57cd4],0x96:[0x83,0x57cd4],0x97:[0x83,0x57cd4],
  0x98:[0x87,0x57a58],0x99:[0x87,0x57a58],0x9a:[0x87,0x57a58]};
export const MINES_PROFILES=Object.fromEntries([
  [0x80,'Snapper'],[0x81,'Bat'],[0x82,'Subaqua'],[0x83,'D-bot'],[0x84,'Transforming D-bot'],
  [0x85,'Spider'],[0x87,'Miner'],[0x88,'Upward cannon'],[0x89,'Subaqua cannon'],
  [0x8a,'Left cannon'],[0x8b,'Right cannon'],[0x8c,'Retired cannon helper'],
  [0x8d,'Tethered mine'],[0x8e,'Homing Subaqua shot'],[0x8f,'Rolling hazard'],
  [0x90,'Bouncing cannon shot'],[0x91,'Rising cannon shot'],
  ...Object.entries(GENERATORS).map(([id,[child]])=>[id,`${child===0x80?'Snapper':child===0x83?'D-bot':'Miner'} generator`]),
].map(([id,name])=>[id,{name,nativeMines:true}]));

function animate(e,address,counter=0) { // $543A0: writing the pointer also clears its flash byte.
  setAnimation(e,N+address,counter);e.hitFlash=0;
}
function facingAnimation(e,left,right) {animate(e,e.facing<0?left:right);}
function changeAnimation(e,left,right) { // $543D0 preserves flash; reset only on pointer change.
  const address=N+(e.facing<0?left:right);
  if(e.anim!==address)setAnimation(e,address);
}
function collision(e,x,y,w,h,mask=6) { // $5448A: bit 1 harms Ruff, bit 2 accepts his shots.
  e.box={x,y,w,h};e.shootable=!!(mask&4);e.contactDamage=!!(mask&2);
}
function hit(game,e) { // $544B2 consumes last collision pass's incoming flag.
  if(!e.incomingHit)return 0;
  e.hitFlash=4;game.sound(0x43,e.x);
  return e.health<=0?-1:1;
}
function retire(e) {e.dead=true;e.parts=[];e.shootable=false;e.contactDamage=false;}
function die(game,e,animation=e.deathAnimation) {e.deathAnimation=animation;killEntity(game,e);}
function inFront(game,e,range) { // $548E2: inclusive horizontal and 16-pixel vertical range.
  return distance(e.x,game.player.x)<=range&&distance(e.y,game.player.y)<=16&&
    (signed(game.player.x-e.x)<0?-1:1)===e.facing;
}
function step(game,e,speed) { // $548BA: frame-eighth stepping, full body, no ledge avoidance.
  e.vx=(e.animCounter&7)?0:e.facing*speed;gravity(e);moveNativeEnemy(game,e);
}
function turnAtWall(e) { // $54892
  if(e.hit&4){e.vx=0;e.facing=1;}
  else if(e.hit&8){e.vx=0;e.facing=-1;}
}
function child(game,e,type) {
  if(!room(game))return null;
  const c=createEntity({id:game.nextEntityId++,kind:4,subtype:type,x:e.x,y:e.y,
    health:1,facing:e.facing,bytes:Array(62).fill(0)});
  c.active=true;c.transient=true;game.entities.push(c);return c;
}
function smoke(game,e) { // $54B80 shares a three-call counter between emitters.
  if(--game.mineSmokeCounter>=0)return false;
  game.mineSmokeCounter=2;
  if(!room(game))return false;
  game.effects.push({x:e.x,y:e.y-4-(e.x&3),age:0,life:14,kind:'impact',native:N+0x57810});
  return true;
}

export function updateMinesEnemy(game,e) {
  e.name=MINES_PROFILES[e.subtype]?.name;e.deferDamage=true;e.deferHitFlash=true;e.nativeHealthByte=true;e.nativeFlashTiming=true;
  e.shootable=false;e.hazard=false;e.contactDamage=false;
  e.incomingHit=!!e.pendingHit;e.pendingHit=false;
  e.killScore=({0x80:50,0x81:50,0x82:100,0x83:100,0x84:250,0x85:50,0x87:250,0x8f:50})[e.subtype]??0;
  e.countsAsKill=[0x80,0x81,0x82,0x83,0x84,0x85,0x87,0x8f].includes(e.subtype);
  e.dropOnDeath=e.countsAsKill&&e.subtype!==0x8f;
  e.deathAnimation=N+([0x83,0x84,0x85,0x8f].includes(e.subtype)?0x577c8:e.subtype===0x87?0x577a4:0x577ec);
  e.deathSound=[0x83,0x84,0x85,0x87,0x8f].includes(e.subtype)?0x3d:0x3e;e.deathOffsetY=0;
  if(GENERATORS[e.subtype]) {
    const [type,animation]=GENERATORS[e.subtype];updateForestGenerator(game,e,type,N+animation);return;
  }
  switch(e.subtype) {
    case 0x80:return snapper(game,e);
    case 0x81:return bat(game,e);
    case 0x82:return subaqua(game,e);
    case 0x83:case 0x84:return dbot(game,e);
    case 0x85:return spider(game,e);
    case 0x87:return miner(game,e);
    case 0x88:case 0x89:case 0x8a:case 0x8b:return cannon(game,e);
    case 0x8c:
      if(e.deathFlag)game.flags[e.deathFlag>>8]=(game.flags[e.deathFlag>>8]+(e.deathFlag&255))&255;
      retire(e);return;
    case 0x8d:return tetheredMine(game,e);
    case 0x8e:case 0x90:case 0x91:return cannonShot(game,e);
    case 0x8f:return rollingHazard(game,e);
  }
}

function snapper(game,e) { // $58E92
  if(hit(game,e)<0){die(game,e);return;}
  collision(e,-6,-24,12,22);
  if(![2,3,9].includes(e.state)) {
    face(e,game.player.x);e.health=2;e.state=2;e.patrolOrigin=e.x;
    facingAnimation(e,0x57e20,0x57e3c);return;
  }
  const turn=()=>{e.facing=-e.facing;facingAnimation(e,0x57e20,0x57e3c);e.state=2;};
  if(e.state!==3) {
    if(e.animDone&&!e.vy&&inFront(game,e,48)) {
      facingAnimation(e,0x57e58,0x57e80);e.vy=-128;e.state=3;
    } else {step(game,e,96);if(e.hit&12)turn();return;}
  }
  if(e.animDone){turn();return;}
  if(e.animCounter>=24){e.vx=e.facing*128;gravity(e);moveNativeEnemy(game,e,16);}
}

function bat(game,e) { // $58A04: wake-up attention is cumulative, not consecutive.
  if(hit(game,e)<0){die(game,e);return;}
  if(e.state) {
    e.vy=nativeAcceleration(e.vy,signed(game.player.y-20-e.y)<0?-1:1,12,96);
    e.vx=nativeAcceleration(e.vx,e.facing,4,96);moveX(e);moveY(e);
    collision(e,-6,-5,12,11);return; // Horizontal facing stays fixed after takeoff.
  }
  animate(e,0x57ea8);
  const x=signed(game.player.x+32-e.x),y=signed(game.player.y-e.y);
  let attention=false;
  if(x<0&&-x<=96){e.animCounter=0;attention=true;}
  else if(x>=16&&x<=112){e.animCounter=16;attention=true;}
  else e.animCounter=8;
  e.wakeTicks??=signed(word(e,26));
  if(attention&&y>=0&&y<=128)e.wakeTicks=signed(e.wakeTicks+1);
  collision(e,-6,-20,12,16);
  if(e.wakeTicks>=20){face(e,game.player.x);facingAnimation(e,0x57eb4,0x57ec8);e.state=1;e.health=1;}
}

function dbotMove(game,e,acceleration,limit) { // $58C5E: reface the origin only after moving.
  e.vx=nativeAcceleration(e.vx,e.facing,acceleration,limit);gravity(e);moveNativeEnemy(game,e);
  if(e.hit&12||distance(e.patrolOrigin,e.x)>e.patrolRange)face(e,e.patrolOrigin);
}
function dbot(game,e) { // $58B08 / $58B9A; neither controller adds a jump impulse.
  if(hit(game,e)<0){die(game,e);return;}
  const transforming=e.subtype===0x84;
  collision(e,-8,-34,16,32);
  if(![2,3].includes(e.state)) {
    e.health=transforming?5:3;e.patrolRange=8;e.patrolOrigin=e.x;e.state=2;
    animate(e,transforming?0x57c58:0x57cc0);e.timer=25;return;
  }
  if(!transforming) {
    dbotMove(game,e,20,e.state===3?128:96);
    if(e.state===2&&inFront(game,e,192)){e.state=3;e.patrolRange=250;}
    return;
  }
  if(e.state===2) {
    if(e.timer)e.timer--;
    else if(distance(e.y,game.player.y)<=16&&distance(e.x,game.player.x)<64) {
      animate(e,0x57c80);e.state=3;e.attackLoops=1;
    }
    if(e.state===2){dbotMove(game,e,20,96);return;}
  }
  if(e.animDone&&--e.attackLoops<0){animate(e,0x57c58);e.state=2;e.timer=25;return;}
  face(e,game.player.x);dbotMove(game,e,24,160);collision(e,-25,-26,50,24);
}

function spiderPatrol(game,e) { // $58D34; preserve the independent shooting cooldown.
  face(e,e.patrolOrigin);e.state=2;facingAnimation(e,0x57d20,0x57d48);
  e.timer=8;e.patrolTicks=(game.player.x&15)+64;
}
function spider(game,e) { // $58CE6
  if(hit(game,e)<0){die(game,e);return;}
  collision(e,-8,-24,16,22);
  if(![2,3,16].includes(e.state)) {
    e.patrolOrigin=e.x;e.health=4;e.shotTimer=10;spiderPatrol(game,e);return;
  }
  if(e.state===16) {
    if(e.animDone){spiderPatrol(game,e);return;}
    if(e.animCounter===32) {
      // $58E58 / $54C50: X acceleration is computed but discarded by $54C82.
      e.shootable=false;e.contactDamage=false;
      for(const [vx,vy] of [[128,-384],[-128,-384],[0,-448]]) {
        if(room(game))game.projectiles.push({owner:'enemy',nativeArc:true,x:e.x,y:e.y,vx,vy,
          age:0,damage:1,anim:N+0x5788c,animCounter:0,parts:[]});
      }
    }
    return;
  }
  if(e.state===3) {
    step(game,e,128);
    if(e.hit&12){spiderPatrol(game,e);face(e,game.player.x);facingAnimation(e,0x57d20,0x57d48);return;}
    const old=e.facing;face(e,game.player.x);if(old!==e.facing)spiderPatrol(game,e);
    return;
  }
  if(e.timer){if(!--e.timer)e.animCounter=8;return;}
  step(game,e,128);
  if(e.hit&12){spiderPatrol(game,e);return;}
  if(--e.patrolTicks<0) {
    if(!inFront(game,e,192)){spiderPatrol(game,e);return;}
    face(e,game.player.x);facingAnimation(e,0x57d70,0x57d98);e.animCounter=8;e.state=3;return;
  }
  if(distance(e.x,game.player.x)<=160&&distance(e.y,game.player.y)<=64&&--e.shotTimer<0) {
    e.shotTimer=50;animate(e,0x57dc0);e.state=16;
  }
}

function miner(game,e) { // $58844; the extending weapon registers a 70×5 damage box.
  const damage=hit(game,e);
  if(damage<0){die(game,e);return;}
  collision(e,-10,-42,20,40);
  const walk=()=>{facingAnimation(e,0x57a9c,0x57ab0);e.state=2;};
  const attack=()=>{face(e,game.player.x);facingAnimation(e,0x57ac4,0x57b0c);e.state=3;e.attackCount=0;};
  if(damage>0&&e.state!==4) {
    face(e,game.player.x);facingAnimation(e,0x57b54,0x57b6c);
    e.hitFlash=4;e.state=4;e.vx=e.facing<0?96:-65;
  }
  if(![2,3,4,5].includes(e.state)){e.health=12;face(e,game.player.x);walk();return;}
  if(e.state===4) {
    if(e.animDone){attack();return;}
    e.vx=friction(e.vx,18);gravity(e);moveNativeEnemy(game,e);return;
  }
  if(e.state===5){if(e.animDone)walk();return;}
  if(e.state===2) {
    if(e.animDone&&inFront(game,e,60)){attack();return;}
    step(game,e,64);
    if(e.hit&12){e.facing=-e.facing;facingAnimation(e,0x57ba0,0x57b88);e.state=5;}
    return;
  }
  if(e.animCounter>=40&&overlaps({x:e.x+(e.facing<0?-70:0),y:e.y-26,w:70,h:5},playerBox(game.player)))game.hurt();
  // The terminal marker holds: the four counts are four ticks at that pose.
  if(e.animDone&&++e.attackCount===4)walk();
}

function subaqua(game,e) { // $58FE8: patrol/chase hysteresis and water-line death.
  if((game.waterLevel||0)>e.y||hit(game,e)<0){e.deathOffsetY=8;die(game,e);return;}
  collision(e,-8,-14,15,12);
  if(e.hitFlash)return;
  const dx=distance(e.x,game.player.x),dy=distance(e.y,game.player.y);
  if(!e.state&&dx<=80&&dy<=40)e.state=1;
  if(!e.state) {
    e.vy=0;e.vx=e.facing*32;moveNativeEnemy(game,e,16);turnAtWall(e);
    changeAnimation(e,0x57bd8,0x57bf8);return;
  }
  if(dx>=100&&dy>=100){e.state=0;return;}
  e.vy=signed(e.y-game.player.y)<0?32:-32;
  moveNativeEnemy(game,e,16);turnAtWall(e);face(e,game.player.x);
  e.vx=nativeAcceleration(e.vx,e.facing,4,64);changeAnimation(e,0x57c18,0x57c34);
}

export function mineFiringMarker(e) { // $54926: inclusive timer, then burst count through -1.
  e.timer=signed(e.timer-1);
  if(e.timer>=0){if(!e.timer){e.animCounter=signed(e.animCounter+8);e.animDone=false;}return false;}
  if(!e.animDone)return false;
  if(--e.burst<0){e.timer=100;e.burst=e.burstSize;e.animCounter=0;}
  return true;
}
function cannon(game,e) { // $590D0 / $5913A / $59340 / $5944E
  if(hit(game,e)<0){die(game,e);return;}
  collision(e,-12,-20,24,30,4); // Cannon bases are shootable, without contact damage.
  if(e.state!==1) {
    const configurations={0x88:[0x57984,0,-6,0,-640,2],0x89:[0x57960,0,2,0,256,2],
      0x8a:[0x579a8,5,5,-320,-448,4],0x8b:[0x579cc,-6,4,320,-448,4]};
    const [anim,x,y,vx,vy,count]=configurations[e.subtype];
    animate(e,anim);e.x=signed(e.x+x);e.y=signed(e.y+y);e.vx=vx;e.vy=vy;
    e.health=16;e.state=1;e.timer=25;e.burst=e.burstSize=count;e.shotIndex=word(e,42);return;
  }
  if(!mineFiringMarker(e))return;
  if(e.subtype===0x89)face(e,game.player.x);
  const type=e.subtype===0x88?0x91:e.subtype===0x89?0x8e:0x90;
  const c=child(game,e,type);if(!c)return; // Native reverse-pool allocation was unchecked.
  if(type===0x90){c.vx=e.vx;c.vy=e.vy;animate(c,0x579f0);}
  else if(type===0x91){c.vx=0;c.vy=-128;animate(c,0x57bd0);}
  else {
    e.shotIndex=signed(e.shotIndex+1);c.vy=[288,224,256,192][e.shotIndex&3];c.vx=e.facing*32;
    animate(c,e.facing<0?0x57bb8:0x57bc4);
  }
}
function breakup(game,e) { // $54A16 debris stays a cosmetic browser effect.
  retire(e);
  game.effects.push({x:e.x,y:e.y,age:0,life:14,kind:'impact',native:N+0x57810});
}
function cannonShot(game,e) {
  if(e.subtype===0x90) { // $591FE: fixed X, floor bounce, and endpoint tile test.
    if(e.incomingHit){breakup(game,e);return;}
    gravity(e);moveY(e);
    if(floorProbe(game,e)!==null)e.vy=-192; // The floor probe clears VY, but this path never snaps Y.
    moveX(e);
    if(game.level.collision.floor[game.typeAt(e.x,e.y-16)]){breakup(game,e);return;}
    collision(e,-4,-12,8,8);return;
  }
  if(hit(game,e)<0){die(game,e);return;}
  if(e.subtype===0x91) { // $593F8: rises at -128, steers sideways, expires near the water line.
    face(e,game.player.x);e.vx=nativeAcceleration(e.vx,e.facing,8,32);
    if(-e.vy>128)e.vy=signed(e.vy+8);
    moveNativeEnemy(game,e);
    if(e.hit||signed(e.y-25)<(game.waterLevel||0)){die(game,e);return;}
  } else { // $59540: downward launch slows to zero, then accelerates horizontally.
    if(e.state!==1) {
      e.vy=friction(e.vy,12);moveX(e);moveY(e);
      if(e.vy){collision(e,-8,-8,16,6);return;}
      e.state=1;
    }
    if(e.vx)e.vx=nativeAcceleration(e.vx,Math.sign(e.vx),8,256);
    e.vy=nativeAcceleration(e.vy,signed(game.player.y-10-e.y)<0?-1:1,4,32);
    moveNativeEnemy(game,e,16);smoke(game,e);
    if(e.hit){die(game,e);return;}
  }
  collision(e,-8,-8,16,6);
}

function rollingHazard(game,e) { // $5925C: fall, roll with acceleration, break on a side wall.
  if(hit(game,e)<0){die(game,e);return;}
  if(![1,2,3].includes(e.state)){animate(e,0x57a04);e.state=2;e.health=4;return;}
  if(e.state===1) {
    const flag=word(e,24);
    if(flag&&game.flags[flag>>8]===(flag&255)){e.state=2;return;}
    collision(e,-16,-32,32,32);
    return;
  }
  collision(e,-16,-32,32,32);
  if(e.state===2) {
    gravity(e);moveY(e);const floor=floorProbe(game,e);
    if(floor!==null){e.y=floor;e.vy=0;e.state=3;}
    return;
  }
  e.vx=nativeAcceleration(e.vx,e.facing,24,192);gravity(e);moveNativeEnemy(game,e);
  let walls=e.hit&12;
  // $592F8 calls $54B80 without preserving d1. Successful smoke creation
  // replaces its saved hit bits with x&3, suppressing side-wall breakup once.
  if(e.hit&2&&smoke(game,e))walls=0;
  if(walls) {
    e.killScore=0;e.countsAsKill=false;e.deathSound=0x3e;die(game,e,N+0x577ec);return;
  }
  e.animCounter=signed(e.animCounter+(Math.abs(e.vx)>>5));
}

function mineColumn(game,e,image) { // $54382 / $5964C: rewrite the tether column up to the first floor tile.
  const x=e.x>>4,y=(e.y-16)>>4;
  if(x<0||x>=game.level.width||y<0||y>=game.level.height)return;
  game.cells[y*game.level.width+x]=0;
  for(let row=y+1;row<game.level.height;row++) {
    const at=row*game.level.width+x;
    if(game.level.collision.floor[(game.cells[at]>>>10)&31])break;
    game.cells[at]=image;
  }
}
function detonateMine(game,e) {
  animate(e,0x577ec);e.state=3;mineColumn(game,e,0);
}
function tetheredMine(game,e) { // $595D2: the former "launcher" is itself the rising enemy.
  if(e.state===3){if(e.animDone)retire(e);return;}
  if(![1,2].includes(e.state)) {
    animate(e,0x57c50);e.top=e.y;e.bottom=signed(e.y+e.rangeLeft);e.state=1;
  }
  if(e.state===2) {
    e.y=signed(e.y-3);
    if(hit(game,e)<0||signed(e.y-25)<(game.waterLevel||0)||
      game.level.collision.wall[game.typeAt(e.x,e.y-32)])detonateMine(game,e);
    // $59610 returns through $5966C even on detonation: retain this tick's body box.
    collision(e,-10,-29,20,22);return;
  }
  e.vy=nativeAcceleration(e.vy,e.facing,8,64);moveY(e);
  if(e.facing<0?e.y<=e.top:e.y>e.bottom)e.facing=-e.facing;
  mineColumn(game,e,(e.y&7)+60);collision(e,-10,-29,20,22);
  // d1 is signed enemyY - RuffY, compared unsigned: Ruff must be at/above the mine.
  const dy=signed(e.y-game.player.y);
  if(distance(e.x,game.player.x)<16&&dy>=0&&dy<80) {
    e.state=2;e.health=4;e.animCounter=8;mineColumn(game,e,0);
  }
}
