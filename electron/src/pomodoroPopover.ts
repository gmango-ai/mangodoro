import { app, BrowserWindow, ipcMain, screen, Tray } from "electron";
import path from "path";

// Menubar popover BrowserWindow — Spark-style. Frameless, hides on
// blur, repositions under the tray icon on every show, stays alive
// after creation so re-opens are instant. The renderer is loaded at
// `/popover/pomodoro` which strips the nav + FAB and renders only the
// embedded PomodoroTimer.
//
// Auth/state are shared with the main window because Electron's
// BrowserWindows live in the same session by default — localStorage,
// IndexedDB, cookies — so Supabase auto-restores the user's session.
// Each window subscribes to Supabase Realtime independently and they
// stay in lockstep via the server.

const POPOVER_WIDTH = 380;
// Initial / fallback height. Renderer pings back its real measured
// height via __electronPopover.resize as soon as its ResizeObserver
// fires, and we shrink/grow the BrowserWindow to match.
const POPOVER_HEIGHT = 480;
const POPOVER_MIN_HEIGHT = 200;
const POPOVER_MAX_HEIGHT = 760;

let popover: BrowserWindow | null = null;
let isToggling = false;

interface PopoverHooks {
  getTray: () => Tray | null;
  customScheme: string;
}

export function installPomodoroPopover(hooks: PopoverHooks) {
  app.whenReady().then(() => {
    // Renderer measures itself with a ResizeObserver and ships the
    // height here. We clamp + apply directly via setSize; the window's
    // top-left stays anchored under the tray.
    ipcMain.handle("mangodoro:popover:resize", (event, height: number) => {
      if (!popover || popover.isDestroyed()) return;
      // Only honor messages from the popover's own webContents — any
      // other window calling __electronPopover.resize is a no-op.
      if (event.sender.id !== popover.webContents.id) return;
      const clamped = Math.min(POPOVER_MAX_HEIGHT, Math.max(POPOVER_MIN_HEIGHT, Math.round(height)));
      const bounds = popover.getBounds();
      if (bounds.height === clamped) return;
      popover.setSize(bounds.width, clamped, false);
    });
  });
  return {
    toggle: () => togglePopover(hooks),
    show: () => showPopover(hooks),
    hide: () => popover?.hide(),
    isOpen: () => !!popover && popover.isVisible(),
  };
}

function ensurePopover(hooks: PopoverHooks): BrowserWindow {
  if (popover && !popover.isDestroyed()) return popover;

  const preloadPath = path.join(app.getAppPath(), "build", "src", "preload.js");

  popover = new BrowserWindow({
    width: POPOVER_WIDTH,
    height: POPOVER_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // No vibrancy / transparency — the accent-tinted body background
    // bled through the macOS "sidebar" material and read as a tacky
    // green frame around the cards. Solid background + system rounded
    // corners feels more like a deliberate popover and less like the
    // wallpaper is leaking in.
    transparent: false,
    roundedCorners: true,
    hasShadow: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: true,
      contextIsolation: true,
    },
  });

  popover.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Auto-hide when the user clicks anywhere else (Spark / Itsycal style).
  popover.on("blur", () => {
    if (!popover || popover.isDestroyed()) return;
    // Skip the very first blur that fires during the show() animation
    // on some macOS versions — `isToggling` guards that flip.
    if (isToggling) return;
    popover.hide();
  });

  popover.loadURL(popoverUrl(hooks));

  return popover;
}

function popoverUrl(hooks: PopoverHooks): string {
  // Query-string flag instead of a /popover/ path. electron-serve was
  // normalizing `/popover/pomodoro` down to `/pomodoro` (so the
  // renderer's router was matching the full PomodoroPage instead of
  // our popover route). A query param survives that normalization and
  // is trivial to detect from main.jsx before React Router boots.
  return `${hooks.customScheme}://localhost/?ui=popover`;
}

function showPopover(hooks: PopoverHooks) {
  const win = ensurePopover(hooks);
  // Re-navigate on every show if we've drifted off the popover URL
  // (e.g., an internal link nav, or the renderer was reloaded). Cheap
  // and avoids "popover stuck on wrong page" symptoms.
  const expectedUrl = popoverUrl(hooks);
  if (!win.webContents.getURL().startsWith(expectedUrl)) {
    win.loadURL(expectedUrl);
  }
  positionUnderTray(win, hooks.getTray());
  isToggling = true;
  win.show();
  win.focus();
  setTimeout(() => { isToggling = false; }, 150);
}

function togglePopover(hooks: PopoverHooks) {
  if (popover && !popover.isDestroyed() && popover.isVisible()) {
    popover.hide();
    return;
  }
  showPopover(hooks);
}

// Anchor the window directly under the tray icon. On macOS the tray
// reports valid bounds; on other platforms the icon position can be
// unknown so we fall back to top-right of the primary display.
function positionUnderTray(win: BrowserWindow, tray: Tray | null) {
  const winBounds = win.getBounds();
  const display = screen.getPrimaryDisplay().workArea;

  if (tray) {
    const trayBounds = tray.getBounds();
    if (trayBounds.width > 0 && trayBounds.height > 0) {
      let x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
      let y = Math.round(trayBounds.y + trayBounds.height + 6);
      // Keep within the work area so we don't render off-screen.
      x = Math.max(display.x + 8, Math.min(x, display.x + display.width - winBounds.width - 8));
      y = Math.max(display.y + 8, y);
      win.setPosition(x, y, false);
      return;
    }
  }

  // Fallback: top-right corner.
  const x = display.x + display.width - winBounds.width - 16;
  const y = display.y + 16;
  win.setPosition(x, y, false);
}
