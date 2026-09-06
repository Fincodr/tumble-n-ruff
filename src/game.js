// Portable 50 Hz core. References are overlay offsets in extracted/code/asm/world1_game.s.
import {PlayerAnimation} from './animation.js';
import {fireWeapon,moveProjectiles,equipWeapon} from './weapons.js';
import {initEntities,updateEntities,entityBox,damageEntity} from './entities.js';
import {trigger,unlockTile,roomTile,updateLevelObject,givePickup,spawnDrop,updateDrops} from './level-logic.js';
import {advanceAnimation} from './native-animation.js';
export const INPUT = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, JUMP: 16, FIRE: 128 };
export const MODE = { GROUND: 0, AIR: 1, CLIMB: 2, DEATH: 3, HURT: 4 };
export const TICK = 1 / 50;
export const START_LIVES = 3;
export const DIFFICULTIES = {easy:4,normal:1};
export const velToPixels = v => v < 0 ? (v + 31) >> 5 : v >> 5; // $4CF1C
export const tileType = word => (word >>> 10) & 31;
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const FRICTION = 14, ACCEL = 18, GRAVITY = 30, JUMP_VY = -320, TERMINAL = 448;
const SLOPES = {16:[0,-224,192],17:[0,-224,192],18:[-24,-224,100],19:[24,-100,224],20:[0,-192,224],21:[0,-192,224]};

export class FixedClock {
  constructor() { this.accumulator = 0; }
  advance(seconds, tick) {
    this.accumulator += clamp(seconds, 0, 0.1);
    let count = 0;
    while (this.accumulator + 1e-10 >= TICK) {
      tick(); this.accumulator -= TICK; count++;
    }
    return count;
  }
  reset() { this.accumulator = 0; }
}

export class Game {
  constructor(level,{difficulty='easy'}={}) {
    if(!DIFFICULTIES[difficulty])throw new Error(`Unknown difficulty: ${difficulty}`);
    this.difficulty=difficulty;this.world=level;this.level=level;this.reset();
  }
  get healthMultiplier(){return DIFFICULTIES[this.difficulty];}
  setDifficulty(difficulty) {
    if(!DIFFICULTIES[difficulty])return false;
    const ratio=DIFFICULTIES[difficulty]/this.healthMultiplier;
    this.maxHealth=Math.ceil(this.maxHealth*ratio);
    this.health=Math.min(this.maxHealth,Math.ceil(this.health*ratio));
    this.difficulty=difficulty;return true;
  }

  reset() {
    this.level=this.world;
    this.tickNumber = 0;
    this.lives = START_LIVES; this.health = this.maxHealth = 3*this.healthMultiplier;
    this.coins = 0; this.score = 0;
    this.energy = this.energyCap = 0x180;
    this.keys = [0, 0]; this.weapon=0;this.altEnergy=0;
    this.cooldown = 0; this.speedBoost = 0;
    this.projectiles = []; this.effects = []; this.events = [];this.sounds=[];
    this.over = false;this.kills=0;this.dropChain=0;this.lastKillTick=-100;
    this.startStage(this.world.id||0);
  }

  startStage(id,checkpoint=null) {
    const native=id===(this.world.id||0)?this.world:this.world.levels?.[id];
    if(!native)throw new Error(`Level ${id} is not available.`);
    this.level={...this.world,...native};
    this.cells=Uint16Array.from(this.level.cells);this.flags=new Uint8Array(256);
    this.marbles=[...(this.level.marbleQuota||[0,0,0])];this.keys=[0,0];
    this.zone=0;this.completed=false;this.exitTimer=0;this.checkpoint=checkpoint;this.boss=null;this.bossDefeated=false;
    this.waterLevel=this.level.zones?.[0]?.words[4]||0;
    this.drops=[];this.effects=[];this.cooldown=0;this.sounds.length=0;
    initEntities(this);this.respawn();
  }
  advanceLevel() {
    if(!this.completed||!this.world.levels?.[this.level.nextLevel])return false;
    this.startStage(this.level.nextLevel);return true;
  }

  insertCoin() {
    // Browser arcade continue: keep the reached stage/checkpoint and score.
    // This is a virtual credit, independent of collected bonus coins.
    if(!this.over)return false;
    this.over=false;this.lives=START_LIVES;
    this.weapon=0;this.altEnergy=0;this.energy=this.energyCap;this.speedBoost=0;
    this.dropChain=0;this.lastKillTick=-100;this.events.length=0;
    this.startStage(this.level.id||0,this.checkpoint);
    return true;
  }

