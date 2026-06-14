# Capacitor Mobile App — Phase 1 Plan

Wrap the existing Mangodoro PWA in Capacitor so it ships as a native iOS + Android app, **without forking the codebase**. This plan covers a working "hello, the app boots and you can sign in" build on both platforms, plus the next iteration for the showstopper mobile gaps (auth deep links, background pomodoro alarms, file exports).

## Decisions baked in

These are reasonable defaults — call out a swap if any are wrong:

1. **Single codebase, conditional integrations.** The mobile app reuses the existing React/Vite build. Capacitor-only code branches on `Capacitor.isNativePlatform()`. We do **not** fork or create a separate mobile workspace.
2. **App ID**: `com.gmango.mangodoro`. Display name: `Mangodoro`.
3. **Custom URL scheme**: `mangodoro://` (universal links are a Phase 3 follow-up — they need an `apple-app-site-association` file served from `mangodoro.com`).
4. **Canonical web URL**: `https://mangodoro.com` — used for share links and as the OAuth redirect base on the web build.
5. **Distribution target for Phase 1**: local sim/emu only. No signing certs, no App Store / Play Console accounts yet. Phase 2 stays scoped to "works on the simulator and a tethered dev device."
6. **Both platforms in scope** from Phase 1. iOS is the higher-risk surface (background suspension, autoplay rules, OAuth deep-links); Android is mostly free once iOS works.
7. **Keep `BrowserRouter`**. Capacitor serves the WebView from `capacitor://localhost` (iOS) / `http://localhost` (Android), both of which support `pushState`. No `HashRouter` conversion needed.
8. **Disable PWA service worker on native builds.** The SW is irrelevant inside Capacitor and the Workbox precache conflicts with Capacitor's asset server. We gate `VitePWA(...)` on an env flag.
9. **Mobile-aware features that already feature-detect** (Document PiP, Notification API, Document drag/drop) **degrade gracefully** — leave them; they self-hide on mobile.

---

## Phase 1 — Bootstrap (the actually-runs milestone)

Goal: `bun run cap:open:ios` opens Xcode, sim runs the app, you can sign in with email/password, the pomodoro timer ticks. Same for Android Studio.

### 1.1 Install + init
- Add deps: `@capacitor/core @capacitor/cli @capacitor/ios @capacitor/android`.
- `npx cap init Mangodoro com.gmango.mangodoro --web-dir=dist`.
- `npx cap add ios && npx cap add android` (creates `ios/` and `android/` folders — both should be committed).

### 1.2 Capacitor config — `capacitor.config.ts`
- `webDir: 'dist'`
- `server.androidScheme: 'https'` (Android cookies/CORS behave better than `http`).
- `ios.contentInset: 'always'` so iOS safe-area handles the notch.
- **No `server.url`** — that's only for live-reload, not production.
- Custom scheme registration for deep links (used in Phase 2): `ios.customUrlScheme: 'mangodoro'`.

### 1.3 Vite/PWA wiring — `vite.config.js`
- Wrap `VitePWA(...)` in `process.env.CAPACITOR_BUILD ? null : VitePWA(...)` (filter out the null plugin).
- Add a `cap:build` script: `CAPACITOR_BUILD=1 vite build && npx cap sync`.
- Add openers: `cap:open:ios` → `npx cap open ios`, same for Android.
- Add `cap:run:ios` → build + sync + open in one go.

### 1.4 Capacitor-aware module — new file `src/lib/platform.js`
- Re-exports `Capacitor.isNativePlatform()`, `getPlatform()`, and a `isMobileApp` boolean.
- Every native-only branch elsewhere goes through this so we don't sprinkle `Capacitor.*` imports.

