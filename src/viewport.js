// Rotation uses a page-filling layout. Native fullscreen is requested only on a tap.
export function initGameViewport({shell,button,expandButton,exitButton,onChange}) {
  const coarse=matchMedia('(any-pointer: coarse)'), orientation=matchMedia('(orientation: landscape)');
  const screenSpace=shell.querySelector('.screen-space');
  let manual=false, dismissed=false, active=false, landscape=coarse.matches&&orientation.matches;
  let previousNative=false, requestId=0, frame=0;
  const native=()=> (document.fullscreenElement||document.webkitFullscreenElement)===shell;
  const request=shell.requestFullscreen||shell.webkitRequestFullscreen;
  let nativeAvailable=!!request&&(shell.requestFullscreen?document.fullscreenEnabled:document.webkitFullscreenEnabled)!==false;

  function fit() {
    frame=0;
    if(!active)return;
    const view=window.visualViewport, full=native();
    shell.style.setProperty('--viewport-width',`${full?innerWidth:view?.width||innerWidth}px`);
    shell.style.setProperty('--viewport-height',`${full?innerHeight:view?.height||innerHeight}px`);
    shell.style.setProperty('--viewport-left',`${full?0:view?.offsetLeft||0}px`);
    shell.style.setProperty('--viewport-top',`${full?0:view?.offsetTop||0}px`);
    // Measure the space left by HUD, safe areas and controls; keep the native 8:5 view.
    const {width,height}=screenSpace.getBoundingClientRect();
    shell.style.setProperty('--game-width',`${Math.max(0,Math.min(width,height*1.6))}px`);
  }
  function scheduleFit() {if(!frame)frame=requestAnimationFrame(fit);}
  function update() {
    const next=native()||manual||(landscape&&!dismissed), changed=next!==active;
    active=next;
    document.documentElement.classList.toggle('game-immersive',active);
    shell.classList.toggle('is-immersive',active);
    shell.classList.toggle('touch-landscape',landscape);
    button.textContent=active?'Exit fullscreen':'Fullscreen';
    button.title=active?'Return to the page':'Fill the screen with the game';
    button.setAttribute('aria-pressed',String(active));
    expandButton.hidden=!nativeAvailable||native();
    if(changed) {
      onChange();
      (active?shell.querySelector('canvas'):button).focus({preventScroll:true});
    }
    scheduleFit();
  }
  async function exitNative() {
    const exit=document.exitFullscreen||document.webkitExitFullscreen;
    if(native()&&exit)try {await exit.call(document);}catch { /* Keep Exit available if the browser refuses. */ }
  }
  async function enter() {
    const id=++requestId;
    manual=true;dismissed=false;update();
    if(nativeAvailable&&!native()) {
      try {
        await request.call(shell);
        // Rotation or Exit may have happened while the browser's request was pending.
        if(id!==requestId)await exitNative();
      } catch {nativeAvailable=false;}
      update();
    }
  }
  async function exit() {
    requestId++;manual=false;dismissed=landscape;
    update();await exitNative();update();
  }
  function rotated() {
    const next=coarse.matches&&orientation.matches;
    if(next!==landscape) {
      landscape=next;dismissed=false;onChange();
      if(!landscape&&coarse.matches) {
        requestId++;manual=false;
        void exitNative();
      }
    }
    update();
  }
  function fullscreenChanged() {
    const current=native();
    if(previousNative&&!current) {
      requestId++;manual=false;dismissed=landscape;
    }
    previousNative=current;update();
  }
  button.addEventListener('click',()=>{void (active?exit():enter());});
  expandButton.addEventListener('click',()=>{void enter();});
  exitButton.addEventListener('click',()=>{void exit();});
  for(const name of ['fullscreenchange','webkitfullscreenchange'])document.addEventListener(name,fullscreenChanged);
  coarse.addEventListener('change',rotated);
  orientation.addEventListener('change',rotated);
  window.addEventListener('resize',rotated);
  window.visualViewport?.addEventListener('resize',scheduleFit);
  window.visualViewport?.addEventListener('scroll',scheduleFit);
  new ResizeObserver(scheduleFit).observe(screenSpace);
  update();
  return {get active(){return active;},get native(){return native();},exit};
}
