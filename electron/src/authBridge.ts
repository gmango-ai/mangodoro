import { BrowserWindow, ipcMain } from "electron";

export interface ElectronAuthPayload {
  access_token: string;
  refresh_token: string;
  expires_at?: number | null;
  token_type?: string | null;
}

interface AuthBridgeHooks {
  getMainWindow: () => BrowserWindow | null;
  getPopoverWindow: () => BrowserWindow | null;
}

let lastAuthSession: ElectronAuthPayload | null = null;

function isUsableWindow(win: BrowserWindow | null): win is BrowserWindow {
  return !!win && !win.isDestroyed() && !win.webContents.isDestroyed();
}

function isAuthPayload(payload: unknown): payload is ElectronAuthPayload {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as Partial<ElectronAuthPayload>;
  return (
    typeof candidate.access_token === "string" &&
    candidate.access_token.length > 0 &&
    typeof candidate.refresh_token === "string" &&
    candidate.refresh_token.length > 0
  );
}

export function installAuthBridge(hooks: AuthBridgeHooks) {
  ipcMain.on("mangodoro:auth:publish", (event, payload: ElectronAuthPayload | null) => {
    const main = hooks.getMainWindow();
    if (!isUsableWindow(main) || event.sender.id !== main.webContents.id) return;

    lastAuthSession = isAuthPayload(payload) ? payload : null;
    const pop = hooks.getPopoverWindow();
    if (isUsableWindow(pop)) {
      pop.webContents.send("mangodoro:auth:session", lastAuthSession);
    }
  });

  ipcMain.handle("mangodoro:auth:getSession", () => lastAuthSession);
}
