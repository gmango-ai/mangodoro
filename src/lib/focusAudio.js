// Procedural focus-audio engine — no audio files, everything is synthesized
// via WebAudio so the lo-fi / ambience channels actually play without
// shipping (or licensing) media.
//
// Modeled after the design's `focus-audio.js` but exposed as a regular ES
// module so the React surface can import + tear down cleanly. A single
// shared AudioContext is reused across plays; channels are started by
// stopping the previous and wiring new nodes into the master gain.

let ctx = null;
let master = null;
let nodes = [];
let current = null;
let vol = 0.5;

function ac() {
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = vol;
    master.connect(ctx.destination);
  }
  // Most browsers create the AudioContext in "suspended" state until a
  // user gesture resumes it. Calling resume() inside a click handler is
  // enough; the React component should only call play() from a click.
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function noiseBuffer(seconds, type) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (type === "brown") { last = (last + 0.02 * white) / 1.02; d[i] = last * 3.2; }
    else if (type === "pink") { last = 0.97 * last + 0.03 * white; d[i] = (last + white) * 0.5; }
    else d[i] = white;
  }
  return buf;
}

function track(node) { nodes.push(node); return node; }

function stop() {
  for (const n of nodes) {
    try { n.stop ? n.stop() : n.disconnect(); } catch { /* */ }
  }
  nodes = [];
  current = null;
}

function startNoise(bufferType, filterType, freq, q, gain) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(3, bufferType);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filterType; f.frequency.value = freq; if (q) f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(master);
  src.start();
  track(src); track(g);
}

function chord(freqs, gain) {
  const sum = ctx.createGain(); sum.gain.value = gain; sum.connect(master);
  // Slow tremolo so the pad breathes — keeps long sessions from
  // feeling static.
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain(); lfoGain.gain.value = gain * 0.45;
  lfo.connect(lfoGain); lfoGain.connect(sum.gain); lfo.start(); track(lfo);
  freqs.forEach((fr, i) => {
    const o = ctx.createOscillator();
    o.type = i === 0 ? "sine" : "triangle";
    o.frequency.value = fr;
    const og = ctx.createGain(); og.gain.value = 1 / freqs.length;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1400;
    o.connect(lp); lp.connect(og); og.connect(sum); o.start(); track(o);
  });
}

const CHANNELS = {
  lofi() {
    chord([130.81, 164.81, 196.0, 246.94], 0.16); // Cmaj7-ish pad
    startNoise("brown", "lowpass", 520, 0, 0.05); // warm bed
    startNoise("white", "highpass", 4200, 0, 0.012); // vinyl crackle
  },
  rain() {
    startNoise("pink", "bandpass", 1200, 0.6, 0.5);
    startNoise("brown", "lowpass", 380, 0, 0.18);
  },
  cafe() {
    startNoise("brown", "lowpass", 300, 0, 0.22);
    startNoise("pink", "bandpass", 700, 0.8, 0.10);
  },
  forest() {
    startNoise("pink", "highpass", 2600, 0.5, 0.10);
    startNoise("brown", "lowpass", 420, 0, 0.12);
    chord([196.0, 261.63], 0.05);
  },
};

export const CHANNEL_LIST = [
  { id: "lofi",   name: "Lo-fi",  color: "#8B5CF6" },
  { id: "rain",   name: "Rain",   color: "#3B82F6" },
  { id: "cafe",   name: "Café",   color: "#B45309" },
  { id: "forest", name: "Forest", color: "#10B981" },
];

export function play(channel = "lofi") {
  if (!ac()) return;
  stop();
  (CHANNELS[channel] || CHANNELS.lofi)();
  current = channel;
}

export { stop };

export function isPlaying() { return !!current; }

export function currentChannel() { return current; }

export function setVolume(v) {
  vol = Math.max(0, Math.min(1, v));
  if (master) master.gain.setTargetAtTime(vol, ctx.currentTime, 0.05);
}

// Short three-note chime to play when a focus phase ends. The phase end
// triggers this from the React component watching `secondsLeft === 0`.
export function chime() {
  if (!ac()) return;
  const t = ctx.currentTime;
  [880, 1108.73, 1318.51].forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
    const g = ctx.createGain();
    const start = t + i * 0.16;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(0.5, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 1.6);
    o.connect(g); g.connect(master); o.start(start); o.stop(start + 1.7);
  });
}
