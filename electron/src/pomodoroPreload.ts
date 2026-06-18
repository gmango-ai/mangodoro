import { contextBridge, ipcRenderer } from "electron";

const isPopover =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("ui") === "popover";

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

// Menu bar popover bridge — only meaningful inside the popover
// BrowserWindow. The renderer uses a ResizeObserver on its rendered
// card and ships the height here so the BrowserWindow can collapse
// to fit the actual content.
contextBridge.exposeInMainWorld("__electronPopover", {
  resize: (height: number) => ipcRenderer.invoke("mangodoro:popover:resize", height),
});

// Cross-window Pomodoro engine sync (main owns Realtime; popover mirrors).
if (isPopover) {
  let stateHandler: ((snapshot: unknown) => void) | null = null;
  ipcRenderer.on("mangodoro:timer:state", (_event, snapshot) => {
    stateHandler?.(snapshot);
  });
  contextBridge.exposeInMainWorld("__electronTimerBridge", {
    role: "slave",
    onState: (cb: (snapshot: unknown) => void) => {
      stateHandler = cb;
      ipcRenderer.invoke("mangodoro:timer:getState").then((snapshot) => {
        if (snapshot) cb(snapshot);
      });
    },
    offState: () => {
      stateHandler = null;
    },
    sendCommand: (method: string, args?: unknown[]) =>
      ipcRenderer.invoke("mangodoro:timer:command", { method, args }),
  });
} else {
  let commandHandler: ((method: string, args?: unknown[]) => void) | null = null;
  ipcRenderer.on(
    "mangodoro:timer:command-relay",
    (_event, payload: { method: string; args?: unknown[] }) => {
      commandHandler?.(payload.method, payload.args);
    }
  );
  contextBridge.exposeInMainWorld("__electronTimerBridge", {
    role: "main",
    publishState: (snapshot: unknown) => {
      ipcRenderer.send("mangodoro:timer:publish", snapshot);
    },
    onCommand: (cb: (method: string, args?: unknown[]) => void) => {
      commandHandler = cb;
    },
    offCommand: () => {
      commandHandler = null;
    },
    sendCommand: () => false,
  });
}

// One-way: main → renderer navigation request (fired when the user
// clicks the tray icon). The renderer subscribes via the React-Router
// navigate handler set up in App.jsx.
ipcRenderer.on("mangodoro:nav", (_event, route: string) => {
  window.dispatchEvent(new CustomEvent("mangodoro:nav", { detail: route }));
});
