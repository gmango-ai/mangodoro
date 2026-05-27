// Pomodoro alert sounds.
//
// Wide range of presets from calm to aggressive, all synthesized via the
// Web Audio API (no external assets required). File-based presets are also
// supported — drop an mp3/wav in `public/sounds/` and add an entry with
// kind: "file" and src: "/sounds/foo.mp3".
//
// Settings can specify different presets for work-end and break-end events
// and a repeat count so loud presets can repeat 2-3 times for hard-to-miss
// alerts. `repeat: 0` plays continuously until stopCompletionSound() is
// called.

const LS_KEY = "ql_pomodoro_sound";

export const POMODORO_SOUND_DEFAULTS = {
  volume: 0.75,
  workEndPreset: "chime",
  breakEndPreset: "beep",
  pitch: 1,
  repeat: 1,         // 1, 2, 3, or 0 for "until dismissed"
  repeatGapMs: 600,
};

export const SOUND_CATEGORIES = ["custom", "calm", "standard", "aggressive"];

// Sentinel preset id used when the user wants their uploaded file. The
// URL itself is supplied at play time via settings.customSoundUrl (mirrored
// from user_settings.pomodoro_sound_url so it syncs cross-device).
export const CUSTOM_PRESET_ID = "custom";

// Each preset describes how to play one "ring".
// `kind: "synth"` invokes the synth() function with the given recipe.
// `kind: "file"` plays the audio file at `src`.
export const POMODORO_SOUND_PRESETS = [
  // ── Calm ─────────────────────────────────────────────────────
  { id: "chime",          label: "Chime",            category: "calm",       kind: "synth", recipe: chimeRecipe },
  { id: "soft-bell",      label: "Soft bell",        category: "calm",       kind: "synth", recipe: softBellRecipe },
  { id: "meditation",     label: "Meditation bowl",  category: "calm",       kind: "synth", recipe: meditationBowlRecipe },
  { id: "deep-drone",     label: "Deep drone",       category: "calm",       kind: "synth", recipe: deepDroneRecipe },
  { id: "warm-pad",       label: "Warm pad",         category: "calm",       kind: "synth", recipe: warmPadRecipe },
  { id: "wood-block",     label: "Wood block",       category: "calm",       kind: "synth", recipe: woodBlockRecipe },
  { id: "ding",           label: "Ding",             category: "calm",       kind: "synth", recipe: dingRecipe },

  // ── Standard ─────────────────────────────────────────────────
  { id: "beep",           label: "Beep",             category: "standard",   kind: "synth", recipe: beepRecipe },
  { id: "bell",           label: "Bell",             category: "standard",   kind: "synth", recipe: bellRecipe },
  { id: "digital",        label: "Digital ping",     category: "standard",   kind: "synth", recipe: digitalRecipe },
  { id: "marimba",        label: "Marimba",          category: "standard",   kind: "synth", recipe: marimbaRecipe },
  { id: "doorbell",       label: "Doorbell",         category: "standard",   kind: "synth", recipe: doorbellRecipe },
  { id: "buzzer",         label: "Long buzzer",      category: "standard",   kind: "synth", recipe: buzzerRecipe },
  { id: "horn-fanfare",   label: "Horn fanfare",     category: "standard",   kind: "synth", recipe: hornFanfareRecipe },

  // ── Aggressive ───────────────────────────────────────────────
  { id: "alarm-clock",    label: "Alarm clock",      category: "aggressive", kind: "synth", recipe: alarmClockRecipe },
  { id: "klaxon",         label: "Klaxon",           category: "aggressive", kind: "synth", recipe: klaxonRecipe },
  { id: "siren",          label: "Siren",            category: "aggressive", kind: "synth", recipe: sirenRecipe },
  { id: "long-siren",     label: "Long siren",       category: "aggressive", kind: "synth", recipe: longSirenRecipe },
  { id: "air-horn",       label: "Air horn",         category: "aggressive", kind: "synth", recipe: airHornRecipe },
  { id: "fog-horn",       label: "Fog horn",         category: "aggressive", kind: "synth", recipe: fogHornRecipe },
  { id: "red-alert",      label: "Red alert",        category: "aggressive", kind: "synth", recipe: redAlertRecipe },
  { id: "factory-bell",   label: "Factory bell",     category: "aggressive", kind: "synth", recipe: factoryBellRecipe },
];