  respawn() {
    this.player = { ...(this.checkpoint?.spawn||this.level.spawn), vx:0, vy:0, facing:1, mode:MODE.AIR,
      duck:0, aim:0, firing:false, hit:0, jumpOrigin:this.level.spawn.y,
      minVX:-224, maxVX:224, slopePush:0, animation:0, hurtTimer:0, deathTimer:0 };
    this.health = this.maxHealth; this.invulnerable = 64;
    this.camera = { ...(this.checkpoint?.camera||this.level.camera) };
    this.projectiles.length = 0;
    this.animation = new PlayerAnimation(this.level.playerAnimations);
  }

  cell(tx, ty) {
    if (tx < 0 || tx >= this.level.width || ty < 0) return 0x400;
    if (ty >= this.level.height) return 0;
    return this.cells[ty * this.level.width + tx];
  }
  at(x, y) { return this.cell(Math.floor(x / 16), Math.floor(y / 16)); }
  typeAt(x, y) { return tileType(this.at(x,y)); }
  tileImage(word) {
    const id = word & 1023;
    if (!(word & 0x8000)) return id;
    const animation = this.level.tileAnimations[id];
    if (!animation) return 0;
    // The loader calls anim_objects once before entering the main loop.
    return animation.frames[(animation.counter + 1 + this.tickNumber) % animation.frames.length];
  }

  friction(amount) {
    const p = this.player;
    p.vx = Math.sign(p.vx) * Math.max(0, Math.abs(p.vx) - amount);
  }
  gravity() { // $4C96A tests BEFORE adding; a final step may exceed 448.
    if (this.player.vy < TERMINAL) this.player.vy += GRAVITY;
  }

  horizontal(input) { // $4D31C / $4C8F4 / $4C93E
    const p = this.player;
    if (p.vx < p.minVX || p.vx >= p.maxVX) this.friction(6);
    const direction = input & INPUT.LEFT ? -1 : input & INPUT.RIGHT ? 1 : 0;
    if (p.duck || p.firing) {
      if (direction) p.facing = direction;
      this.friction(FRICTION);
    } else if (direction) {
      if (direction < 0 && p.vx > p.minVX || direction > 0 && p.vx < p.maxVX) {
        p.vx += direction * ACCEL;
        if (direction < 0 && p.vx < 0 && p.vx > -32) p.vx = -32;
        if (direction > 0 && p.vx >= 0 && p.vx < 32) p.vx = 32;
      }
    } else {
      if (Math.abs(p.vx) < 96) p.vx += p.slopePush;
      this.friction(FRICTION);
    }
  }

  ladder() {
    const p = this.player;
    return Number(this.typeAt(p.x,p.y-32) === 3) + Number(this.typeAt(p.x,p.y-16) === 3);
  }

  floor() { // $4D040. Probe offsets at $4D15C/$4D15E are self-modified.
    const p = this.player;
    const platform=this.entities.find(e=>!e.dead&&e.active&&e.platformWidth&&p.x+7>=e.x+e.platformX&&p.x-7<=e.x+e.platformX+e.platformWidth&&p.y>=e.y+e.platformY&&p.y<=e.y+e.platformY+8);
    if(platform)return platform.y+platform.platformY;
    for (const [ox, oy, skipPlatform] of [[0,-16,true],[0,0,true],[0,8,false],[-7,0,false],[7,0,false]]) {
      const x = p.x + ox, y = p.y + oy;
      const type = this.typeAt(x,y);
      if (!this.level.collision.floor[type] || skipPlatform && type === 2) continue;
      const heights = this.level.collision.heights[type];
      if (!heights) continue;
      const surface = (y & ~15) + heights[x & 15];
      if (p.mode !== MODE.GROUND && (surface > p.y || type !== 1 && surface < p.jumpOrigin)) return null;
      [p.slopePush, p.minVX, p.maxVX] = SLOPES[type] || [0,-224,224];
      return surface;
    }
    return null;
  }

