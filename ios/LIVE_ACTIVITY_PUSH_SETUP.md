# Live Activity APNs Push — one-time setup

Lockscreen taps from the widget call our Supabase edge function
`activity-action`, which uses APNs to push a Live Activity update
directly to the device. The user doesn't need the app to be running for
the lockscreen UI to change.

This file covers the one-time infrastructure: APNs key, Supabase
secrets, capability flags, DB migration, function deploy.

## 1. Apple side — APNs Auth Key

1. https://developer.apple.com/account/resources/authkeys
2. **+** → **Apple Push Notifications service (APNs)** → name it
   "Mangodoro Live Activities" → Continue → Register
3. Download the `.p8` file — **you only get one chance**, store it
   securely (1Password / Keychain)
4. Note the **Key ID** (10 chars, shown on the page)
5. Note your **Team ID**: top-right of developer.apple.com → membership

## 2. Xcode — capabilities

Open `ios/App/App.xcworkspace`, select the **App** target:

- **Signing & Capabilities** → **+ Capability**
  - **Push Notifications** — required so APNs trusts our Live Activity push
  - **Background Modes** → check **Remote notifications** (for token rotation)
- Confirm **App Groups** still contains `group.com.gmango.mangodoro`
  on BOTH the **App** target and the **PomodoroWidgetExtension** target

Rebuild the provisioning profile if Xcode prompts.

## 3. Supabase — secrets

```bash
# from project root
supabase secrets set \
  APNS_KEY_ID=ABCD123456 \
  APNS_TEAM_ID=YOURTEAMID \
  APNS_BUNDLE_ID=com.gmango.mangodoro \
  APNS_ENV=production

# multi-line .p8 — use the file path
supabase secrets set --env-file <(printf 'APNS_KEY_P8=%s\n' "$(cat ~/Downloads/AuthKey_ABCD123456.p8)")
```

`APNS_ENV` is `production` for App Store / TestFlight builds and the
`Release` configuration; switch to `sandbox` for `Debug` builds against
the sandbox APNs gateway. The iOS app reports its own env per-activity
(`apns_env` in the register payload), so the server uses the right
gateway regardless of this default.

Verify:

```bash
supabase secrets list | grep APNS
```

## 4. Database migration

```bash
supabase db push
```

This applies `supabase/migrations/20260614000000_pomodoro_activity_tokens.sql`
which creates the table that links each active Live Activity to its
push token, owning user, and per-activity HMAC secret hash.

## 5. Deploy edge functions

```bash
supabase functions deploy activity-register
supabase functions deploy activity-action
```

Confirm both show up under Functions in the Supabase dashboard with the
shared `_shared/apns.ts` bundled.

## 6. Build the app

```bash
bun run cap:build
```

Then in Xcode: ⇧⌘K → Run on a real device (Live Activities don't fire
in the simulator).

## 7. Smoke test

1. Start a timer in the app
2. Lock the phone, look at the Live Activity on the lockscreen
3. Tap **pause** — within ~1 second the play icon should appear and the
   countdown should freeze
4. Tap **play** — countdown resumes
5. Tap **stop** — activity dismisses

If it doesn't update visually, in Console.app filter on subsystem
`com.gmango.mangodoro.widget` and look for:
- `ToggleTimerIntent fired`
- `activity-action: toggle → 200` (success) or an error line
- Then check Supabase function logs:
  `supabase functions logs activity-action --tail`

Common failures:
- **401 / 403**: `APNS_KEY_ID`, `APNS_TEAM_ID`, or `APNS_KEY_P8` wrong
- **403 invalid secret**: the App Group's `mangodoro.currentActivitySecret`
  doesn't match what was registered — usually means an old activity from
  before this migration is still around; stop and restart the timer
- **404 activity not found**: the host app never registered, check the
  `pushTokenReceived` listener wired up correctly and that
  `activity-register` was called
- **APNs `BadDeviceToken`**: `APNS_ENV` mismatch (Debug build pushing
  to production gateway or vice-versa)
- **APNs `TopicDisallowed`**: Push Notifications capability missing on
  the App target, or bundle ID mismatch