const PRESET_BY_ID = Object.fromEntries(POMODORO_SOUND_PRESETS.map((p) => [p.id, p]));

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

export function loadPomodoroSoundSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...POMODORO_SOUND_DEFAULTS };
    const parsed = JSON.parse(raw);

    // Migrate legacy shape ({ preset, volume, pitch }) → new shape.
    const legacyPreset = typeof parsed.preset === "string" ? parsed.preset : null;
    const workEnd = typeof parsed.workEndPreset === "string"
      ? parsed.workEndPreset
      : legacyPreset || POMODORO_SOUND_DEFAULTS.workEndPreset;
    const breakEnd = typeof parsed.breakEndPreset === "string"
      ? parsed.breakEndPreset
      : legacyPreset || POMODORO_SOUND_DEFAULTS.breakEndPreset;

    return {
      volume: typeof parsed.volume === "number" ? clamp(parsed.volume, 0, 1) : POMODORO_SOUND_DEFAULTS.volume,
      workEndPreset: (PRESET_BY_ID[workEnd] || workEnd === CUSTOM_PRESET_ID) ? workEnd : POMODORO_SOUND_DEFAULTS.workEndPreset,
      breakEndPreset: (PRESET_BY_ID[breakEnd] || breakEnd === CUSTOM_PRESET_ID) ? breakEnd : POMODORO_SOUND_DEFAULTS.breakEndPreset,
      pitch: typeof parsed.pitch === "number" ? clamp(parsed.pitch, 0.5, 1.5) : POMODORO_SOUND_DEFAULTS.pitch,
      repeat: Number.isFinite(parsed.repeat) ? clamp(Math.floor(parsed.repeat), 0, 10) : POMODORO_SOUND_DEFAULTS.repeat,
      repeatGapMs: Number.isFinite(parsed.repeatGapMs)
        ? clamp(Math.floor(parsed.repeatGapMs), 100, 5000)
        : POMODORO_SOUND_DEFAULTS.repeatGapMs,
    };
  } catch {
    return { ...POMODORO_SOUND_DEFAULTS };
  }
}

export function savePomodoroSoundSettings(settings) {
  localStorage.setItem(
    LS_KEY,
    JSON.stringify({
      volume: clamp(settings.volume, 0, 1),
      workEndPreset: settings.workEndPreset,
      breakEndPreset: settings.breakEndPreset,
      pitch: clamp(settings.pitch, 0.5, 1.5),
      repeat: clamp(Math.floor(settings.repeat ?? 1), 0, 10),
      repeatGapMs: clamp(Math.floor(settings.repeatGapMs ?? 600), 100, 5000),
    })
  );
}

// ── Audio context (singleton) ──────────────────────────────────
let audioCtxRef = null;
function getAudioContext() {
  if (!audioCtxRef) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtxRef = new AC();
  }
  return audioCtxRef;
}

// ── Active playback handle (so we can stop repeating sounds) ───
let activePlayback = null;

export function stopCompletionSound() {
  if (!activePlayback) return;
  activePlayback.cancelled = true;
  if (activePlayback.timeoutId) clearTimeout(activePlayback.timeoutId);
  if (activePlayback.audioEl) {
    try { activePlayback.audioEl.pause(); } catch { /* ignore */ }
  }
  activePlayback = null;
}

/**
 * Play the completion sound.
 * @param {object} settings - sound settings (see POMODORO_SOUND_DEFAULTS)
 * @param {object} [opts]
 * @param {"work"|"break"|"test"} [opts.event="work"] - which preset to use
 * @param {string} [opts.presetId] - override preset (for the test button)
 */
