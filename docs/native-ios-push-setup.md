# Native iOS push (alerts when the app is closed)

Why this exists: the native iOS app is a Capacitor **WKWebView**, and iOS does
**not** expose the browser Push API there — `window.PushManager` is undefined,
so `webPush.js` (browser Web Push) can never work in the native app. Web Push
on iOS only works in a Safari-installed home-screen PWA. The native app instead
receives **APNs alert pushes** via the `native-push` edge function.

This is the counterpart to the browser `web-push` path: same webhook contract
(`notification_deliveries` INSERT → only `desktop`-channel, non-`held`
deliveries), different transport.

## Pieces

| Layer | File | Role |
|-------|------|------|
| APNs helper | `supabase/functions/_shared/apns.ts` → `sendAlertPush()` | `apns-push-type: alert`, `aps.alert` title/body + sound |
| Delivery fn | `supabase/functions/native-push/index.ts` | reads `device_push_tokens`, sends an alert per device token, prunes dead tokens |
| iOS auth | `ios/App/App/PersistentTimerPlugin.swift` → `requestNotificationPermission` / `getNotificationPermission` | prompt + read notification authorization |
| iOS push handler | `ios/App/App/PersistentTimerPlugin.swift` (`NotificationHandlerProtocol` → registered as Capacitor's `pushNotificationHandler` in `load()`) | present remote alerts in foreground; forward taps → deep link. Capacitor keeps the `UNUserNotificationCenter` delegate and routes *remote* pushes here, so the LocalNotifications plugin's local-notification handling is untouched. |
| JS bridge | `src/lib/nativeNotifications.js` (`nativePushSupported` / `getNativePushStatus` / `enableNativePush`) | drives the Settings toggle |
| Settings UI | `src/pages/SettingsPage.jsx` | native "Push when the app is closed" toggle (replaces the dead browser toggle on iOS) |
| Deep link | `src/App.jsx` | navigates on `notificationTapped` + drains a cold-launch route |

The APNs **device token** these alerts target is already registered on every
app boot: `PomodoroContext` → `initDeviceWidgetPush` → `device-register` →
`device_push_tokens.push_token`. The only thing that was missing for alerts was
(a) user notification authorization and (b) a server path that sends an alert to
that token. Both are added here.

## Deploy (all server-side; you run these)

1. **Deploy the edge functions** (APNs secrets `APNS_KEY_P8 / APNS_KEY_ID /
   APNS_TEAM_ID / APNS_BUNDLE_ID / APNS_ENV` are already set — Live Activities
   use them):
   ```
   supabase functions deploy native-push --no-verify-jwt
   ```
   (`--no-verify-jwt` so the DB webhook, which sends no user JWT, can call it.)

2. **Secret**: `native-push` reuses `WEB_PUSH_WEBHOOK_SECRET` by default (or set
   a dedicated `NATIVE_PUSH_WEBHOOK_SECRET`). Nothing to do if the web-push
   secret is already set.

3. **Add a Database Webhook** (Dashboard → Database → Webhooks → *Create*),
   identical to the existing web-push one but pointing at `native-push`:
   - Table: `public.notification_deliveries`
   - Events: `INSERT`
   - Type: Supabase Edge Function → `native-push`
   - HTTP header: `x-webhook-secret: <same value as WEB_PUSH_WEBHOOK_SECRET>`

   Both webhooks fire on the same insert: browser subs get web-push, native
   devices get an APNs alert. Each function no-ops for recipients it can't reach.

## iOS rebuild (you run these)

```
npm run cap:build      # vite build + cap sync
# then open ios/App in Xcode and Archive → TestFlight
```

APNs environment must match the build: a **Debug** build talks to the APNs
**sandbox**, a **Release/TestFlight** build to **production**. The device token
row carries `apns_env`, and `native-push` honors it per token, so a
TestFlight build must be uploading `apns_env: "production"` (the default in
`getWidgetRegistration`). If you sideload a Debug build, tokens register as
`sandbox` and only sandbox APNs will deliver.

## Verify

1. In the TestFlight app: **Settings → "Push when the app is closed" → toggle
   on** → accept the iOS prompt. (Confirm `device_push_tokens.push_token` is set
   for your user.)
2. Background the app.
3. Trigger a `desktop`-channel notification for yourself — e.g. have a teammate
   @mention you or knock, or insert a test delivery:
   ```sql
   select public.emit_event(
     p_recipient => '<your-user-id>',
     p_type      => 'mention',
     p_title     => 'Test',
     p_body      => 'native push check',
     p_priority  => 'high'
   );
   ```
4. Expect a banner within a few seconds. Tapping it should open the app to the
   route (or `/`).
5. If nothing arrives, check `supabase functions logs native-push` — the
   response body from APNs (`{ sent, removed, failed }`, and per-error
   `apns error <status> <reason>`) tells you whether it's a bad topic, a
   sandbox/production mismatch (`BadDeviceToken`), or an unregistered token.

## Notes / limits

- **Foreground**: remote alert pushes are shown in-foreground (banner + sound)
  via our `pushNotificationHandler`. The local pomodoro-end notification is
  unchanged — it still routes to Capacitor's LocalNotifications plugin, which we
  don't touch.
- **Which notifications**: same set as browser web-push — anything whose type
  includes the `desktop` channel and isn't `held` by focus/DND. Purely `inapp`
  types (e.g. `room_joined`, `channel`) do not push, by design.
- **Android**: `nativePushSupported()` is iOS-only. Android would need FCM; not
  wired.
