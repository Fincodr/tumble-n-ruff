import {Renderer} from './renderer.js';
import {Game, FixedClock, INPUT, MODE, START_LIVES} from './game.js';
import {WEAPONS} from './weapons.js';
import {SoundEffects} from './audio.js';
import {drawWater} from './water.js';
import {initGameViewport} from './viewport.js';

const $ = id => document.getElementById(id);
const canvas=$('game'), clock=new FixedClock();
const held=new Set(), pointers=new Map();
const keys={ArrowUp:INPUT.UP,KeyW:INPUT.UP,ArrowDown:INPUT.DOWN,KeyS:INPUT.DOWN,
  ArrowLeft:INPUT.LEFT,KeyA:INPUT.LEFT,ArrowRight:INPUT.RIGHT,KeyD:INPUT.RIGHT,
  Space:INPUT.JUMP,KeyZ:INPUT.JUMP,KeyJ:INPUT.FIRE,KeyX:INPUT.FIRE,ControlLeft:INPUT.FIRE,ControlRight:INPUT.FIRE};
let game, renderer, sprites, textures, ready=false, running=false, started=false, debug=false;
const visualSets=new Map();let currentVisual='w1-p0';
let musicEnabled=false, musicWorld=1, lastTime=0, loopId=0;
const music=new Audio('./assets/world1.mp3');
music.loop=true; music.volume=0.4; music.preload='none';
const sound=new SoundEffects({onChange:()=> {
  $('sfx').textContent=sound.error?'SFX · Retry':sound.enabled?'SFX on':'SFX off';
  $('sfx').setAttribute('aria-pressed',String(sound.enabled));
  $('sfx').disabled=false;
  $('sfx').title=sound.error?sound.error.message:'Toggle original sound effects';
  $('audio-error').hidden=!sound.error;
  $('audio-error').textContent=sound.error?`${sound.error.message}. Select SFX · Retry to try again.`:'';
}});
void sound.load();

