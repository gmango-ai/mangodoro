# Electron platform — desktop menu-bar timer

This branch ships the Capacitor-renderer side and the two Electron-side
modules (`pomodoroTray.ts`, `pomodoroPreload.ts`). Adding the Electron
*platform* itself to Capacitor is a one-time bootstrap that has to run
locally:

## 1. Install the platform

```bash
bun add -D @capacitor-community/electron
bunx cap add @capacitor-community/electron
```

This generates `electron/` with the scaffolded `src/index.ts`,
`src/preload.ts`, `tsconfig.json`, `package.json`, etc.

The two modules in this branch (`electron/src/pomodoroTray.ts` and
`electron/src/pomodoroPreload.ts`) sit alongside the scaffold and are
imported from it — see steps 2 and 3.

## 2. Wire the tray into `electron/src/index.ts`

Open `electron/src/index.ts` (created by `cap add`) and add the tray
hook after the BrowserWindow is created. The scaffold names the window
`myCapacitorApp` or `mainWindow` depending on the template version — use
the variable name your scaffold uses.

```ts
import { installPomodoroTray } from "./pomodoroTray";

// …after the BrowserWindow is created (often near `myCapacitorApp.init()`)…
installPomodoroTray(() => myCapacitorApp.getMainWindow?.() ?? null);
```

Add a 16x16 (or 22x22 macOS template) PNG at
`electron/resources/tray-icon.png` to give the tray icon a glyph; the
title text countdown ("12:34") renders next to it.

## 3. Wire the preload into `electron/src/preload.ts`

In `electron/src/preload.ts` (also scaffolded), add at the bottom:

```ts
import "./pomodoroPreload";
```

This installs `window.__electronTimer` in the renderer, which
`src/lib/platform.js` feature-detects via `isElectron`.

## 4. Add a renderer-side nav listener

`src/App.jsx` should listen for the `mangodoro:nav` CustomEvent dispatched
by the preload when the user clicks the tray icon, and call
React-Router's `navigate(detail)`. The wiring lives in `App.jsx` — search
for the existing event listeners.

## 5. macOS menu-bar conventions

For a true menu-bar app (no Dock icon), add to the BrowserWindow options:

```ts
if (process.platform === "darwin") app.dock?.hide();
```

…and set `show: false` on the window so it only appears when the user
clicks the tray. This branch leaves the standard Dock behavior intact
because the existing scaffold expects a regular window; flip the switch
above if you want the menu-bar-only UX.

## 6. Build / run

```bash
bun run build
bunx cap sync @capacitor-community/electron
cd electron && bun run electron:start
```

A focus pomodoro started in the renderer should produce a `12:34`-style
ticking title next to the tray icon in the macOS menu bar. Click it →
the main window opens and routes to `/pomodoro`.
