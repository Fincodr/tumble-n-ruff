// Original RJP effects, rendered offline by scripts/native_sfx.py.
// Music remains independent, since the existing track is a rendered MP3.
export function pcmBuffer(context,bytes) {
  const data=new DataView(bytes);
  const tag=at=>String.fromCharCode(...new Uint8Array(bytes,at,4));
  if(bytes.byteLength<44||tag(0)!=='RIFF'||tag(8)!=='WAVE')throw new Error('Invalid sound effect WAV');
  let format,channels,rate,bits,start,length;
  for(let at=12;at+8<=bytes.byteLength;) {
    const size=data.getUint32(at+4,true),body=at+8;
    if(body+size>bytes.byteLength)throw new Error('Truncated sound effect WAV');
    if(tag(at)==='fmt '&&size>=16){format=data.getUint16(body,true);channels=data.getUint16(body+2,true);rate=data.getUint32(body+4,true);bits=data.getUint16(body+14,true);}
    else if(tag(at)==='data'){start=body;length=size;}
    at=body+size+(size&1);
  }
  if(format!==1||bits!==16||channels!==1||!rate||!length||length%2)throw new Error('Unsupported sound effect PCM format');
  const buffer=context.createBuffer(1,length/2,rate),samples=buffer.getChannelData(0);
  for(let i=0;i<samples.length;i++)samples[i]=data.getInt16(start+i*2,true)/32768;
  return buffer;
}

export class SoundEffects {
  constructor({contextFactory, fetcher=(...args)=>globalThis.fetch(...args), onChange=()=>{}}={}) {
    this.contextFactory=contextFactory||(()=>new (globalThis.AudioContext||globalThis.webkitAudioContext)({latencyHint:'interactive'}));
    // Keep native fetch's Window receiver instead of invoking it as this.fetcher.
    this.fetcher=fetcher;this.onChange=onChange;this.enabled=true;this.active=false;
    this.buffers=new Map();this.voices=[];this.lastPlayed=new Map();this.error=null;
    this.encoded=null;this.context=null;this.decoding=null;
  }
  async load(base='./assets/') {
    this.base=base;
    try {
      const manifest=await this.fetcher(base+'sfx.json');
      if(!manifest.ok)throw new Error(`Sound manifest failed to load (HTTP ${manifest.status??'error'})`);
      const {effects}=await manifest.json();
      this.encoded=await Promise.all(Object.entries(effects).map(async([id,entry])=> {
        const response=await this.fetcher(base+entry.file);
        if(!response.ok)throw new Error(`Sound effect ${id} failed to load (HTTP ${response.status??'error'})`);
        return [Number(id),await response.arrayBuffer()];
      }));
      if(this.context)await this.decode();
      this.onChange();return true;
    } catch(error) {this.fail(error);return false;}
  }
  fail(error) {this.error=error;this.enabled=false;this.stop();this.onChange();}
  async decode() {
    if(!this.encoded||!this.context)return;
    if(!this.decoding)this.decoding=Promise.all(this.encoded.map(async([id,bytes])=> {
      // The builder emits mono signed 16-bit PCM. No media codec is needed.
      this.buffers.set(id,pcmBuffer(this.context,bytes));
    }));
    await this.decoding;
  }
  async activate(active) {
    this.active=active;
    if(!active||!this.enabled) {
      this.stop();
      if(this.context?.state==='running')await this.context.suspend().catch(()=>{});
      return;
    }
    try {
      // Called directly from Play/resume/toggle gestures, before fetching or decoding.
      if(!this.context) {
        this.context=this.contextFactory();
        this.master=this.context.createGain();this.master.gain.value=0.42;
        const compressor=this.context.createDynamicsCompressor();
        compressor.threshold.value=-12;compressor.knee.value=12;compressor.ratio.value=6;
        this.master.connect(compressor);compressor.connect(this.context.destination);
      }
      await this.context.resume();
      await this.decode();
      // A pause/mute can arrive while resume/decode is pending.
      if(!this.active||!this.enabled)await this.context.suspend();
      this.onChange();
    } catch(error) {this.fail(error);}
  }
  setEnabled(value) {
    if(this.error&&value)return this.retry();
    this.enabled=!!value;this.onChange();return this.activate(this.active);
  }
  async retry() {
    this.error=null;this.enabled=true;this.encoded=null;this.decoding=null;this.buffers.clear();
    if(this.context?.state==='closed')this.context=null;
    this.onChange();
    // Resume synchronously from the click before awaiting network requests.
    const activation=this.activate(this.active);
    await this.load(this.base);await activation;
    return !this.error;
  }
  stop() {
    for(const voice of [...this.voices]) {voice.source.stop();voice.cleanup();}
    this.lastPlayed.clear();
  }
  playEvents(events,camera={x:0}) {
    if(!this.enabled||!this.active||this.context?.state!=='running')return;
    const now=this.context.currentTime;
    for(const event of events) {
      const buffer=this.buffers.get(event.id);
      if(!buffer)continue;
      const distance=event.x==null?0:Math.max(0,Math.abs(event.x-camera.x-160)-160);
      if(distance>=320)continue;
      // Cap rapid-fire overlap, coalesce same-tick duplicates, and bound voices.
      const interval=event.id===0x40?0.08:0.025;
      if(now-(this.lastPlayed.get(event.id)??-Infinity)<interval)continue;
      this.lastPlayed.set(event.id,now);
      if(this.voices.length>=12) {const old=this.voices[0];old.source.stop();old.cleanup();}
      const source=this.context.createBufferSource(),gain=this.context.createGain();
      source.buffer=buffer;gain.gain.value=(event.gain??1)*(1-distance/320);
      source.connect(gain);
      const panner=this.context.createStereoPanner?.();
      if(panner) {
        panner.pan.value=event.x==null?0:Math.max(-0.7,Math.min(0.7,(event.x-camera.x-160)/320));
        gain.connect(panner);panner.connect(this.master);
      } else gain.connect(this.master);
      const voice={source,cleanup:()=> {
        source.disconnect();gain.disconnect();panner?.disconnect();
        const index=this.voices.indexOf(voice);if(index>=0)this.voices.splice(index,1);
      }};
      source.onended=voice.cleanup;this.voices.push(voice);source.start(now);
    }
  }
}

export function pickupSound(id) {
  if(id>=0x8000&&id<=0x8004)return 0x45; // Marbles and both keys ($4D594/$4D5A0).
  if(id>=0x800a&&id<=0x800c)return 0x4f;
  if(id===0x8009)return 0x44;
  if(id===0x8008||id>=0x56&&id<=0x5d)return 0x47;
  if(id===12||id===0x800d)return 0x46;
  if(id===11)return 0x48;
  return 0x49;
}
