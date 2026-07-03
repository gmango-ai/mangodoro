// Short synthesized UI cues for notifications, chat messages, and raised hands.
// Procedural (WebAudio) so there are no media files to ship or license, and they
// ride the app-wide shared AudioContext (lib/audioContext.js) — never a new one,
// to stay clear of the ~6-context cap and the in-room LiveKit session.
//
// Per-device on/off (audio is a speaker/headphone choice, so localStorage, not a
// synced setting). Cues no-op silently when disabled, when Web Audio is
// unavailable, or before the context is unlocked by a user gesture (autoplay).
import { getAudioContext, warmupAudioContext } from "./audioContext";

const PREF_KEY = "ql_ui_sounds";

export function uiSoundsEnabled() {
  try { return localStorage.getItem(PREF_KEY) !== "0"; } catch { return true; } // default on
}
export function setUiSoundsEnabled(on) {
  try { localStorage.setItem(PREF_KEY, on ? "1" : "0"); } catch { /* private mode */ }
}

// Unlock the shared AudioContext on the user's first interaction so later cues
// (which arrive without a gesture) aren't blocked by autoplay policy. Runs once.
let warmed = false;
if (typeof window !== "undefined") {
  const warm = () => {
    if (warmed) return;
    warmed = true;
    warmupAudioContext();
    window.removeEventListener("pointerdown", warm);
    window.removeEventListener("keydown", warm);
  };
  window.addEventListener("pointerdown", warm, { passive: true });
  window.addEventListener("keydown", warm, { passive: true });
}

// Play a little sequence of notes. Each note: { freq, at?, dur?, type?, peak? }.
function play(notes) {
  if (!uiSoundsEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  const schedule = () => {
    try {
      const now = ctx.currentTime;
      for (const n of notes) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.connect(g);
        g.connect(ctx.destination);
        o.type = n.type || "sine";
        o.frequency.value = n.freq;
        const t0 = now + (n.at || 0);
        const dur = n.dur || 0.15;
        const peak = n.peak ?? 0.13;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(peak, t0 + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.start(t0);
        o.stop(t0 + dur + 0.02);
      }
    } catch { /* ignore */ }
  };
  // Cues fire from realtime events (no gesture), and the shared context often
  // gets PARKED to "suspended" after idle — don't drop the sound in that case,
  // resume first (no new gesture needed once it's been unlocked once) then play.
  if (ctx.state === "running") schedule();
  else if (ctx.resume) ctx.resume().then(schedule).catch(() => { /* never unlocked yet */ });
}

// Chat message — soft, quick two-note "bloop" (A5 → D6).
export function playMessage() {
  play([{ freq: 880, dur: 0.11 }, { freq: 1174.66, at: 0.085, dur: 0.13 }]);
}

// Generic notification — gentle rising pair (E5 → B5).
export function playNotify() {
  play([{ freq: 659.25, dur: 0.13 }, { freq: 987.77, at: 0.1, dur: 0.16 }]);
}

// Raised hand — a slightly more insistent three-note rise (C5 → E5 → G5) so it
// reads as "someone wants to speak".
export function playHandRaise() {
  play([
    { freq: 523.25, dur: 0.12 },
    { freq: 659.25, at: 0.11, dur: 0.12 },
    { freq: 783.99, at: 0.22, dur: 0.18, peak: 0.15 },
  ]);
}

// Route a notification to the right cue by its type (dm/channel/mention read as
// chat, everything else as a generic notification).
const MESSAGE_TYPES = new Set(["dm", "channel", "mention"]);
export function playForNotification(type) {
  if (MESSAGE_TYPES.has((type || "").toLowerCase())) playMessage();
  else playNotify();
}
