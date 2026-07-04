import { getAudioContext } from "./audioContext";

// A short, gentle two-note "ding" for in-app notification toasts. Synthesized
// via the shared AudioContext (no asset to download). Best-effort: silent if Web
// Audio is unavailable or still suspended (no user gesture yet this session).
export function playNotificationChime(volume = 0.14) {
  try {
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== "running") return; // can't play before a gesture unlocks audio
    const t0 = ctx.currentTime;
    const notes = [
      { f: 880, at: 0 },       // A5
      { f: 1174.66, at: 0.1 }, // D6
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = n.f;
      const start = t0 + n.at;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.24);
    }
  } catch {
    /* best-effort */
  }
}
