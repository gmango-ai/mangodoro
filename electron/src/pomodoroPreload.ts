import { contextBridge, ipcRenderer } from "electron";

// Exposes a tiny bridge that the renderer's persistentTimer.js feature-
// detects (window.__electronTimer). Kept deliberately narrow — only
// timer-surface methods cross the contextIsolation boundary.
//
// Wire-up: in electron/src/preload.ts (the scaffolded entry) add
//   import "./pomodoroPreload";

contextBridge.exposeInMainWorld("__electronTimer", {
  start: (payload: { endsAtMs: number; mode: string; label: string; isSynced: boolean }) =>
    ipcRenderer.invoke("mangodoro:timer:start", payload),
  update: (payload: { endsAtMs: number; mode: string; label: string; isSynced: boolean }) =>
    ipcRenderer.invoke("mangodoro:timer:update", payload),
  stop: () => ipcRenderer.invoke("mangodoro:timer:stop"),
});

// OAuth round-trip helper. AuthPage calls start(oauthUrl, redirectPrefix)
// and gets back the full callback URL once the popup hits the redirect.
contextBridge.exposeInMainWorld("__electronOAuth", {
  start: (oauthUrl: string, redirectPrefix: string): Promise<string> =>
    ipcRenderer.invoke("mangodoro:oauth:start", oauthUrl, redirectPrefix),
});

// One-way: main → renderer navigation request (fired when the user
// clicks the tray icon). The renderer subscribes via the React-Router
// navigate handler set up in App.jsx.
ipcRenderer.on("mangodoro:nav", (_event, route: string) => {
  window.dispatchEvent(new CustomEvent("mangodoro:nav", { detail: route }));
});
