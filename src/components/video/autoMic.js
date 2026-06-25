// Local voice-activity detection for proximity-style auto mic-switching.
//
// Opens a dedicated mic capture and calls onChange(true/false) as the local
// person starts/stops talking, so an in-room follower can auto-claim the room
// mic while they speak and release it when they stop.
//
// The hard part: an in-room mic also picks up the room speaker (the device)
// playing remote audio, and THIS device's echo-cancellation can't cancel
// ANOTHER device's output — so we can't simply threshold raw level. Instead we
// track a slow-moving "floor" (ambient + playback bleed) and only fire when the
// level jumps well above it, which keys on close, loud own-voice. Cleanest for
// headset users (no bleed); best-effort on speakers. Debounced both ways so the
// mic doesn't flap between turns. Thresholds are deliberately conservative and
// will need real-world tuning.
//
// Returns a stop() function. Safe to call before/while the mic resolves.

export function createVoiceDetector({ onChange, deviceId } = {}) {
  let stream = null;
  let ctx = null;
  let raf = 0;
  let stopped = false;

  // Tunables (ms / ratios).
  const START_MS = 180; // sustained loud → "speaking"
  const STOP_MS = 1200; // sustained quiet → "stopped" (hold avoids flapping mid-turn)
  const MARGIN = 3.0; // level must exceed floor × this to count as own-voice
  const FLOOR_MIN = 0.008; // absolute floor so a silent room can't make anything trip it
  const SAMPLE_MS = 50; // ~20 Hz

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch {
      return; // mic denied/unavailable — auto-switch simply won't engage
    }
    if (stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);

      let speaking = false;
      let floor = 0.02;
      let aboveSince = 0;
      let belowSince = 0;
      let lastSample = 0;

      const tick = () => {
        if (stopped) return;
        raf = requestAnimationFrame(tick);
        const now = performance.now();
        if (now - lastSample < SAMPLE_MS) return;
        lastSample = now;

        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);

        const loud = rms > Math.max(FLOOR_MIN, floor * MARGIN);
        // Let the floor drift toward quiet levels only — don't let speech raise
        // it (which would desensitise us mid-sentence).
        if (!loud) floor = floor * 0.95 + rms * 0.05;

        if (loud) {
          belowSince = 0;
          if (!aboveSince) aboveSince = now;
        } else {
          aboveSince = 0;
          if (!belowSince) belowSince = now;
        }

        if (!speaking && aboveSince && now - aboveSince >= START_MS) {
          speaking = true;
          onChange?.(true);
        } else if (speaking && belowSince && now - belowSince >= STOP_MS) {
          speaking = false;
          onChange?.(false);
        }
      };
      raf = requestAnimationFrame(tick);
    } catch {
      try { stream.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    }
  })();

  return () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    try { ctx?.close(); } catch { /* */ }
  };
}