  integrate() { // $4CF1C: vertical collision precedes horizontal collision.
    const p = this.player;
    p.hit = 0; p.slopePush = 0;
    const dy = velToPixels(p.vy);
    p.y += dy;
    if (dy < 0) {
      const height = 33 - p.duck; // $4CFC8 stores this at $4D03E.
      for (const ox of [-7,7]) {
        if (!this.level.collision.ceiling[this.typeAt(p.x+ox,p.y-height)]) continue;
        p.y = ((p.y-height) & ~15) + 16 + height;
        p.vy = 1; p.vx = 0; p.hit |= 1; break;
      }
    } else if (p.mode !== MODE.CLIMB) {
      const surface = this.floor();
      if (surface !== null) { p.y = surface; p.vy = 0; p.hit |= 2; }
    }
    const dx = velToPixels(p.vx);
    p.x += dx;
    if (dx) {
      p.facing = Math.sign(dx);
      const side = Math.sign(dx), x = p.x + side * 8;
      // d3 in $4D160/$4D1B8 is NEGATIVE row stride: the second probe is above.
      for (const oy of p.duck ? [-16] : [-16,-32]) {
        if (!this.level.collision.wall[this.typeAt(x,p.y+oy)]) continue;
        p.x = (x & ~15) + (side < 0 ? 24 : -8);
        p.vx = 0; p.hit |= side < 0 ? 4 : 8; break;
      }
    }
    p.x = clamp(p.x, 8, this.level.width * 16 - 8);
  }

  jump() {
    const p = this.player;
    p.mode = MODE.AIR; p.vy = JUMP_VY; p.jumpOrigin = p.y;
    p.duck = 0; p.firing = false; p.animation = 0;
    this.events.push('jump');
  }

  tick(input = 0) {
    if (this.over||this.completed) return;
    const p = this.player;
    this.tickNumber++; p.animation++;
    p.inWater=this.waterLevel>0&&p.y-16>=this.waterLevel;
    this.events.length = 0;
    this.sounds.length = 0;
    if(this.exitTimer) {
      if(!--this.exitTimer)this.completed=true;
      return;
    }
    if (this.invulnerable) this.invulnerable--;
    if (this.speedBoost) this.speedBoost--;
    updateEntities(this);
    const up = !!(input & INPUT.UP), down = !!(input & INPUT.DOWN);
    const jump = !!(input & (INPUT.UP | INPUT.JUMP));
    if (p.mode === MODE.DEATH) {
      this.gravity();
      p.y += velToPixels(p.vy);
      if (++p.deathTimer >= 65) {
        if (--this.lives <= 0) { this.lives = 0; this.over = true; }
        else this.startStage(this.level.id||0,this.checkpoint);
      }
    } else if(p.inWater&&p.mode!==MODE.HURT) {
      p.mode=MODE.AIR;p.firing=false;p.duck=0;p.aim=0;p.minVX=-96;p.maxVX=96;
      this.horizontal(input);
      if(input&31){p.vy=jump?-64:down?64:0;if(input&INPUT.LEFT)p.vx=-96;else if(input&INPUT.RIGHT)p.vx=96;}
      else p.vy=p.vy>=112?112:p.vy+7;
      this.integrate();if(p.hit&2)p.mode=MODE.GROUND;
    } else if (p.mode === MODE.GROUND) {
      if (this.speedBoost) { p.minVX = -320; p.maxVX = 320; }
      if (!down) p.duck = 0;
      // Space is an extra jump button; joystick Up still aims while standing/fire.
      p.firing = !!(input & INPUT.FIRE) && !p.vx && !(input & INPUT.JUMP);
      if (p.firing && down) p.duck = 16;
      // Crouching keeps the gun horizontal, including simultaneous Down + Fire.
      p.aim = p.firing && !p.duck && up ? (input & 12 ? 2 : 1) : 0;
      this.horizontal(input); this.integrate();
      if (!(p.hit & 2)) { p.mode = MODE.AIR; p.jumpOrigin = p.y; p.vy = 30; }
      else if (!p.firing) {
        if ((down || up) && this.ladder() && !p.vx) { p.mode = MODE.CLIMB; }
        else if (down) p.duck = 16;
        else if (jump) this.jump();
      }
    } else if (p.mode === MODE.AIR) {
      p.firing = false; p.aim = 0; p.duck = 0;
      if (p.vy < 0) p.jumpOrigin = p.y;
      if (up && p.vy >= 0 && this.ladder() === 2) { p.mode = MODE.CLIMB; p.vx = p.vy = 0; }
      else {
        p.vy += down ? 30 : jump ? -10 : 0;
        this.gravity();
        p.minVX = -128; p.maxVX = 128;
        this.horizontal(input); this.integrate();
        if (p.hit & 2) { p.mode = MODE.GROUND; p.vy = 0; }
      }
    } else if (p.mode === MODE.CLIMB) {
      p.firing = false; p.x &= ~1; p.vx = p.vy = 0;
      if (input & INPUT.JUMP) this.jump();
      else if (!this.ladder()) { p.mode = MODE.AIR; p.jumpOrigin = p.y; p.vy = 30; }
      else {
        p.vy = up ? -96 : down ? 96 : 0;
        p.vx = input & INPUT.LEFT ? -64 : input & INPUT.RIGHT ? 64 : 0;
        this.integrate();
      }
    } else if (p.mode === MODE.HURT) {
      this.gravity(); this.integrate();
      if (--p.hurtTimer <= 0) { p.mode = p.hit & 2 ? MODE.GROUND : MODE.AIR; this.invulnerable = 32; }
    }
    if (p.mode !== MODE.DEATH) {
      this.collect(); this.fire(input);
      if (p.y > this.level.height * 16 + 32) this.die();
    }
    this.moveProjectiles();
    updateDrops(this);
    this.effects = this.effects.filter(effect => ++effect.age < effect.life);
    for(const object of [...this.effects,...this.projectiles]) {
      if(object.native&&!object.anim){object.anim=object.native;object.animCounter=0;}
      if(object.animation&&!object.anim){object.anim=object.animation;object.animCounter=0;}
      if(object.anim)advanceAnimation(object,this.level.bobSteps||{});
    }
    for(const [index,step] of [[16,1],[17,2],[18,3],[19,4]])this.flags[index]=(this.flags[index]+step)&255;
    this.animation.tick(this.player);
    if (this.player.mode !== MODE.DEATH) this.updateCamera();
  }

