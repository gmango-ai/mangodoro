# iOS Live Activity — manual Xcode setup

The Swift sources for the Live Activity ship in this branch, but adding a
Widget Extension *target* to the Xcode project can't be done by editing
files — Xcode generates target metadata in `App.xcodeproj/project.pbxproj`
that's painful to author by hand. Do these once, then commit the
`project.pbxproj` diff.

## 1. Add the Widget Extension target

1. `bun run cap:open:ios` (or `npx cap open ios`).
2. In Xcode: **File → New → Target… → Widget Extension**.
3. Settings:
   - **Product Name**: `PomodoroWidget`
   - **Bundle Identifier**: `com.gmango.mangodoro.PomodoroWidget`
   - **Include Live Activity**: ✅ (checkbox in the template)
   - **Include Configuration App Intent**: ❌
4. Confirm "Activate Scheme" when prompted.

Xcode will scaffold `ios/App/PomodoroWidget/` with placeholder files.

## 2. Replace scaffolded files

Delete the default `PomodoroWidget.swift`, `PomodoroWidgetBundle.swift`,
`PomodoroWidgetLiveActivity.swift`, and `AppIntent.swift` that Xcode
generates. The branch already contains the real implementations:

- `ios/App/PomodoroWidget/PomodoroWidgetBundle.swift`
- `ios/App/PomodoroWidget/PomodoroLiveActivity.swift`
- `ios/App/PomodoroWidget/Info.plist` (overwrites the default)

In Xcode, drag those three files into the `PomodoroWidget` target so they
show up under the right group.

## 3. Share `PomodoroActivityAttributes.swift` between both targets

`ios/App/App/PomodoroActivityAttributes.swift` must be a member of BOTH
the main `App` target AND the `PomodoroWidget` target — the JS-callable
plugin starts/updates activities using the type defined there, and the
widget renders them. In Xcode:

1. Select `PomodoroActivityAttributes.swift` in the project navigator.
2. In **File Inspector → Target Membership**, tick both `App` and
   `PomodoroWidget`.

## 4. Register the Capacitor plugin

The branch already includes `ios/App/App/PersistentTimerPlugin.swift`
which conforms to `CAPBridgedPlugin` and self-registers via Capacitor's
auto-discovery (Capacitor 6+ scans for `CAPBridgedPlugin` conformers and
exposes them under their `jsName`). No further wiring required for
modern Capacitor.

If you're on Capacitor < 6 you'll need a companion `.m` file:

```objc
// ios/App/App/LiveActivityPlugin.m
#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(LiveActivityPlugin, "LiveActivity",
  CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(update, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
)
```

## 5. Deployment target

ActivityKit requires **iOS 16.1+**. If the App target's `IPHONEOS_DEPLOYMENT_TARGET`
is older, bump it to `16.1` in `ios/App/App.xcodeproj` (Build Settings →
Deployment → iOS Deployment Target). The widget extension target should
likewise be `16.1+`.

## 6. App Groups (required for lockscreen pause/resume button)

The pause/resume button on the Live Activity is a `LiveActivityIntent`
that runs in the widget process — it can't reach Supabase or the main
app's pomodoro state directly. The bridge between processes is an App
Group with a shared `UserDefaults`.

For BOTH the **App** target AND the **PomodoroWidget** target:
1. Select the target → **Signing & Capabilities** tab.
2. Click **+ Capability** (top-left of the tab) → choose **App Groups**.
3. In the new "App Groups" section, click **+** at the bottom and add
   identifier: `group.com.gmango.mangodoro`
4. Tick the box next to it.

Both targets must be ticked into the same group, otherwise the widget
writes and the app reads from separate sandboxes and the toggle is
silently lost.

## 7. Custom app icon in the activity (optional)

Drag a square PNG (~256×256, transparent or filled) into
`PomodoroWidget/Assets.xcassets` as a new Image Set named
**`WidgetAppIcon`**. The Live Activity tints a circular badge with the
user's accent color and renders the icon inside it. Skip this step and
the widget falls back to an SF Symbol — the build still works.

## 8. Verify

1. `bun run cap:build`
2. Run on a real device (Live Activities don't render in the simulator
   on iOS 16.x; they do on iOS 17+).
3. Start a pomodoro. Lock the device — the lockscreen should show the
   ticking countdown. Devices with the Dynamic Island will show it
   there too.
4. Tap the pause button on the lockscreen activity — the countdown
   should freeze, "Paused" appears, the play icon swaps in, the app
   does NOT come to foreground. Unlock and the app's own pause state
   should match.