export async function playCompletionSound(settings = POMODORO_SOUND_DEFAULTS, opts = {}) {
  stopCompletionSound();

  const event = opts.event || "work";
  const presetId =
    opts.presetId
    ?? (event === "break" ? settings.breakEndPreset : settings.workEndPreset)
    ?? POMODORO_SOUND_DEFAULTS.workEndPreset;

  let preset;
  if (presetId === CUSTOM_PRESET_ID) {
    const url = opts.customSoundUrl || settings.customSoundUrl;
    if (url) {
      preset = { id: CUSTOM_PRESET_ID, kind: "file", src: url, label: "Custom" };
    } else {
      // Custom selected but no URL — fall back to the default built-in.
      preset = PRESET_BY_ID[POMODORO_SOUND_DEFAULTS.workEndPreset];
    }
  } else {
    preset = PRESET_BY_ID[presetId] || PRESET_BY_ID[POMODORO_SOUND_DEFAULTS.workEndPreset];
  }
  if (!preset) return;

  const vol = clamp(settings.volume ?? POMODORO_SOUND_DEFAULTS.volume, 0, 1);
  const pitch = clamp(settings.pitch ?? 1, 0.5, 1.5);
  const repeat = clamp(Math.floor(settings.repeat ?? 1), 0, 10);
  const gap = clamp(Math.floor(settings.repeatGapMs ?? 600), 100, 5000);

  const playback = { cancelled: false, timeoutId: null, audioEl: null };
  activePlayback = playback;

  let i = 0;
  const ring = async () => {
    if (playback.cancelled) return;
    let dur = 600;
    try {
      if (preset.kind === "file") {
        dur = await playFile(preset.src, vol, pitch, playback);
      } else {
        dur = await playSynth(preset.recipe, vol, pitch);
      }
    } catch { /* ignore audio errors */ }
    i += 1;
    if (playback.cancelled) return;
    if (repeat === 0 || i < repeat) {
      playback.timeoutId = setTimeout(ring, dur + gap);
    } else {
      activePlayback = null;
    }
  };
  ring();
}

// ── File playback ──────────────────────────────────────────────
const FILE_AUDIO_CACHE = new Map();
function playFile(src, vol, pitch, playback) {
  return new Promise((resolve) => {
    let audio = FILE_AUDIO_CACHE.get(src);
    if (!audio) {
      audio = new Audio(src);
      audio.preload = "auto";
      FILE_AUDIO_CACHE.set(src, audio);
    }
    audio.currentTime = 0;
    audio.volume = vol;
    audio.playbackRate = pitch;
    playback.audioEl = audio;
    const finish = () => { audio.removeEventListener("ended", finish); resolve((audio.duration || 1) * 1000); };
    audio.addEventListener("ended", finish);
    audio.play().catch(() => resolve(500));
  });
}

// ── Synth playback ─────────────────────────────────────────────
/**
 * A "recipe" is a function (ctx, masterVol, pitch) => durationMs that
 * schedules all the oscillators/gains and returns approx duration in ms.
 */
async function playSynth(recipe, vol, pitch) {
  const ctx = getAudioContext();
  if (!ctx) return 0;
  try { if (ctx.state === "suspended") await ctx.resume(); } catch { return 0; }
  return recipe(ctx, vol, pitch);
}

function tone(ctx, masterVol, { time, freq, dur, type = "triangle", attack = 0.005, release = null }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = ctx.currentTime + time;
  const t1 = t0 + dur;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(masterVol, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, release != null ? t0 + release : t1);
  osc.start(t0);
  osc.stop(t1 + 0.05);
}

// ── Calm recipes ───────────────────────────────────────────────
function chimeRecipe(ctx, vol, pitch) {
  const v = vol * 0.9;
  tone(ctx, v, { time: 0,    freq: 880 * pitch,  dur: 0.5 });
  tone(ctx, v, { time: 0.3,  freq: 880 * pitch,  dur: 0.5 });
  tone(ctx, v, { time: 0.6,  freq: 1174 * pitch, dur: 0.7 });
  return 1500;
}
function softBellRecipe(ctx, vol, pitch) {
  const v = vol * 0.7;
  tone(ctx, v,        { time: 0,   freq: 783 * pitch, dur: 1.2, type: "sine" });
  tone(ctx, v * 0.4,  { time: 0,   freq: 1568 * pitch, dur: 1.0, type: "sine" });
  return 1300;
}
function meditationBowlRecipe(ctx, vol, pitch) {
  const v = vol * 0.85;
  tone(ctx, v,        { time: 0, freq: 392 * pitch,  dur: 2.4, type: "sine", attack: 0.04 });
  tone(ctx, v * 0.45, { time: 0, freq: 784 * pitch,  dur: 2.0, type: "sine", attack: 0.04 });
  tone(ctx, v * 0.20, { time: 0, freq: 1176 * pitch, dur: 1.6, type: "sine", attack: 0.04 });
  return 2500;
}
function woodBlockRecipe(ctx, vol, pitch) {
  const v = vol * 0.9;
  tone(ctx, v, { time: 0, freq: 1200 * pitch, dur: 0.06, type: "square", attack: 0.001, release: 0.06 });
  return 100;
}
function dingRecipe(ctx, vol, pitch) {
  tone(ctx, vol * 0.85, { time: 0, freq: 523 * pitch, dur: 0.5, type: "sine" });
  return 600;
}

