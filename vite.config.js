import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync } from "fs";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      // Capacitor serves the WebView from its own asset server; the
      // Workbox service worker is irrelevant there and its precache
      // collides with Capacitor's loader. CAPACITOR_BUILD=1 disables
      // SW + manifest generation but keeps the virtual:pwa-register
      // module resolvable so PWAUpdater still imports cleanly.
      disable: process.env.CAPACITOR_BUILD === "1",
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.ico", "logo.svg", "apple-touch-icon-180x180.png"],
      manifest: {
        name: "Mangodoro",
        short_name: "Mangodoro",
        description: "Synced pomodoros and time tracking for remote teams.",
        theme_color: "#0d9488",
        background_color: "#f5f7ff",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
        // The LiveKit self-view processors (MediaPipe background blur, Krisp
        // noise filter) are multi-MB and lazy-loaded only when a call enables
        // the effect — never precache them (video isn't an offline feature, and
        // non-video users shouldn't download them on SW install).
        globIgnores: ["**/lk-blur-*.js", "**/lk-krisp-*.js"],
        // CodeMirror + markdown bring the main bundle past 2 MB. Bump
        // the precache ceiling rather than carve out chunks; offline
        // start still works.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // Cache GET requests to Supabase REST/PostgREST only.
            // Explicitly skip /storage/, /auth/, and /realtime/ — uploads,
            // multipart POSTs, and websocket upgrades must reach the
            // network unmodified. The handler routes also default to
            // GET-only, but we double-gate here for safety.
            urlPattern: ({ url, request }) => {
              if (!url.host.endsWith(".supabase.co")) return false;
              if (request.method !== "GET") return false;
              const p = url.pathname;
              if (p.startsWith("/auth/")) return false;
              if (p.startsWith("/storage/")) return false;
              if (p.startsWith("/realtime/")) return false;
              return true;
            },
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-cache",
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Cross-origin isolation so SharedArrayBuffer is available → onnxruntime-web
    // can run RVM matting on multiple WASM threads (see rvmWorker.js). COEP
    // `credentialless` (not `require-corp`) keeps the blast radius small: no-cors
    // subresources (MediaPipe/ORT CDN wasm, fonts, PostHog) load without
    // credentials instead of being blocked, and CORS resources (Supabase) still
    // send their auth headers. Safari/iOS ignore it → they just stay single-thread.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
    watch: {
      ignored: ["**/_tmp_AltDesign/**"],
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  build: {
    // The only chunk over the default 500 kB is exceljs (~940 kB) — a large
    // spreadsheet lib that's already lazy-loaded (it only downloads when the
    // user exports an .xlsx). It can't be split further, so we raise the
    // ceiling just past it to stop flagging that benign chunk while still
    // catching a real regression in the eager app bundle.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      external: [],
      output: {
        // Split heavy, eagerly-loaded vendor libs out of the main app bundle
        // into their own cacheable chunks (vendor code changes rarely, so it
        // caches across deploys and keeps the entry chunk lean). We only name
        // the EAGER heavyweights here — lazy-only deps (xyflow, exceljs,
        // jspdf, emoji-picker-react, html2canvas) are already isolated by
        // their dynamic imports, so naming them would just pull them eager.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          // LiveKit self-view processors — lazy-loaded only when a call enables
          // an effect. Stable names so the PWA precache can skip them (see
          // workbox.globIgnores); they're multi-MB and not an offline feature.
          if (id.includes("@livekit/krisp-noise-filter")) return "lk-krisp";
          if (id.includes("@livekit/track-processors") || id.includes("@mediapipe")) return "lk-blur";
          // livekit-client + components are a heavy, eagerly-loaded vendor lib
          // (App.jsx statically mounts the call). Keep them in their own chunk
          // so app-code changes don't bust the cached vendor bundle. (Checked
          // after the lk-* rules above so those win for the processor packages.)
          if (id.includes("livekit-client") || id.includes("@livekit/")) return "livekit";
          // Keep the whole React ecosystem in one chunk (single instance).
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return "react-vendor";
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("recharts") || /[\\/]d3-/.test(id) || id.includes("victory-vendor") || id.includes("internmap")) return "charts";
          if (id.includes("@codemirror") || id.includes("@uiw") || id.includes("@lezer")) return "codemirror";
          if (
            id.includes("react-markdown") || id.includes("remark") || id.includes("micromark") ||
            id.includes("mdast") || id.includes("hast") || id.includes("unist") || id.includes("unified") ||
            id.includes("vfile") || id.includes("property-information") ||
            id.includes("character-entities") || id.includes("decode-named-character-reference") ||
            id.includes("space-separated-tokens") || id.includes("comma-separated-tokens")
          ) return "markdown";
          if (id.includes("lucide-react")) return "icons";
          if (/[\\/]node_modules[\\/]motion[\\/]/.test(id)) return "motion";
        },
      },
    },
  },
  optimizeDeps: {
    exclude: [],
  },
});
