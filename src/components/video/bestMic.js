// Picks the "best" microphone for the room-leader device.
//
// When a device becomes the shared room speaker (companion mode), we want its
// mic to be the best one available — typically a dedicated/USB/conference mic
// over a tinny built-in. There's no browser API for "mic quality", so we score
// each input on two cheap signals:
//   • measured input level (RMS) over a short window — a mic that's actually
//     hearing the room beats one that's muted/disconnected/far away.
//   • a label heuristic — prefer dedicated mics, demote built-ins, avoid
//     virtual/loopback devices (which would capture system audio, not voice).
// Measured level dominates when there's sound; the label heuristic breaks ties
// and decides in a silent room.

const VIRTUAL_RE = /virtual|aggregate|loopback|blackhole|soundflower|stereo mix|vb-?audio/i;
const BUILTIN_RE = /built-?in|internal|macbook|imac|laptop/i;
const PREFERRED_RE = /usb|yeti|blue|r[oø]de|shure|samson|conference|webcam|headset|airpods|wireless|podmic|snowball/i;

function labelScore(label = "") {
  let s = 0;
  if (PREFERRED_RE.test(label)) s += 2;
  if (BUILTIN_RE.test(label)) s -= 1;
  if (VIRTUAL_RE.test(label)) s -= 3;
  return s;
}

// Open `deviceId` briefly and return its RMS level. AGC off so we measure the
// raw signal (and don't let auto-gain mask a weak mic); EC/NS left on since
// that's how the mic will actually run in the call. Returns 0 on any failure.
async function measureLevel(ctx, deviceId, ms = 300) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
      video: false,
    });
  } catch {
    return 0;
  }
  try {
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const samples = Math.max(4, Math.round(ms / 25));
    let sumSq = 0;
    let frames = 0;
    for (let i = 0; i < samples; i++) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 25));
      analyser.getFloatTimeDomainData(buf);
      let frameSq = 0;
      for (let j = 0; j < buf.length; j++) frameSq += buf[j] * buf[j];
      sumSq += frameSq / buf.length;
      frames++;
    }
    src.disconnect();
    return Math.sqrt(sumSq / Math.max(1, frames));
  } catch {
    return 0;
  } finally {
    try {
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* already stopped */
    }
  }
}

// Returns { deviceId, label, rms, score } for the best mic, or null if none /
// not enumerable. Pass { measure: false } to score on labels only (instant, no
// device probing) — useful when you can't spare ~300ms per input.
export async function pickBestMicrophone({ measure = true } = {}) {
  if (!navigator.mediaDevices?.enumerateDevices) return null;
  let devices;
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    return null;
  }
  // Skip the "default"/"communications" aliases — they point at one of the real
  // devices below, so probing them double-counts and switching to them is less
  // explicit than naming the underlying device.
  const mics = devices.filter(
    (d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications",
  );
  if (mics.length === 0) return null;
  if (mics.length === 1) return { deviceId: mics[0].deviceId, label: mics[0].label, rms: 0, score: 0 };

  let ctx = null;
  if (measure) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      ctx = null;
    }
  }
  const scored = [];
  for (const m of mics) {
    const ls = labelScore(m.label);
    // eslint-disable-next-line no-await-in-loop
    const rms = ctx ? await measureLevel(ctx, m.deviceId) : 0;
    scored.push({ deviceId: m.deviceId, label: m.label, rms, score: rms * 100 + ls });
  }
  try {
    await ctx?.close();
  } catch {
    /* already closed */
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}
