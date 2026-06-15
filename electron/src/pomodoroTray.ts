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

export interface PomodoroTrayHooks {
  getMainWindow: () => BrowserWindow | null;
  /** Called when the main window is missing or destroyed — for the
   *  scaffold this is `() => myCapacitorApp.init()`. The tray awaits
   *  the returned promise (if any) before trying to focus. */
  reopenMainWindow?: () => void | Promise<void>;
  /** Left-click handler. If provided, replaces the default "focus main
   *  window + navigate to /pomodoro" behavior — used to attach the
   *  menubar popover instead. */
  onTrayClick?: () => void;
}

/** Exposes the Tray instance so the popover module can anchor itself
 *  to it (tray.getBounds()). The tray is created inside whenReady, so
 *  this returns null until the icon is installed. */
export function getInstalledTray(): Tray | null {
  return tray;
}

export function installPomodoroTray(hooks: PomodoroTrayHooks | (() => BrowserWindow | null)) {
  // Back-compat: an earlier signature took just the getter; keep
  // accepting it so we don't break callers that haven't migrated yet.
  const normalized: PomodoroTrayHooks =
    typeof hooks === "function" ? { getMainWindow: hooks } : hooks;

  app.whenReady().then(() => {
    tray = new Tray(buildTrayImage(null));
    tray.setToolTip("Mangodoro");
    refreshTrayUi();

    // Left-click → caller-provided handler (the menubar popover) or
    // fall back to focusing the main window. Right-click → context menu
    // (Quit etc). Important: do NOT call tray.setContextMenu() — when a
    // menu is permanently attached, macOS shows it on left-click and
    // our `click` handler never fires. Build the menu on demand and
    // pop it up only for right-click instead.
    tray.on("click", () => {
      if (normalized.onTrayClick) {
        normalized.onTrayClick();
      } else {
        focusOnTimer(normalized);
      }
    });
    tray.on("right-click", () => {
      if (!tray) return;
      tray.popUpContextMenu(buildContextMenu(normalized));
    });

    ipcMain.handle("mangodoro:timer:start", (_event, payload: TimerStartPayload) => {
      state = { ...payload, isRunning: true };
      ensureTicking();
      refreshTrayUi();
    });
    ipcMain.handle("mangodoro:timer:update", (_event, payload: TimerStartPayload) => {
      state = { ...payload, isRunning: true };
      ensureTicking();
      refreshTrayUi();
    });
    ipcMain.handle("mangodoro:timer:stop", () => {
      state = null;
      stopTicking();
      refreshTrayUi();
    });
  });
}

function ensureTicking() {
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
    refreshTrayUi();
  }, 1000);
}

function stopTicking() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

function refreshTrayUi() {
  if (!tray) return;
  if (!state) {
    tray.setTitle("");
    tray.setToolTip("Mangodoro");
  } else {
    const remainingMs = Math.max(0, state.endsAtMs - Date.now());
    tray.setTitle(formatMMSS(remainingMs));
    tray.setToolTip(`${state.label} · ${formatMMSS(remainingMs)} remaining`);
  }
}

// Built fresh on every right-click so the "Now running" header reflects
// the live countdown without us having to mutate an attached menu.
function buildContextMenu(hooks: PomodoroTrayHooks) {
  return Menu.buildFromTemplate([
    {
      label: state
        ? `${state.label} — ${formatMMSS(Math.max(0, state.endsAtMs - Date.now()))}`
        : "No active timer",
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Open Mangodoro timer",
      click: () => focusOnTimer(hooks),
    },
    { type: "separator" },
    { role: "quit" },
  ]);
}

async function focusOnTimer(hooks: PomodoroTrayHooks) {
  let win = hooks.getMainWindow();
  // If the user closed the window earlier, the BrowserWindow was
  // destroyed but the tray kept us alive. Re-init via the hook (which
  // calls myCapacitorApp.init() in the scaffold). Without this guard
  // every operation throws "Object has been destroyed".
  if (!win || win.isDestroyed()) {
    if (hooks.reopenMainWindow) {
      await hooks.reopenMainWindow();
      win = hooks.getMainWindow();
    }
    if (!win || win.isDestroyed()) return;
  }
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
  // 22x22 @1x + 44x44 @2x mango silhouette in electron/resources/.
  // app.getAppPath() points at the Electron app root (one level above
  // build/) so this resolves correctly whether running from `npm run
  // electron:start` or a packaged build. setTemplateImage flips the
  // PNG into macOS "use my alpha channel, ignore my colors" mode so
  // the menu bar tints it automatically for light/dark menu bars.
  const iconPath = path.join(app.getAppPath(), "resources", "tray-icon.png");
  try {
    const img = nativeImage.createFromPath(iconPath);
    if (process.platform === "darwin") img.setTemplateImage(true);
    return img.isEmpty() ? nativeImage.createEmpty() : img;
  } catch {
    return nativeImage.createEmpty();
  }
}
