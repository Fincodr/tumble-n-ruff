// $4D7DC–$4E0AC. Velocities here are pixels/tick, except missile acceleration.
export const WEAPONS = [
  {name:'Machine gun',damage:1,cooldown:4,life:9},
  {name:'Missiles',damage:12,cooldown:14,life:100},
  {name:'Laser',damage:4,cooldown:3,life:80},
  {name:'Flamethrower',damage:8,cooldown:1,life:18}, // $4E01E writes 8 to projectile health/damage.
  {name:'Rapid gun',damage:1,cooldown:2,life:25},
  {name:'Laser II',damage:4,cooldown:3,life:80},
  {name:'Plasma',damage:12,cooldown:4,life:80},
];
const COOL=[8,8,8,8,6,6,6,6,6,6,4,4,4,4,4,4];
const trunc=v=>Math.trunc(v);
export const overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
export const playerBox=p=>({x:p.x-8,y:p.y-33+p.duck,w:16,h:33-p.duck});

export function equipWeapon(game,id) {
  if (!WEAPONS[id]) return false;
  game.weapon=id;game.altEnergy=id?512:0;game.cooldown=0;
  game.events.push('weapon');return true;
}

export function fireWeapon(game,input) {
  const p=game.player, firing=!!(input&128);
  if (game.weapon) {
    if (--game.altEnergy<32) {game.weapon=0;game.altEnergy=0;game.energyCap=384;game.cooldown=0;}
  } else if (firing && game.energy>=32) game.energy=Math.max(0,game.energy-4);
  else game.energy=Math.min(game.energyCap,game.energy+8);
  if (game.cooldown) {game.cooldown--;return;}
  if (!firing || p.mode===3 || p.mode===4 || (!game.weapon && game.energy<32)) return;
  const id=game.weapon, spec=WEAPONS[id], aim=p.duck?0:p.aim||0;
  let [vx,vy]=(game.level.weaponVectors||[[64,0],[0,-64],[32,-32],[32,32]])[aim];
  vx*=p.facing;
  let x=p.x+p.facing*15,y=p.y-20;
  if (p.duck) {x=p.x+p.facing*13;y=p.y-13;} // Crouched muzzle records $4DA70/$4DA78.
  else if (aim===1) {x=p.x;y=p.y-35;}
  else if (aim===2) {x=p.x+p.facing*10;y=p.y-30;}
  else if (aim===3) {x=p.x+p.facing*10;y=p.y-8;}
  if (id===1) {vx=(vx*3+p.vx)/32;vy=vy*3/32;}
  else if (id===3) {
    [vx,vy]=[[448,0],[0,-384],[384,-384],[384,384]][aim];vx=vx*p.facing/32;vy/=32;
  } else {vx=trunc(vx/4);vy=trunc(vy/4);}
  const direction=aim+(p.facing<0?4:0);
  let descriptor=(id===1?0x51de6:id===2||id===5||id===6?0x51da6:0x51d66)+direction*8;
  let parts=game.level.bobDescriptors?.[descriptor]||[];
  if (id===6) parts=parts.map(part=>({...part,id:part.id+20}));
  game.projectiles.push({owner:'player',weapon:id,x,y,vx,vy,damage:spec.damage,
    life:spec.life,age:0,parts,animation:id===3?0x50578:0});
  game.cooldown=id?spec.cooldown:COOL[Math.min(15,game.energy>>5)];
  game.effects.push({x,y,age:0,life:4,kind:'muzzle'});game.events.push('shot');
  // Native laser/plasma/missile/flame commands; gun uses a short native hit cue.
  game.sound([0x51,0x40,0x4c,0x40,0x51,0x4c,0x4d][id],x,id===0||id===4?0.55:0.75);
}

export function moveProjectiles(game) {
  const remaining=[];
  for (const shot of game.projectiles) {
    if(shot.nativeArc) { // $4F838: Bombot sparks use word velocities, gravity and a 4×4 box.
      const x=shot.x-game.camera.x+64,y=shot.y-game.camera.y+96;
      if(x<0||x>=528||y<0||y>=400)continue;
      shot.age++;shot.x=(shot.x+trunc(shot.vx/32))<<16>>16;
      shot.vy=(shot.vy+30)<<16>>16;shot.y=(shot.y+trunc(shot.vy/32))<<16>>16;
      // The native horizontal acceleration helper's result is discarded at $4F84C.
      if(overlaps({x:shot.x-2,y:shot.y-2,w:4,h:4},playerBox(game.player)))game.hurt();
      remaining.push(shot);continue; // No terrain collision or arbitrary lifetime.
    }
    if(shot.nativeBullet) { // $4EDD6/$4F510: Gunwasp / heavy Tinhead shots.
      const x=shot.x-game.camera.x+64,y=shot.y-game.camera.y+96;
      if(x<0||x>=528||y<0||y>=400)continue;
      shot.age++;shot.x=(shot.x+shot.vx)<<16>>16;
      if(game.level.collision.ceiling[game.typeAt(shot.x,shot.y)]) {
        game.effects.push({x:shot.x,y:shot.y,age:0,life:12,kind:'impact',native:0x50490});
      } else if(overlaps({x:shot.x-4,y:shot.y-8,w:8,h:8},playerBox(game.player)))game.hurt();
      else remaining.push(shot);
      continue;
    }
    if (--shot.life<0) continue;
    shot.age=(shot.age||0)+1;
    if(shot.gravity)shot.vy+=shot.gravity;
    if (shot.weapon===1) {
      for (const axis of ['vx','vy']) if(shot[axis]) shot[axis]=Math.sign(shot[axis])*Math.min(10,Math.abs(shot[axis])+0.75);
    } else if (shot.weapon===3) {
      for(const axis of ['vx','vy'])shot[axis]=Math.sign(shot[axis])*Math.max(0,Math.abs(shot[axis])-30/32);
    }
    let hit=false;
    // Substeps prevent a 16px native shot from jumping across a thin hit box.
    const dx=shot.weapon===1||shot.weapon===3?trunc(shot.vx):shot.vx;
    const dy=shot.weapon===1||shot.weapon===3?trunc(shot.vy):shot.vy;
    const steps=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))/4));
    for(let n=0;n<steps&&!hit;n++) {
      shot.x+=dx/steps;shot.y+=dy/steps;
      const word=game.at(shot.x,shot.y),type=(word>>>10)&31;
      if(game.level.collision.wall[type]) {
        if(type===4 && shot.owner!=='enemy') {
          const index=(shot.y>>4)*game.level.width+(shot.x>>4);
          game.cells[index]=shot.weapon && shot.weapon!==4 ? 0 : ((word+1)&3)?word+1:0;
          game.trigger(index);
        }
        hit=true;
      } else if(shot.owner==='enemy') {
        if(overlaps({x:shot.x-3,y:shot.y-3,w:6,h:6},playerBox(game.player))) {game.hurt();hit=true;}
      } else {
        const enemy=game.entities?.find(e=>e.active&&!e.dead&&e.shootable&&overlaps({x:shot.x-4,y:shot.y-4,w:8,h:8},game.entityBox(e)));
        if(enemy) {game.damageEntity(enemy,shot.damage||1);hit=true;}
      }
    }
    if(hit) {
      game.effects.push({x:shot.x,y:shot.y,age:0,life:12,kind:'impact',native:0x504b0});
      game.sound(shot.weapon===1?0x3e:0x43,shot.x,shot.weapon===1?0.8:0.22);
    }
    else if(shot.x>=0&&shot.x<game.level.width*16&&shot.y>=0&&shot.y<game.level.height*16) remaining.push(shot);
  }
  game.projectiles=remaining;
}