// ── Standard recipes ───────────────────────────────────────────
function beepRecipe(ctx, vol, pitch) {
  const v = vol;
  tone(ctx, v, { time: 0,    freq: 880 * pitch, dur: 0.18, type: "square" });
  tone(ctx, v, { time: 0.25, freq: 880 * pitch, dur: 0.18, type: "square" });
  return 500;
}
function bellRecipe(ctx, vol, pitch) {
  const v = vol * 0.9;
  tone(ctx, v, { time: 0,    freq: 1046 * pitch, dur: 0.35, type: "triangle" });
  tone(ctx, v, { time: 0.3,  freq: 1318 * pitch, dur: 0.4,  type: "triangle" });
  return 800;
}
function digitalRecipe(ctx, vol, pitch) {
  const v = vol;
  tone(ctx, v, { time: 0,    freq: 1568 * pitch, dur: 0.08, type: "square" });
  tone(ctx, v, { time: 0.1,  freq: 2093 * pitch, dur: 0.10, type: "square" });
  return 250;
}
function marimbaRecipe(ctx, vol, pitch) {
  const v = vol * 0.95;
  tone(ctx, v, { time: 0,    freq: 659 * pitch, dur: 0.25, type: "triangle" });
  tone(ctx, v, { time: 0.15, freq: 880 * pitch, dur: 0.25, type: "triangle" });
  tone(ctx, v, { time: 0.30, freq: 1046 * pitch, dur: 0.4, type: "triangle" });
  return 800;
}
function doorbellRecipe(ctx, vol, pitch) {
  const v = vol;
  tone(ctx, v, { time: 0,    freq: 698 * pitch, dur: 0.4, type: "sine" });
  tone(ctx, v, { time: 0.5,  freq: 587 * pitch, dur: 0.6, type: "sine" });
  return 1200;
}

// ── Aggressive recipes ─────────────────────────────────────────
function alarmClockRecipe(ctx, vol, pitch) {
  // Rapid alternating beeps for ~1.5s — classic alarm clock ring.
  const v = vol;
  for (let i = 0; i < 8; i++) {
    tone(ctx, v, { time: i * 0.18, freq: 2000 * pitch, dur: 0.10, type: "square" });
    tone(ctx, v, { time: i * 0.18 + 0.04, freq: 1800 * pitch, dur: 0.10, type: "square" });
  }
  return 1500;
}
function klaxonRecipe(ctx, vol, pitch) {
  // Two long square-wave blasts, descending. Loud and unpleasant.
  const v = vol;
  tone(ctx, v, { time: 0,   freq: 440 * pitch, dur: 0.5, type: "square" });
  tone(ctx, v, { time: 0.55, freq: 330 * pitch, dur: 0.7, type: "square" });
  return 1300;
}
function sirenRecipe(ctx, vol, pitch) {
  // Sweeping siren — schedule frequency ramps.
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.connect(gain);
  gain.connect(ctx.destination);
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(vol, now + 0.05);
  // Sweep up-down twice.
  osc.frequency.setValueAtTime(550 * pitch, now);
  osc.frequency.linearRampToValueAtTime(1100 * pitch, now + 0.5);
  osc.frequency.linearRampToValueAtTime(550 * pitch, now + 1.0);
  osc.frequency.linearRampToValueAtTime(1100 * pitch, now + 1.5);
  osc.frequency.linearRampToValueAtTime(550 * pitch, now + 2.0);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.05);
  osc.start(now);
  osc.stop(now + 2.1);
  return 2100;
}
function airHornRecipe(ctx, vol, pitch) {
  // Stacked low square + sawtooth for a buzzy, blat-y horn.
  const v = vol;
  tone(ctx, v,        { time: 0, freq: 220 * pitch, dur: 0.9, type: "sawtooth", attack: 0.01 });
  tone(ctx, v * 0.7,  { time: 0, freq: 440 * pitch, dur: 0.9, type: "square",   attack: 0.01 });
  tone(ctx, v * 0.4,  { time: 0, freq: 660 * pitch, dur: 0.9, type: "square",   attack: 0.01 });
  return 1100;
}
function redAlertRecipe(ctx, vol, pitch) {
  // Pulsed high tone — Star Trek-style alert.
  const v = vol;
  for (let i = 0; i < 6; i++) {
    tone(ctx, v, { time: i * 0.16, freq: 1760 * pitch, dur: 0.10, type: "square", attack: 0.005 });
  }
  return 1100;
}

