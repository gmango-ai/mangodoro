import { BrowserWindow, ipcMain } from 'electron';

// Handles the Google OAuth round-trip for the Electron desktop app.
//
// AuthPage in the renderer asks Supabase for the provider's auth URL
// (skipBrowserRedirect: true). It then invokes the IPC channel below
// with that URL plus the expected redirect prefix (`mangodoro://`).
// We open a child BrowserWindow pointing at the auth URL, let the user
// sign in there, and intercept navigation back to the redirect prefix
// *before* the unhandled custom-scheme actually fails — yielding the
// full callback URL (?code=… or #access_token=…) back to the renderer
// for supabase.auth.exchangeCodeForSession / setSession.
export function installOAuthHandler(): void {
  ipcMain.handle(
    'mangodoro:oauth:start',
    async (_event, oauthUrl: string, redirectPrefix: string): Promise<string> => {
      return new Promise<string>((resolve, reject) => {
        const popup = new BrowserWindow({
          width: 520,
          height: 720,
          show: true,
          title: 'Sign in',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        });

        let settled = false;

        function captureIfRedirect(rawUrl: string): boolean {
          if (!rawUrl.startsWith(redirectPrefix)) return false;
          settled = true;
          // Close after a tick so the navigation gets cleanly cancelled
          // before the window disappears underneath us.
          setImmediate(() => {
            if (!popup.isDestroyed()) popup.close();
          });
          resolve(rawUrl);
          return true;
        }

        popup.webContents.on('will-redirect', (event, url) => {
          if (captureIfRedirect(url)) event.preventDefault();
        });
        popup.webContents.on('will-navigate', (event, url) => {
          if (captureIfRedirect(url)) event.preventDefault();
        });

        popup.on('closed', () => {
          if (!settled) reject(new Error('OAuth window closed before completion'));
        });

        popup.loadURL(oauthUrl).catch((err) => {
          if (!settled) {
            settled = true;
            if (!popup.isDestroyed()) popup.close();
            reject(err);
          }
        });
      });
    }
  );
}
