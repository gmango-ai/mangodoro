import type { CapacitorElectronConfig } from '@capacitor-community/electron';
import { getCapacitorElectronConfig, setupElectronDeepLinking } from '@capacitor-community/electron';
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { app, MenuItem } from 'electron';
import electronIsDev from 'electron-is-dev';
import unhandled from 'electron-unhandled';
import { autoUpdater } from 'electron-updater';

import { ElectronCapacitorApp, setupContentSecurityPolicy, setupReloadWatcher } from './setup';
import { getInstalledTray, installPomodoroTray } from './pomodoroTray';
import { installPomodoroPopover, getPopoverWindow } from './pomodoroPopover';
import { installOAuthHandler } from './oauthFlow';
import { installTimerBridge, waitForMainTimerHandlerReady } from './timerBridge';
import { installAuthBridge } from './authBridge';

// Graceful handling of unhandled errors.
unhandled();

// Define our menu templates (these are optional)
const trayMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [new MenuItem({ label: 'Quit App', role: 'quit' })];
const appMenuBarMenuTemplate: (MenuItemConstructorOptions | MenuItem)[] = [
  { role: process.platform === 'darwin' ? 'appMenu' : 'fileMenu' },
  { role: 'viewMenu' },
];

// Get Config options from capacitor.config
const capacitorFileConfig: CapacitorElectronConfig = getCapacitorElectronConfig();

// Initialize our app. You can pass menu templates into the app here.
// const myCapacitorApp = new ElectronCapacitorApp(capacitorFileConfig);
const myCapacitorApp = new ElectronCapacitorApp(capacitorFileConfig, trayMenuTemplate, appMenuBarMenuTemplate);

// If deeplinking is enabled then we will set it up here.
if (capacitorFileConfig.electron?.deepLinkingEnabled) {
  setupElectronDeepLinking(myCapacitorApp, {
    customProtocol: capacitorFileConfig.electron.deepLinkingCustomProtocol ?? 'mycapacitorapp',
  });
}

// If we are in Dev mode, use the file watcher components.
if (electronIsDev) {
  setupReloadWatcher(myCapacitorApp);
}

function waitForRendererReady(win: BrowserWindow, timeoutMs = 3000): Promise<void> {
  if (win.isDestroyed()) return Promise.resolve();
  const { webContents } = win;
  if (webContents.getURL() && !webContents.isLoading()) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      webContents.removeListener('did-finish-load', finish);
      webContents.removeListener('dom-ready', finish);
      webContents.removeListener('did-fail-load', finish);
      if (timeout) clearTimeout(timeout);
      resolve();
    };

    webContents.once('did-finish-load', finish);
    webContents.once('dom-ready', finish);
    webContents.once('did-fail-load', finish);
    timeout = setTimeout(finish, timeoutMs);
  });
}

// Run Application
(async () => {
  // Wait for electron app to be ready.
  await app.whenReady();
  // Security - Set Content-Security-Policy based on whether or not we are in dev mode.
  setupContentSecurityPolicy(myCapacitorApp.getCustomURLScheme());
  // Initialize our app, build windows, and load content.
  await myCapacitorApp.init();
  // Wire the menu-bar tray timer. Lazy resolution of the main window
  // so it picks up the new window if the app re-inits later.
  const popover = installPomodoroPopover({
    getTray: () => getInstalledTray(),
    customScheme: myCapacitorApp.getCustomURLScheme(),
  });
  const ensureMainRendererReadyForPopover = async () => {
    let win = myCapacitorApp.getMainWindow?.() ?? null;
    let recreated = false;
    if (!win || win.isDestroyed()) {
      await myCapacitorApp.init();
      recreated = true;
      win = myCapacitorApp.getMainWindow?.() ?? null;
    }
    if (!win || win.isDestroyed()) return null;

    await waitForRendererReady(win);
    await waitForMainTimerHandlerReady(win);
    // The popover is the user-visible surface for this click. If we had
    // to recreate the main renderer just to own timer state, keep it in
    // the background instead of flashing the full app on top.
    if (recreated && !win.isDestroyed() && win.isVisible()) {
      win.hide();
    }
    return win;
  };
  installTimerBridge({
    getMainWindow: () => myCapacitorApp.getMainWindow(),
    getPopoverWindow: () => getPopoverWindow(),
  });
  installAuthBridge({
    getMainWindow: () => myCapacitorApp.getMainWindow(),
    getPopoverWindow: () => getPopoverWindow(),
  });
  installPomodoroTray({
    getMainWindow: () => myCapacitorApp.getMainWindow(),
    // Mirrors the `app.on('activate')` flow below — used by the
    // right-click "Open Mangodoro timer" menu item to bring the full
    // main window back if it was closed.
    reopenMainWindow: async () => {
      const current = myCapacitorApp.getMainWindow();
      if (!current || current.isDestroyed()) {
        await myCapacitorApp.init();
      }
    },
    // Left-click on the menu bar icon toggles the popover (Spark-style)
    // rather than focusing the main window. Right-click still goes
    // through reopenMainWindow / focusOnTimer.
    onTrayClick: async () => {
      const win = await ensureMainRendererReadyForPopover();
      if (!win) return;
      popover.toggle();
    },
  });
  installOAuthHandler();
  // Auto-update only runs when (a) we're in a packaged build and
  // (b) a publish channel was actually configured (which generates
  // Contents/Resources/app-update.yml). Without the yml, checkForUpdates
  // throws a synchronous ENOENT — caught here so the app keeps running.
  // To enable: set `publish: { provider: ... }` in electron-builder.config
  // and ship via `npm run electron:publish`.
  if (app.isPackaged) {
    try {
      autoUpdater.checkForUpdatesAndNotify().catch((e) => {
        console.warn('autoUpdater check failed:', e?.message ?? e);
      });
    } catch (e) {
      console.warn('autoUpdater unavailable:', (e as Error)?.message ?? e);
    }
  }
})();

// Handle when all of our windows are close (platforms have their own expectations).
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// When the dock icon is clicked.
app.on('activate', async function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (myCapacitorApp.getMainWindow().isDestroyed()) {
    await myCapacitorApp.init();
  }
});

// Place all ipc or other electron api calls and custom functionality under this line
