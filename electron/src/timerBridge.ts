import { BrowserWindow, ipcMain } from "electron";

let lastPublishedState: unknown = null;

interface TimerBridgeHooks {
  getMainWindow: () => BrowserWindow | null;
  getPopoverWindow: () => BrowserWindow | null;
}

export function installTimerBridge(hooks: TimerBridgeHooks) {
  ipcMain.on("mangodoro:timer:publish", (event, snapshot) => {
    lastPublishedState = snapshot;
    const pop = hooks.getPopoverWindow();
    if (pop && !pop.isDestroyed() && event.sender.id !== pop.webContents.id) {
      pop.webContents.send("mangodoro:timer:state", snapshot);
    }
  });

  ipcMain.handle("mangodoro:timer:command", (event, payload: { method: string; args?: unknown[] }) => {
    const main = hooks.getMainWindow();
    if (!main || main.isDestroyed()) return { ok: false };
    if (event.sender.id === main.webContents.id) return { ok: true };
    main.webContents.send("mangodoro:timer:command-relay", payload);
    return { ok: true };
  });

  ipcMain.handle("mangodoro:timer:getState", () => lastPublishedState);
}

/** Push cached state to a popover that just opened. */
export function pushTimerStateToPopover(popover: BrowserWindow) {
  if (lastPublishedState && !popover.isDestroyed()) {
    popover.webContents.send("mangodoro:timer:state", lastPublishedState);
  }
}
