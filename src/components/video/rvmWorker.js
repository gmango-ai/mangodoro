// Robust Video Matting (RVM) inference worker.
//
// Runs onnxruntime-web (WASM backend — RVM's ops aren't all WebGL/WebGPU
// supported) OFF the main thread, so matting can't jank the app. It receives a
// downscaled camera frame as an ImageBitmap, runs RVM, and posts back the alpha
// matte (`pha`). RVM is a VIDEO model: the recurrent state (r1..r4) lives here
// and loops back into the next frame for temporal stability.
//
// Inputs:  src [1,3,H,W] (RGB 0..1), r1i..r4i (recurrent, init [1,1,1,1] zeros),
//          downsample_ratio [1] (fp32).
// Outputs: fgr, pha, r1o..r4o.  We use pha (alpha) and feed rXo -> rXi.

import * as ort from "onnxruntime-web";

ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/";
ort.env.wasm.numThreads = 1; // single-thread: no COOP/COEP cross-origin isolation needed

let session = null;
let r1, r2, r3, r4, downsample;
let canvas, ctx, srcBuf;

function zeros() {
  return new ort.Tensor("float32", new Float32Array(1), [1, 1, 1, 1]);
}

self.onmessage = async (e) => {
  const m = e.data;

  if (m.type === "init") {
    try {
      session = await ort.InferenceSession.create(m.modelUrl, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
      r1 = zeros(); r2 = zeros(); r3 = zeros(); r4 = zeros();
      downsample = new ort.Tensor("float32", new Float32Array([m.downsample || 0.25]), [1]);
      canvas = new OffscreenCanvas(2, 2);
      ctx = canvas.getContext("2d", { willReadFrequently: true });
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err?.message || err) });
    }
    return;
  }

  if (m.type === "frame") {
    if (!session) { try { m.bitmap?.close?.(); } catch { /* */ } return; }
    const { w, h, id } = m;
    try {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        // Recurrent tensors are resolution-dependent — reset on resize (e.g. WebRTC
        // mid-call resolution change) so inference doesn't fail on stale shapes.
        r1 = zeros(); r2 = zeros(); r3 = zeros(); r4 = zeros();
      }
      ctx.drawImage(m.bitmap, 0, 0, w, h);
      try { m.bitmap.close?.(); } catch { /* */ }
      const img = ctx.getImageData(0, 0, w, h).data; // RGBA
      const n = w * h;
      if (!srcBuf || srcBuf.length !== 3 * n) srcBuf = new Float32Array(3 * n);
      // planar RGB (NCHW), normalised 0..1
      for (let i = 0; i < n; i++) {
        srcBuf[i] = img[i * 4] / 255;
        srcBuf[n + i] = img[i * 4 + 1] / 255;
        srcBuf[2 * n + i] = img[i * 4 + 2] / 255;
      }
      const src = new ort.Tensor("float32", srcBuf, [1, 3, h, w]);
      const t0 = performance.now();
      const out = await session.run({
        src, r1i: r1, r2i: r2, r3i: r3, r4i: r4, downsample_ratio: downsample,
      });
      const ms = performance.now() - t0;
      r1 = out.r1o; r2 = out.r2o; r3 = out.r3o; r4 = out.r4o;
      const pha = out.pha;
      const data = pha.data instanceof Float32Array ? pha.data.slice() : Float32Array.from(pha.data);
      self.postMessage({ type: "alpha", id, w: pha.dims[3], h: pha.dims[2], ms, data }, [data.buffer]);
    } catch (err) {
      self.postMessage({ type: "frameError", id, message: String(err?.message || err) });
    }
  }
};
