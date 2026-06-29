// One shared AudioContext for the whole app's Web Audio: pomodoro alarms
// (lib/pomodoroSound.js), focus ambience (lib/focusAudio.js), and the whiteboard
// timer chime/tick (components/whiteboard/WhiteboardTimer.jsx).
//
// Why share: browsers cap concurrent AudioContexts (~6 in Chrome) and a page
// runs a single audio session, so every extra persistent context both eats into
// that cap AND risks disrupting the in-room LiveKit call (remote participants
// dropping out). One lazily-created, never-closed instance keeps us well clear —
// a single AudioContext happily hosts many independent node graphs at once.
//
// DO NOT route ephemeral, create-then-close() probes through this (the mic-level
// analysis in bestMic.js / autoMic.js) — they close() their context when done,
// which would tear down this shared instance for everyone. Those keep their own
// short-lived contexts.

let ctx = null;

// Returns the shared AudioContext (lazily constructed), resuming it if the
// browser parked it in "suspended". Returns null where Web Audio is unavailable.
export function getAudioContext() {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => { /* */ });
    return ctx;
  } catch {
    return null;
  }
}

// Unlock Web Audio during a user gesture (Start / preview click) so later
// scheduled sounds aren't blocked by autoplay policy. Plays a 1-sample silent
// buffer — the canonical iOS/Safari unlock — then resumes.
export async function warmupAudioContext() {
  const c = getAudioContext();
  if (!c) return;
  try {
    if (c.state === "suspended") await c.resume();
    if (c.state === "running") return;
    const buffer = c.createBuffer(1, 1, c.sampleRate);
    const source = c.createBufferSource();
    source.buffer = buffer;
    const gain = c.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(c.destination);
    source.start(0);
    source.stop(c.currentTime + 0.001);
    if (c.state === "suspended") await c.resume();
  } catch {
    /* ignore */
  }
}
