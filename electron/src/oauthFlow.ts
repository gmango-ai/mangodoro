import { BrowserWindow, ipcMain, shell } from 'electron';

// Google OAuth round-trip for the Electron desktop app.
//
// AuthPage (renderer) asks Supabase for the provider auth URL
// (skipBrowserRedirect: true), then invokes 'mangodoro:oauth:start' with that
// URL plus the expected redirect prefix (`mangodoro://`).
//
// We open that URL in the user's DEFAULT SYSTEM BROWSER — not an embedded
// Electron window. Google flags embedded webviews as disallowed user-agents,
// and the real browser reuses the user's existing Google session + password
// manager. Supabase then redirects the browser to
// `mangodoro://auth/callback?code=…`, which the OS routes back to this app via
// the registered protocol handler; index.ts feeds that URL to
// handleOAuthDeepLink() below, resolving the pending promise so the renderer can
// run supabase.auth.exchangeCodeForSession / setSession.
//
// Dev note: custom-protocol routing is only reliable in a PACKAGED build. To
// test login end-to-end in `electron:start`, set MANGODORO_OAUTH_POPUP=1 to fall
// back to the legacy embedded popup, which intercepts the redirect itself.

interface Pending {
  resolve: (url: string) => void;
  reject: (err: Error) => void;
  prefix: string;
  timer: ReturnType<typeof setTimeout>;
}

let pending: Pending | null = null;

// Generous window: the user may take a while in the browser. If nothing comes
// back (e.g. deep link didn't route in dev), the renderer surfaces an error
// rather than spinning forever.
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

function rejectPending(err: Error): void {
  if (!pending) return;
  clearTimeout(pending.timer);
  const { reject } = pending;
  pending = null;
  reject(err);
}

// Called by the deep-link handler (index.ts) when a `mangodoro://` URL arrives.
// Returns true if it satisfied an in-flight OAuth attempt (so the caller can
// focus the main window), false otherwise.
export function handleOAuthDeepLink(url: string): boolean {
  if (!pending || !url.startsWith(pending.prefix)) return false;
  clearTimeout(pending.timer);
  const { resolve } = pending;
  pending = null;
  resolve(url);
  return true;
}

function startViaSystemBrowser(oauthUrl: string, redirectPrefix: string): Promise<string> {
  // Drop any previous in-flight attempt so a stale promise can't swallow the
  // next redirect.
  rejectPending(new Error('OAuth restarted'));
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => rejectPending(new Error('OAuth timed out')), OAUTH_TIMEOUT_MS);
    pending = { resolve, reject, prefix: redirectPrefix, timer };
    shell.openExternal(oauthUrl).catch((err) => {
      if (pending?.resolve === resolve) {
        rejectPending(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

function startViaPopup(oauthUrl: string, redirectPrefix: string): Promise<string> {
  // Legacy embedded-popup flow. Kept only for dev testing (MANGODORO_OAUTH_POPUP=1)
  // where custom-protocol deep links don't reliably round-trip. Opens a child
  // BrowserWindow and captures the redirect back to `mangodoro://` before the
  // unhandled scheme actually fails.
  return new Promise<string>((resolve, reject) => {
    const popup = new BrowserWindow({
      width: 520,
      height: 720,
      show: true,
      title: 'Sign in',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    let settled = false;

    function captureIfRedirect(rawUrl: string): boolean {
      if (!rawUrl.startsWith(redirectPrefix)) return false;
      settled = true;
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

export function installOAuthHandler(): void {
  ipcMain.handle(
    'mangodoro:oauth:start',
    (_event, oauthUrl: string, redirectPrefix: string): Promise<string> =>
      process.env.MANGODORO_OAUTH_POPUP === '1'
        ? startViaPopup(oauthUrl, redirectPrefix)
        : startViaSystemBrowser(oauthUrl, redirectPrefix),
  );
}