async function loadJSON(url) {
  const response=await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status}).`);
  return response.json();
}
function loadImage(url) {
  return new Promise((resolve,reject) => {
    const image=new Image(); image.onload=()=>resolve(image);
    image.onerror=()=>reject(new Error(`Could not load ${url}.`)); image.src=url;
  });
}

function setMusic() {
  const world=game?.level.worldNumber||1;
  if(musicWorld!==world){music.pause();music.src=`./assets/world${world}.mp3`;musicWorld=world;}
  if (musicEnabled && running) music.play().catch(error=> {
    if(error.name==='AbortError'||!running||!musicEnabled)return;
    musicEnabled=false; $('sound').textContent='Music off'; $('sound').setAttribute('aria-pressed','false');
  });
  else music.pause();
}
function input() {
  let bits=0;
  for (const code of held) bits |= keys[code] || 0;
  for (const bit of pointers.values()) bits |= bit;
  return bits;
}
function overlay(title, message, button) {
  $('overlay').hidden=false; $('overlay-title').textContent=title;
  $('overlay-message').textContent=message; $('start').textContent=button;
  $('start').classList.toggle('coin-continue',ready&&game.over);
}
function start() {
  if (!ready) return;
  const continued=game.over&&game.insertCoin();
  if (game.completed&&!game.advanceLevel()) game.reset();
  started=true; running=true; clock.reset();sound.stop();
  void sound.activate(true).then(()=> {
    if(continued&&running)sound.playEvents([{id:0x44}]);
  });
  $('overlay').hidden=true; $('pause').innerHTML='Pause <kbd>P</kbd>';
  canvas.focus({preventScroll:true}); setMusic();
}
function pause() {
  if (!ready || !started || game.over || game.completed) return;
  running=!running; clock.reset(); held.clear(); pointers.clear();
  if (running) { $('overlay').hidden=true; $('pause').innerHTML='Pause <kbd>P</kbd>'; canvas.focus({preventScroll:true}); }
  else { overlay('Paused','Take a breather, little fella.','Resume'); $('pause').innerHTML='Resume <kbd>P</kbd>'; }
  setMusic();void sound.activate(running);
}
function restart() { if (ready) { held.clear(); pointers.clear(); game.reset(); start(); } }
function toggleDebug() { debug=!debug; $('collision').setAttribute('aria-pressed',String(debug)); }

function globalSprite(id,x,y,flip=false,tint) {
  const frame=sprites.global[id];
  if (frame) renderer.sprite(textures.global,frame,x,y,flip,tint);
}

function drawParts(object,cx,cy) {
  for(const part of object.parts||[]) {
    const frame=sprites.bobs[`${part.bank}:${part.id}`];
    if(frame)renderer.sprite(textures.bobs,frame,object.x-cx+part.x,object.y-cy+part.y,false,
      object.hitFlash?[1,0.5,0.5,1]:[1,1,1,1]);
  }
}

function render() {
  if (!ready) return;
  if(currentVisual!==game.level.visual) {
    const visual=visualSets.get(game.level.visual);
    if(!visual)throw new Error(`Graphics missing for ${game.level.visual}`);
    sprites=visual.sprites;textures=visual.textures;currentVisual=game.level.visual;
    for(let i=0;i<3;i++)$('marble-'+i).previousElementSibling.src=`./assets/${visual.base}marble-${i}.png`;
  }
  const p=game.player, camera=game.camera;
  const cx=Math.round(camera.x), cy=Math.round(camera.y);
  renderer.begin();
  const firstX=Math.floor(cx/16), firstY=Math.floor(cy/16);
  for (let ty=firstY;ty<=firstY+13;ty++) for (let tx=firstX;tx<=firstX+20;tx++) {
    if (tx<0 || ty<0 || tx>=game.level.width || ty>=game.level.height) continue;
    const tile=game.tileImage(game.cell(tx,ty)), x=tx*16-cx, y=ty*16-cy;
    if (tile<sprites.tiles.count) renderer.sprite(textures.tiles,{x:tile%32*16,y:Math.floor(tile/32)*16,w:16,h:16},x,y);
  }
  for(const entity of game.entities)if(entity.active&&!entity.dead)drawParts(entity,cx,cy);
  for(const drop of game.drops)drawParts(drop,cx,cy);
  for (const effect of game.effects) {
    if(effect.parts?.length){drawParts(effect,cx,cy);continue;}
    const id=effect.kind==='pickup' ? 16+Math.min(7,Math.floor(effect.age/3)) : effect.kind==='impact' ? 30+Math.min(7,effect.age) : 38;
    const frame=sprites.global[id];
    if (frame) globalSprite(id,effect.x-cx-frame.w/2,effect.y-cy-frame.h/2);
  }
  for (const shot of game.projectiles) {
    if(shot.parts?.length){drawParts(shot,cx,cy);continue;}
    renderer.rect(shot.x-cx-4,shot.y-cy-1,8,3,[0.45,0.25,0.85,1]);
    renderer.rect(shot.x-cx-3,shot.y-cy,6,1,[1,1,1,1]);
  }
  if (!game.invulnerable || Math.floor(game.invulnerable/3)%2===0 || !running) {
    for (const part of game.animation.parts) {
      renderer.sprite(textures.ruff,sprites.ruffHalves[part.id],p.x-cx+part.x,p.y-cy+part.y,part.flip);
    }
  }
  drawWater(renderer,game,cx,cy);
  if (debug) {
    for (let ty=firstY;ty<=firstY+13;ty++) for (let tx=firstX;tx<=firstX+20;tx++) {
      const word=game.cell(tx,ty), type=(word>>10)&31;
      if (!type) continue;
      const x=tx*16-cx,y=ty*16-cy;
      const color=type===1||type===4?[1,0.25,0.2,0.25]:type===2?[0.2,0.7,1,0.4]:type>=13&&type<=23?[1,0.8,0.1,0.4]:type===3?[0.3,1,0.3,0.4]:[0.8,0.4,1,0.18];
      renderer.rect(x,y,16,16,color);
      if (type>=13&&type<=23) for (let px=0;px<16;px++) renderer.rect(x+px,y+game.level.collision.heights[type][px],1,1,[1,1,0,1]);
    }
    renderer.rect(p.x-cx-8,p.y-cy-33+p.duck,16,33-p.duck,[0.1,0.9,1,0.35]);
    for(const e of game.entities)if(e.active&&!e.dead&&e.shootable){const b=game.entityBox(e);renderer.rect(b.x-cx,b.y-cy,b.w,b.h,[1,0.2,0.2,0.35]);}
  }
  renderer.flush();
  $('lives').textContent=`× ${game.lives}`;
  $('health').textContent=game.maxHealth>5?`♥ ${game.health} / ${game.maxHealth}`:
    '♥ '.repeat(game.health)+'♡ '.repeat(game.maxHealth-game.health);
  $('health').setAttribute('aria-label',`${game.health} of ${game.maxHealth} health`);
  $('energy').max=game.weapon?768:game.energyCap; $('energy').value=game.weapon?game.altEnergy:game.energy;
  $('weapon').textContent=WEAPONS[game.weapon].name;
  for(let i=0;i<3;i++)$('marble-'+i).textContent=game.marbles[i];
  $('objective').textContent=game.level.isBoss?(game.bossDefeated?'Boss defeated · Find the exit':'Defeat the boss to open the exit'):game.marbles.every(n=>!n)?'Exit unlocked':'Collect marbles to unlock the exit';
  $('keys').textContent=`Keys ${game.keys[0]} / ${game.keys[1]}`;
  $('stage').textContent=`WORLD ${game.level.stage}`;
  $('world-name').textContent=game.level.name.toUpperCase();
  $('stage-select').value=String(game.level.id||0);
  $('boss-hud').hidden=!game.boss||game.bossDefeated;
  if(game.boss){$('boss-name').textContent=game.boss.health?game.boss.name:'Defeated';$('boss-energy').max=game.boss.maxHealth;$('boss-energy').value=game.boss.health;}
  $('overlay-kicker').textContent=`WORLD ${game.level.stage}`;
  $('coins').textContent=String(game.coins).padStart(2,'0');
  $('score').textContent=String(game.score).padStart(6,'0');
  $('immersive-pause').textContent=running||!started?'Pause':'Resume';
  $('immersive-pause').disabled=!started||game.over||game.completed;
}

function frameLoop(now) {
  const elapsed=lastTime?(now-lastTime)/1000:0;
  lastTime=now;
  if (ready && running) {
    clock.advance(elapsed,()=>{game.tick(input());sound.playEvents(game.sounds,game.camera);});
    if (game.over) {
      running=false; setMusic();
      held.clear();pointers.clear();
      overlay('Continue?',`${START_LIVES} fresh lives. Resume from your checkpoint or stage start. Press C or Enter to insert a coin.`, 'Insert coin · Continue');
    } else if(game.completed) {
      running=false;setMusic();
      const next=game.world.levels?.[game.level.nextLevel];
      overlay(next?(game.level.isBoss?'Boss defeated':'Level clear'):'Campaign complete',next?`Next: ${next.stage} · ${next.name}`:'All four worlds are complete. Ruff made it home!',next?'Next stage':'Play again');
    }
  }
  render();
  loopId=requestAnimationFrame(frameLoop);
}

document.addEventListener('keydown',event=> {
  if(event.target.closest('select,input,textarea'))return;
  if(event.code==='Escape'&&viewport.active&&!viewport.native) {
    event.preventDefault();void viewport.exit();return;
  }
  if (event.target.closest('button') && ['Enter','Space'].includes(event.code)) return;
  if (keys[event.code] || ['Enter','KeyP','Escape','KeyR','F2'].includes(event.code) || event.code==='KeyC'&&ready&&game.over) event.preventDefault();
  if (event.repeat) return;
  held.add(event.code);
  if (event.code==='KeyP' || event.code==='Escape') pause();
  else if (event.code==='KeyR') restart();
  else if (event.code==='F2') toggleDebug();
  else if (event.code==='KeyC'&&ready&&game.over) start();
  else if (!running && (event.code==='Enter' || keys[event.code]===INPUT.FIRE)) start();
});
document.addEventListener('keyup',event=>held.delete(event.code));
window.addEventListener('blur',()=> { held.clear(); pointers.clear(); if (running) pause(); else void sound.activate(false); });
document.addEventListener('visibilitychange',()=> { if(document.hidden){if(running)pause();else void sound.activate(false);}lastTime=0;clock.reset(); });
$('start').addEventListener('click',start);
$('pause').addEventListener('click',pause);
$('immersive-pause').addEventListener('click',pause);
$('restart').addEventListener('click',restart);
$('stage-select').addEventListener('change',()=> {
  if(!ready)return;
  const id=Number($('stage-select').value);
  held.clear();pointers.clear();game.reset();game.startStage(id);start();
});
$('difficulty').addEventListener('change',()=> {
  if(ready)game.setDifficulty($('difficulty').value);
  try{localStorage.setItem('ruff-difficulty',$('difficulty').value);}catch{}
});
$('crt').checked=false;
$('crt').addEventListener('change',()=> {
  $('crt-scanlines').hidden=!$('crt').checked;
});
$('collision').addEventListener('click',toggleDebug);
$('sound').addEventListener('click',()=> {
  musicEnabled=!musicEnabled; $('sound').setAttribute('aria-pressed',String(musicEnabled));
  $('sound').textContent=musicEnabled?'Music on':'Music off'; setMusic();
});
$('sfx').addEventListener('click',()=>{void sound.setEnabled(!!sound.error||!sound.enabled);});
const viewport=initGameViewport({
  shell:$('game-shell'),button:$('fullscreen'),expandButton:$('immersive-expand'),exitButton:$('immersive-exit'),
  onChange:()=>{held.clear();pointers.clear();},
});
// A held touch is game input, including on browsers with long-press selection menus.
for (const name of ['contextmenu','selectstart']) {
  $('game-shell').addEventListener(name,event=>event.preventDefault());
}
for (const button of document.querySelectorAll('[data-input]')) {
  button.addEventListener('pointerdown',event=> {
    event.preventDefault(); button.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId,Number(button.dataset.input));
    if (!running) start();
  });
  for (const name of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(name,event=>pointers.delete(event.pointerId));
}
canvas.addEventListener('webglcontextlost',event=> {
  event.preventDefault(); running=false; ready=false; setMusic();void sound.activate(false);cancelAnimationFrame(loopId);
  overlay('Graphics paused','The graphics context was lost. Reload to restore the game.','Reload');
  $('start').disabled=false; $('start').onclick=()=>location.reload();
});

try {
  const [level,meta,...images]=await Promise.all([
    loadJSON('./assets/level.json'),loadJSON('./assets/sprites.json'),
    loadImage('./assets/tiles.png'),loadImage('./assets/ruff-halves.png'),loadImage('./assets/global.png'),loadImage('./assets/bobs.png'),
  ]);
  try{const saved=localStorage.getItem('ruff-difficulty');if(['easy','normal'].includes(saved))$('difficulty').value=saved;}catch{}
  game=new Game(level,{difficulty:$('difficulty').value}); sprites=meta; renderer=new Renderer(canvas);
  textures={tiles:renderer.upload(images[0]),ruff:renderer.upload(images[1]),global:renderer.upload(images[2]),bobs:renderer.upload(images[3])};
  visualSets.set('w1-p0',{sprites:meta,textures,base:''});
  await Promise.all(Object.entries(level.visualSets||{}).filter(([key])=>key!=='w1-p0').map(async([key,{base}])=> {
    const [sprites,...images]=await Promise.all([loadJSON(`./assets/${base}sprites.json`),...['tiles.png','ruff-halves.png','global.png','bobs.png'].map(file=>loadImage(`./assets/${base}${file}`))]);
    visualSets.set(key,{sprites,base,textures:{tiles:renderer.upload(images[0]),ruff:renderer.upload(images[1]),global:renderer.upload(images[2]),bobs:renderer.upload(images[3])}});
  }));
  for(const id of level.campaignOrder||[0,1,2,3,7]) {
    const stage=id?level.levels[id]:level,option=document.createElement('option');
    option.value=id;option.textContent=`${stage.stage} · ${stage.name}`;$('stage-select').append(option);
  }
  $('stage-select').disabled=false;
  ready=true; $('start').disabled=false;
  overlay('The Fantasy Forest','Collect the coloured marbles to open the exit. Arrows move · Space jumps · J fires.','Play');
  requestAnimationFrame(frameLoop);
} catch (error) {
  console.error(error);
  overlay('Unable to start',error.message,'Reload');
  $('start').disabled=false; $('start').onclick=()=>location.reload();
}
