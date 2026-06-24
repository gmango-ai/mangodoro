// Main-thread handle to the RVM matting worker (rvmWorker.js).
//
// Cheaply downscales the camera frame (createImageBitmap with resizeWidth, GPU)
// and transfers it to the worker, which returns the alpha matte. One frame is
// in flight at a time. The worker (and onnxruntime-web) only loads when this is
// constructed, so it's lazy. Everything is fail-soft: on any error the handle
// goes `dead` and the caller falls back to MediaPipe.

export function createRvmMatter({ modelUrl, inputWidth = 384, downsample = 0.25, onReady, onError } = {}) {
  const worker = new Worker(new URL("./rvmWorker.js", import.meta.url), { type: "module" });
  const state = { ready: false, dead: false };
  let pending = null; // resolve() for the in-flight frame
  let reqId = 0;

  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "ready") {
      state.ready = true;
      onReady?.();
    } else if (m.type === "error") {
      state.dead = true;
      onError?.(m.message);
    } else if (m.type === "alpha") {
      const p = pending; pending = null;
      p?.({ alpha: m.data, width: m.w, height: m.h, ms: m.ms });
    } else if (m.type === "frameError") {
      const p = pending; pending = null;
      p?.(null);
    }
  };
  worker.onerror = (err) => {
    state.dead = true;
    onError?.(String(err?.message || "worker error"));
  };
  worker.postMessage({ type: "init", modelUrl, downsample });

  async function infer(video) {
    if (!state.ready || state.dead || pending) return null;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return null;
    // Send the native frame up to a cap (don't pre-shrink, and never upscale) —
    // RVM computes the alpha at this resolution, so more pixels = crisper edges.
    // RVM's own downsample_ratio handles the cheap encoder downscale.
    const w = Math.min(inputWidth, vw);
    const h = Math.max(2, Math.round((w * vh) / vw));
    let bitmap;
    try {
      bitmap = await createImageBitmap(video, { resizeWidth: w, resizeHeight: h, resizeQuality: "low" });
    } catch {
      return null;
    }
    return new Promise((resolve) => {
      pending = resolve;
      worker.postMessage({ type: "frame", bitmap, id: ++reqId, w, h }, [bitmap]);
    });
  }

  function close() {
    state.dead = true;
    if (pending) { const p = pending; pending = null; p(null); }
    try { worker.terminate(); } catch { /* */ }
  }

  return {
    infer,
    close,
    get ready() { return state.ready; },
    get dead() { return state.dead; },
  };
}