// ── Long / sustained tones (sawtooth-heavy) ────────────────────
function deepDroneRecipe(ctx, vol, pitch) {
  // Slow rising sawtooth drone — calm but unmistakable.
  const v = vol * 0.7;
  tone(ctx, v,        { time: 0, freq: 165 * pitch, dur: 3.0, type: "sawtooth", attack: 0.3 });
  tone(ctx, v * 0.5,  { time: 0, freq: 330 * pitch, dur: 3.0, type: "sine",     attack: 0.3 });
  tone(ctx, v * 0.25, { time: 0, freq: 495 * pitch, dur: 3.0, type: "sine",     attack: 0.3 });
  return 3100;
}

function warmPadRecipe(ctx, vol, pitch) {
  // Soft layered pad with slow attack/release.
  const v = vol * 0.6;
  tone(ctx, v,       { time: 0, freq: 262 * pitch, dur: 2.5, type: "triangle", attack: 0.4 });
  tone(ctx, v * 0.7, { time: 0, freq: 392 * pitch, dur: 2.5, type: "triangle", attack: 0.5 });
  tone(ctx, v * 0.6, { time: 0, freq: 523 * pitch, dur: 2.5, type: "sine",     attack: 0.5 });
  return 2600;
}

function buzzerRecipe(ctx, vol, pitch) {
  // Long sustained sawtooth — like an old game-show wrong-answer buzzer.
  tone(ctx, vol, { time: 0, freq: 220 * pitch, dur: 1.6, type: "sawtooth", attack: 0.01 });
  return 1700;
}

function hornFanfareRecipe(ctx, vol, pitch) {
  // Two long brassy sawtooth notes.
  const v = vol * 0.85;
  tone(ctx, v, { time: 0,    freq: 392 * pitch, dur: 0.9, type: "sawtooth", attack: 0.05 });
  tone(ctx, v, { time: 0.95, freq: 523 * pitch, dur: 1.2, type: "sawtooth", attack: 0.05 });
  return 2200;
}

function longSirenRecipe(ctx, vol, pitch) {
  // Slow up-down siren — longer than `siren`, four full sweeps over 4s.
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.connect(gain);
  gain.connect(ctx.destination);
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(vol, now + 0.1);
  const lo = 440 * pitch;
  const hi = 1100 * pitch;
  osc.frequency.setValueAtTime(lo, now);
  for (let i = 0; i < 4; i++) {
    osc.frequency.linearRampToValueAtTime(hi, now + (i + 0.5));
    osc.frequency.linearRampToValueAtTime(lo, now + (i + 1));
  }
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 4.05);
  osc.start(now);
  osc.stop(now + 4.1);
  return 4100;
}

function fogHornRecipe(ctx, vol, pitch) {
  // Two long low sawtooth blasts — ship in heavy fog.
  const v = vol;
  tone(ctx, v,       { time: 0,    freq: 110 * pitch, dur: 1.4, type: "sawtooth", attack: 0.1 });
  tone(ctx, v * 0.7, { time: 0,    freq: 165 * pitch, dur: 1.4, type: "sawtooth", attack: 0.1 });
  tone(ctx, v,       { time: 1.7,  freq: 110 * pitch, dur: 1.4, type: "sawtooth", attack: 0.1 });
  tone(ctx, v * 0.7, { time: 1.7,  freq: 165 * pitch, dur: 1.4, type: "sawtooth", attack: 0.1 });
  return 3200;
}

function factoryBellRecipe(ctx, vol, pitch) {
  // Rapid clanging — end-of-shift factory bell. ~2s of double hits.
  const v = vol;
  for (let i = 0; i < 6; i++) {
    tone(ctx, v,        { time: i * 0.32,        freq: 1568 * pitch, dur: 0.3, type: "triangle" });
    tone(ctx, v * 0.6,  { time: i * 0.32 + 0.02, freq: 2349 * pitch, dur: 0.3, type: "sawtooth" });
  }
  return 2100;
}
