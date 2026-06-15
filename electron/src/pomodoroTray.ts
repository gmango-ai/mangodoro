import { app, BrowserWindow, Menu, nativeImage, Tray, ipcMain } from "electron";
import path from "path";

// Drop-in module integrated with the @capacitor-community/electron
// scaffold. Owns the menu-bar / system-tray icon that displays the live
// pomodoro countdown. The renderer pushes phase boundaries; the tray
// ticks its own title every second from the locally-stored end time, so
// nothing requires the WebView to be open or focused.
//
// Wire-up: in electron/src/index.ts call
//   import { installPomodoroTray } from "./pomodoroTray";
//   installPomodoroTray(() => mainWindow);
// after the main BrowserWindow has been created.

type Mode = "work" | "shortBreak" | "longBreak" | string;

interface TimerStartPayload {
  endsAtMs: number;
  mode: Mode;
  label: string;
  isSynced: boolean;
}

interface TimerState extends TimerStartPayload {
  isRunning: boolean;
}

let tray: Tray | null = null;
let tickInterval: NodeJS.Timeout | null = null;
let state: TimerState | null = null;

export function installPomodoroTray(getMainWindow: () => BrowserWindow | null) {
  app.whenReady().then(() => {
    tray = new Tray(buildTrayImage(null));
    tray.setToolTip("Mangodoro");
    refreshTrayUi(getMainWindow);

    tray.on("click", () => focusOnTimer(getMainWindow));

    ipcMain.handle("mangodoro:timer:start", (_event, payload: TimerStartPayload) => {
      state = { ...payload, isRunning: true };
      ensureTicking(getMainWindow);
      refreshTrayUi(getMainWindow);
    });
    ipcMain.handle("mangodoro:timer:update", (_event, payload: TimerStartPayload) => {
      state = { ...payload, isRunning: true };
      ensureTicking(getMainWindow);
      refreshTrayUi(getMainWindow);
    });
    ipcMain.handle("mangodoro:timer:stop", () => {
      state = null;
      stopTicking();
      refreshTrayUi(getMainWindow);
    });
  });
}

function ensureTicking(getMainWindow: () => BrowserWindow | null) {
  if (tickInterval) return;
  tickInterval = setInterval(() => {
    if (!state) {
      stopTicking();
      return;
    }
    if (state.endsAtMs <= Date.now()) {
      // Phase ended — let the renderer drive the transition; we just
      // clear our display until the next start arrives.
      state = null;
      stopTicking();
    }
    refreshTrayUi(getMainWindow);
  }, 1000);
}

function stopTicking() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

function refreshTrayUi(getMainWindow: () => BrowserWindow | null) {
  if (!tray) return;
  if (!state) {
    tray.setTitle("");
    tray.setToolTip("Mangodoro");
  } else {
    const remainingMs = Math.max(0, state.endsAtMs - Date.now());
    tray.setTitle(formatMMSS(remainingMs));
    tray.setToolTip(`${state.label} · ${formatMMSS(remainingMs)} remaining`);
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: state ? `${state.label} — ${formatMMSS(Math.max(0, state.endsAtMs - Date.now()))}` : "No active timer",
        enabled: false,
      },
      { type: "separator" },
      {
        label: "Open Mangodoro timer",
        click: () => focusOnTimer(getMainWindow),
      },
      { type: "separator" },
      { role: "quit" },
    ])
  );
}

function focusOnTimer(getMainWindow: () => BrowserWindow | null) {
  const win = getMainWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
  // Renderer-side handler navigates to /pomodoro on this IPC.
  win.webContents.send("mangodoro:nav", "/pomodoro");
}

function formatMMSS(ms: number) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function buildTrayImage(_state: TimerState | null) {
  // The platform tray expects a 16x16 (or 22x22 macOS template) image.
  // We ship a transparent placeholder so the title text — "12:34" —
  // becomes the visual element. Replace with a templated icon (PNG with
  // -Template suffix) when you want a real glyph.
  const iconPath = path.join(__dirname, "..", "resources", "tray-icon.png");
  try {
    const img = nativeImage.createFromPath(iconPath);
    if (process.platform === "darwin") img.setTemplateImage(true);
    return img.isEmpty() ? nativeImage.createEmpty() : img;
  } catch {
    return nativeImage.createEmpty();
  }
}
