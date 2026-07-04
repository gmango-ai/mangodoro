import { BrowserWindow, ipcMain } from "electron";

let lastPublishedState: unknown = null;
let nextCommandId = 1;
const mainHandlerReadyWebContentsIds = new Set<number>();
const mainHandlerReadyWaiters = new Map<number, Set<(ready: boolean) => void>>();
const pendingCommands = new Map<
  string,
  { resolve: (result: TimerCommandResult) => void; timeout: NodeJS.Timeout }
>();
const COMMAND_ACK_TIMEOUT_MS = 1000;

interface TimerCommandResult {
  ok: boolean;
  reason?: string;
}

interface TimerBridgeHooks {
  getMainWindow: () => BrowserWindow | null;
  getPopoverWindow: () => BrowserWindow | null;
}

function isUsableWindow(win: BrowserWindow | null): win is BrowserWindow {
  return !!win && !win.isDestroyed() && !win.webContents.isDestroyed();
}

function settleMainHandlerReadyWaiters(webContentsId: number, ready: boolean) {
  const waiters = mainHandlerReadyWaiters.get(webContentsId);
  if (!waiters) return;
  mainHandlerReadyWaiters.delete(webContentsId);
  for (const resolve of waiters) resolve(ready);
}

export function waitForMainTimerHandlerReady(
  win: BrowserWindow | null,
  timeoutMs = 3000
): Promise<boolean> {
  if (!isUsableWindow(win)) return Promise.resolve(false);
  const webContentsId = win.webContents.id;
  if (mainHandlerReadyWebContentsIds.has(webContentsId)) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      const waiters = mainHandlerReadyWaiters.get(webContentsId);
      waiters?.delete(finish);
      if (waiters?.size === 0) mainHandlerReadyWaiters.delete(webContentsId);
      if (timeout) clearTimeout(timeout);
      resolve(ready);
    };

    const waiters = mainHandlerReadyWaiters.get(webContentsId) ?? new Set();
    waiters.add(finish);
    mainHandlerReadyWaiters.set(webContentsId, waiters);
    timeout = setTimeout(() => finish(false), timeoutMs);
  });
}

export function installTimerBridge(hooks: TimerBridgeHooks) {
  ipcMain.on("mangodoro:timer:publish", (event, snapshot) => {
    lastPublishedState = snapshot;
    const pop = hooks.getPopoverWindow();
    if (isUsableWindow(pop) && event.sender.id !== pop.webContents.id) {
      pop.webContents.send("mangodoro:timer:state", snapshot);
    }
  });

  ipcMain.on("mangodoro:timer:main-handler-ready", (event) => {
    const main = hooks.getMainWindow();
    if (!isUsableWindow(main) || event.sender.id !== main.webContents.id) return;
    mainHandlerReadyWebContentsIds.add(event.sender.id);
    settleMainHandlerReadyWaiters(event.sender.id, true);
  });

  ipcMain.on("mangodoro:timer:main-handler-unready", (event) => {
    const main = hooks.getMainWindow();
    if (!isUsableWindow(main) || event.sender.id !== main.webContents.id) return;
    mainHandlerReadyWebContentsIds.delete(event.sender.id);
  });

  ipcMain.on("mangodoro:timer:command-result", (event, result: TimerCommandResult & { id?: string }) => {
    const main = hooks.getMainWindow();
    if (!isUsableWindow(main) || event.sender.id !== main.webContents.id) return;
    if (!result?.id) return;
    const pending = pendingCommands.get(result.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingCommands.delete(result.id);
    pending.resolve({ ok: result.ok !== false, reason: result.reason });
  });

  ipcMain.handle("mangodoro:timer:command", (event, payload: { method: string; args?: unknown[] }): Promise<TimerCommandResult> | TimerCommandResult => {
    const main = hooks.getMainWindow();
    if (!isUsableWindow(main)) return { ok: false, reason: "main-unavailable" };
    if (event.sender.id === main.webContents.id) return { ok: true };
    let commandId = "";
    try {
      commandId = `cmd-${Date.now()}-${nextCommandId++}`;
      const result = new Promise<TimerCommandResult>((resolve) => {
        const timeout = setTimeout(() => {
          pendingCommands.delete(commandId);
          resolve({ ok: false, reason: "main-handler-timeout" });
        }, COMMAND_ACK_TIMEOUT_MS);
        pendingCommands.set(commandId, { resolve, timeout });
      });
      main.webContents.send("mangodoro:timer:command-relay", { ...payload, id: commandId });
      return result;
    } catch {
      const pending = commandId ? pendingCommands.get(commandId) : null;
      if (pending) {
        clearTimeout(pending.timeout);
        pendingCommands.delete(commandId);
        pending.resolve({ ok: false, reason: "command-relay-failed" });
      }
      return { ok: false, reason: "command-relay-failed" };
    }
  });

  ipcMain.handle("mangodoro:timer:getState", () => lastPublishedState);
}

/** Push cached state to a popover that just opened. */
export function pushTimerStateToPopover(popover: BrowserWindow) {
  if (lastPublishedState && isUsableWindow(popover)) {
    popover.webContents.send("mangodoro:timer:state", lastPublishedState);
  }
}
