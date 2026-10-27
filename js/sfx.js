/* =========================================================
   효과음 — 파일 없이 브라우저(Web Audio)에서 바로 합성
   저작권·용량 걱정 없음. 브라우저 규칙상 방문자가 화면을 한 번 누른 뒤부터 소리가 남
   card 카드 · click 빈 칸 철컥 · charge 충전 · zap 파지직 · spin 탄창 돌리기 · turn 내 차례 · bet 코인 · win 우승 · out 탈락
   ========================================================= */
const KEY = "comu-sfx", VKEY = "comu-sfx-vol";
let ctx = null, master = null, noiseBuf = null;
let on = true, vol = .7;   // vol: 0~1
try {
  on = localStorage.getItem(KEY) !== "0";
  const v = parseFloat(localStorage.getItem(VKEY));
  if (v >= 0 && v <= 1) vol = v;
} catch (_) {}
const gainOf = v => .8 * Math.pow(v, 1.6);   // 귀로 듣기에 고르게 커지도록

export const sfxOn = () => on && vol > 0;
export const sfxVol = () => (on ? vol : 0);
export function setSfx(v){
  on = !!v;
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (_) {}
  if (on) unlock();
}
/* 소리 크기 0~1. 0이면 끔 */
export function setSfxVol(v){
  vol = Math.min(1, Math.max(0, +v || 0));
  on = vol > 0;
  try { localStorage.setItem(VKEY, String(vol)); localStorage.setItem(KEY, on ? "1" : "0"); } catch (_) {}
  if (master) master.gain.value = gainOf(vol);
  if (on) unlock();
}

function unlock(){
  if (!ctx){
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = gainOf(vol);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}
// 첫 조작 때 오디오를 깨워 둠 (그 전에는 브라우저가 소리를 막음)
["pointerdown", "keydown"].forEach(t => addEventListener(t, () => { if (on) unlock(); }, { capture: true, passive: true }));

const ready = () => on && ctx && ctx.state === "running";
const now = () => ctx.currentTime;

function env(g, t, a, peak, d){
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function tone(type, f, t, a, peak, d, dest = master, f2){
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + d);
  env(g, t, a, peak, d);
  o.connect(g).connect(dest); o.start(t); o.stop(t + a + d + .05);
  return o;
}
function noise(t, dur, peak, type = "bandpass", freq = 3000, q = 1, dest = master){
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
  env(g, t, .002, peak, dur);
  s.connect(f).connect(g).connect(dest); s.start(t, Math.random() * .5); s.stop(t + dur + .05);
  return { s, f, g };
}

const SOUNDS = {
  /* 빈 칸: 공이 치는 금속성 철컥 두 번 */
  click(){
    const t = now();
    noise(t, .03, .9, "bandpass", 3800, 6);
    tone("square", 1900, t, .001, .18, .025);
    noise(t + .075, .05, .6, "bandpass", 2400, 4);
    tone("triangle", 220, t + .075, .002, .35, .07);
  },
  /* 충전: 위로 올라가는 전기 울림 */
  charge(){
    const t = now();
    const o = tone("sawtooth", 180, t, .02, .12, .32, master, 1600);
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 38; lg.gain.value = 60; lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + .4);
    noise(t, .34, .08, "highpass", 5000, .7);
  },
  /* 파지직: 잘게 끊기는 지직거림 + 낮은 웅웅 + 맞는 순간 쿵 */
  zap(){
    const t = now(), dur = .7;
    for (let i = 0, x = 0; x < dur; i++){
      const len = .006 + Math.random() * .03;
      noise(t + x, len, .5 + Math.random() * .5, "bandpass", 1800 + Math.random() * 5200, 2 + Math.random() * 6);
      x += len * (.6 + Math.random() * 1.4);
    }
    const hum = ctx.createOscillator(), hg = ctx.createGain(), hf = ctx.createBiquadFilter();
    hum.type = "square"; hum.frequency.value = 58; hf.type = "lowpass"; hf.frequency.value = 900;
    env(hg, t, .01, .28, dur); hum.connect(hf).connect(hg).connect(master); hum.start(t); hum.stop(t + dur + .05);
    tone("sine", 140, t, .002, .7, .35, master, 40);
    noise(t, .12, .6, "lowpass", 600, .7);
  },
  /* 탄창 돌리기: 빨라졌다 느려지는 딸깍딸깍 */
  spin(){
    const t = now(); let x = 0;
    for (let i = 0; i < 12; i++){
      const gap = .035 + Math.pow(i / 11, 2) * .09;
      noise(t + x, .012, .35, "bandpass", 4200, 8);
      tone("square", 2600, t + x, .001, .05, .01);
      x += gap;
    }
    noise(t + x + .02, .04, .6, "bandpass", 2000, 4);
  },
  /* 카드: 테이블 위로 미끄러지는 쓱 + 톡 */
  card(){
    const t = now();
    const sw = noise(t, .07, .35, "bandpass", 2600, 1.2);
    sw.f.frequency.setValueAtTime(5200, t); sw.f.frequency.exponentialRampToValueAtTime(1400, t + .07);
    noise(t + .06, .025, .45, "bandpass", 1800, 3);
    tone("triangle", 320, t + .06, .002, .12, .05);
  },
  /* 내 차례: 짧은 두 음 */
  turn(){
    const t = now();
    tone("triangle", 880, t, .005, .25, .16);
    tone("triangle", 1320, t + .11, .005, .25, .24);
  },
  /* 코인 놓기: 높은 짤랑 두 번 */
  bet(){
    const t = now();
    [0, .06].forEach((d, i) => { tone("sine", 3100 + i * 420, t + d, .001, .22, .14); tone("sine", 4700 + i * 300, t + d, .001, .1, .08); noise(t + d, .02, .2, "highpass", 6000, 1); });
  },
  /* 탈락: 아래로 떨어지는 소리 */
  out(){
    const t = now();
    tone("square", 440, t, .01, .14, .5, master, 70);
    tone("sine", 220, t, .01, .2, .55, master, 50);
  },
  /* 우승: 올라가는 화음 */
  win(){
    const t = now();
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { tone("square", f, t + i * .09, .005, .09, .32); tone("triangle", f, t + i * .09, .005, .16, .45); });
    tone("triangle", 1567.98, t + .38, .01, .15, .7);
  }
};

export function sfx(name){
  if (!on || vol <= 0) return;
  if (!ctx) unlock();
  if (!ready() || !SOUNDS[name]) return;
  try { SOUNDS[name](); } catch (_) {}
}