  updateCamera() {
    const p = this.player, c = this.camera;
    // Browser camera uses a small dead zone; original scroll tables are a later port step.
    const targetX = p.x - (p.facing > 0 ? 120 : 200), targetY = p.y - 144;
    c.x = clamp(c.x + clamp(targetX-c.x,-8,8), 0, Math.max(0,this.level.width*16-320));
    c.y = clamp(c.y + clamp(targetY-c.y,-6,6), 0, Math.max(0,this.level.height*16-200));
  }

  collect() { // $4D3C4 / $4D732
    const p = this.player;
    const visited = new Set();
    for (const oy of [-32,-16,0]) for (const ox of [-8,8]) {
      const tx = (p.x+ox)>>4, ty=(p.y+oy)>>4;
      if (tx<0 || ty<0 || tx>=this.level.width || ty>=this.level.height) continue;
      const index = ty*this.level.width+tx;
      if (visited.has(index)) continue;
      visited.add(index);
      const word=this.cells[index], id=word & 0x83ff;
      const type=tileType(word);
      if(type===6){this.die();return;}
      if(type===7)this.trigger(index);
      if(type===5&&p.vy>=0&&[32,34,36].includes(id)) {this.cells[index]++;this.trigger(index);this.sound(0x4d);continue;}
      if(type===10){roomTile(this,index);continue;}
      if(type===24||type===25){unlockTile(this,index,type);continue;}
      if (givePickup(this,id)) {
        this.cells[index]=0;
        this.effects.push({x:tx*16+8,y:ty*16+8,age:0,life:18,kind:'pickup'});
      }
    }
  }

  fire(input) {fireWeapon(this,input);}
  moveProjectiles() {moveProjectiles(this);}
  trigger(index) {trigger(this,index);}
  updateLevelObject(entity) {updateLevelObject(this,entity);}
  entityBox(entity) {return entityBox(entity);}
  damageEntity(entity,damage) {damageEntity(this,entity,damage);}
  spawnDrop(x,y) {spawnDrop(this,x,y);}
  equipWeapon(id) {return equipWeapon(this,id);}
  sound(id,x=this.player.x,gain=1) {this.sounds.push({id,x,gain});}

  hurt() {
    const p=this.player;
    if (this.invulnerable || p.mode===MODE.HURT || p.mode===MODE.DEATH) return;
    if (--this.health<=0) { this.die(); return; }
    p.mode=MODE.HURT; p.vx=p.facing<0?64:-96; p.vy=-160;
    p.duck=0; p.aim=0; p.hurtTimer=20;
    this.events.push('hurt');this.sound(0x43);
  }
  die() {
    if (this.player.mode===MODE.DEATH) return;
    this.health=0; this.player.mode=MODE.DEATH; this.player.vy=-256; this.player.deathTimer=0;
    this.events.push('hurt');this.sound(0x54);
  }
}
