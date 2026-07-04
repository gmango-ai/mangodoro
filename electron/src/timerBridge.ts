import { BrowserWindow, ipcMain } from "electron";

let lastPublishedState: unknown = null;
let nextCommandId = 1;
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

export function installTimerBridge(hooks: TimerBridgeHooks) {
  ipcMain.on("mangodoro:timer:publish", (event, snapshot) => {
    lastPublishedState = snapshot;
    const pop = hooks.getPopoverWindow();
    if (isUsableWindow(pop) && event.sender.id !== pop.webContents.id) {
      pop.webContents.send("mangodoro:timer:state", snapshot);
    }
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