### 1.5 Critical files to touch in Phase 1
| File | Change |
|---|---|
| `package.json` | Add Capacitor deps + npm scripts |
| `vite.config.js` | Gate `VitePWA(...)` on `!CAPACITOR_BUILD` |
| `capacitor.config.ts` | New |
| `src/lib/platform.js` | New |
| `src/components/PWAUpdater.jsx` | No-op when `isMobileApp` (the SW isn't there) |
| `.gitignore` | Add `ios/App/Pods`, `ios/DerivedData`, `android/.gradle`, `android/build`, `android/app/build` |

### 1.6 Smoke-test checklist
- iOS sim: app launches, see Auth page, sign in with existing email/password, land on `/pomodoro`, timer counts down.
- Android emu: same.
- Pull to refresh inside the WebView should be disabled (it currently isn't and will look broken) — set `ios.scrollEnabled` and Android `webContentsDebuggingEnabled` in config.

---

## Phase 2 — Showstopper mobile gaps (the actually-usable milestone)

These are the four issues that will block real-world use even after Phase 1 boots cleanly.

### 2.1 Auth deep linking (highest-impact)
**Problem.** `src/AuthPage.jsx:22,44` and `src/context/AppContext.jsx:1180` pass `redirectTo: window.location.href` to Supabase. Inside Capacitor, that resolves to `capacitor://localhost/...` — Google can't redirect to a custom scheme without a registered redirect URI, and the email-confirmation link in the user's inbox would try to open `capacitor://localhost` from Mail, which fails.

**Fix.**
- Register `mangodoro://auth/callback` as an allowed redirect URI in **Supabase → Authentication → URL Configuration**.
- In `src/lib/platform.js`, export `getAuthRedirectUrl()` that returns `'mangodoro://auth/callback'` on native, `window.location.href` on web.
- Update the three call sites above to use it.
- Add `@capacitor/app` and register a deep-link listener that hands the `?code=...` query param off to `supabase.auth.exchangeCodeForSession(...)`.
- For Google OAuth specifically: also need to register the same redirect URI in **Google Cloud Console → Credentials → OAuth Client → Authorized redirect URIs**.
- iOS: add the URL scheme in `ios/App/App/Info.plist` (CFBundleURLTypes). Android: intent-filter in `android/app/src/main/AndroidManifest.xml`.

**Defer.** Google Sheets export OAuth (`AppContext.jsx:1180`) reuses the same redirect plumbing — handles "for free" once the Supabase flow works.

### 2.2 Background pomodoro alarms (the core feature)
**Problem.** iOS suspends the WebView ~30 seconds after backgrounding. The JS `setInterval` in `src/pomodoro/PomodoroContext.jsx` stops ticking, and `new Notification(...)` (lines 384-395) doesn't work in Capacitor's WebView. If the user backgrounds the app, the pomodoro alarm **never fires**.

**Fix.**
- Add `@capacitor/local-notifications`.
- When a pomodoro starts (and on every duration change), schedule a local notification for `now + remainingMs` with the work/break title and the user's chosen alarm sound.
- Cancel the scheduled notification on pause / reset / phase-change.
- Keep the in-app `Notification` path for the **web** build (gate on `isMobileApp`).
- iOS: request permission at app launch via `LocalNotifications.requestPermissions()`.
- **Custom sounds caveat**: native local notifications use bundled sound files, not Supabase-URL'd MP3s. For Phase 2, fall back to the default system alert; per-user custom alarm sounds via local notifications is a Phase 4 problem (requires downloading + caching audio into the app's documents dir).

### 2.3 File exports (XLSX, PDF, JSON)
**Problem.** `src/lib/utils.js:190-196` and the export paths in `AppContext.jsx` create a Blob, build a `<a href={URL.createObjectURL(blob)} download="...">`, and click it. iOS WebView ignores the `download` attribute; the file opens in-tab or does nothing.

**Fix.**
- Add `@capacitor/filesystem` and `@capacitor/share`.
- In `src/lib/utils.js`, wrap the download helper: on native, write the blob to `Filesystem.writeFile({ directory: Directory.Cache, ... })`, then call `Share.share({ files: [uri] })` — this opens the standard share sheet (Save to Files, AirDrop, email, etc.).
- Same fix covers PDF invoice (`jspdf save()`) and ExcelJS (`writeFile()`).
- Profile-export JSON, timesheet CSV/XLSX, invoice PDF all flow through the same helper.

### 2.4 Sync session invite links
**Problem.** `src/components/SyncSessionModal.jsx:121` and `PomodoroTimer.jsx:346,446` build join URLs with `window.location.origin` — on native that's `capacitor://localhost/...`, useless to share.

**Fix.** Add a `getShareableBaseUrl()` helper in `platform.js` returning `https://mangodoro.com` on native, `window.location.origin` on web. Recipients still join via the web app or, eventually, a universal link that opens the mobile app directly.

---

## Phase 3+ (roadmap, not in this plan)

Noted so the Phase 1/2 choices don't paint us into corners:

- **Universal links** (replace custom-scheme deep linking) — needs `apple-app-site-association` served from a public domain.
- **Push notifications** (server-pushed pomodoro events, sync session pings) — requires a backend push tier; FCM (Android) + APNs (iOS) via `@capacitor/push-notifications`.
- **Mobile-first nav** — current top sticky header + hamburger overlay works, but a bottom tab bar is the iOS/Android convention. Likely the right call after Phase 2 ships.
- **Office floor plan on mobile** — pinch-to-zoom + pan would be a real redesign; ship Phase 1 with the existing `sm:hidden grid` fallback.
- **Custom alarm sound on local notification** — requires copying the user's selected MP3 into the app sandbox at sound-change time and referencing it by filename in the notification payload.
- **App backgrounding & realtime** — `supabase.channel` websockets drop on suspend; add an App-state listener that re-subscribes on resume.
- **Storage migration** — move sensitive keys (`worklog_deepseek_key`, Supabase session) from `localStorage` to `@capacitor/preferences` for proper iOS Keychain backing. Not urgent — localStorage works — but worth the polish.
- **App icon + splash assets** — generate from `public/maskable-icon-512x512.png` via `@capacitor/assets`. Need a 1024×1024 source ideally.

---

## Verification

After Phase 1:
- `bun run build && npx cap sync` runs cleanly with no Workbox errors.
- iOS sim (`npx cap open ios`, Run): app launches, no white screen, Auth page renders correctly with safe-area inset.
- Android emu (`npx cap open android`, Run): same.
- Existing **web build** (`bun run dev`, `bun run build && bun run preview`) is byte-for-byte unchanged when `CAPACITOR_BUILD` is unset — the PWA still installs, service worker still registers, no regressions in production.
- Sign in with email/password on the simulator. Confirm session persists across app restart.

After Phase 2:
- Sign in with Google on iOS sim — Safari opens, OAuth completes, deep-link returns to app, session established.
- Start a 1-minute pomodoro, background the app, wait 60s — local notification fires with sound.
- Export a timesheet to XLSX on iOS — share sheet appears, file saves to Files app.
- Generate a sync session, copy the link — link uses production web URL, opens correctly in another browser.

---

## Confirmed setup

- **Bundle ID**: `com.gmango.mangodoro`
- **Production URL**: `https://mangodoro.com`
- **Phase 1 target**: iOS simulator + Android emulator on dev machine only (no signing certs, no store listings)
