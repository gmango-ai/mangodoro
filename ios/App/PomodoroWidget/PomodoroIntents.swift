import Foundation
import ActivityKit
import AppIntents
import UserNotifications
import os

// Tap targets for the buttons on the Live Activity. Each one is a
// LiveActivityIntent so it runs in the widget extension's process and
// the host app does NOT get foregrounded. The intent makes a single
// network call to our Supabase activity-action edge function, which
// sends an APNs Live Activity push to update the on-device UI. The
// edge function is also the authoritative state mutator.
//
// Why the network round-trip:
//   `Activity<>.activities` is empty in the freshly-spawned intent
//   process (it lives in a "plugin" sandbox profile distinct from the
//   "sessions-extension" render process), so `await activity.update()`
//   here is a no-op. An APNs push reaches the renderer regardless.
//
// Offline / failure fallback: we still write the App Group flag so the
// host app reconciles its JS-side state and re-syncs the activity the
// next time it foregrounds, matching the pre-APNs behavior.

private let appGroupID = "group.com.gmango.mangodoro"
private let pendingToggleKey = "mangodoro.pendingTimerToggle"
private let lastToggleResultRunningKey = "mangodoro.lastToggleResultRunning"
private let pendingStopKey = "mangodoro.pendingTimerStop"
private let activityIdKey = "mangodoro.currentActivityId"
private let activitySecretKey = "mangodoro.currentActivitySecret"
private let activityStateKey = "mangodoro.currentActivityState"
private let supabaseUrlKey = "mangodoro.supabaseUrl"
private let supabaseAnonKeyKey = "mangodoro.supabaseAnonKey"

// Matches POMODORO_NOTIF_ID in src/lib/nativeNotifications.js. The
// @capacitor/local-notifications iOS implementation registers
// notifications with String(id) as the identifier.
private let pomodoroAlarmIdentifier = "1"

private let log = Logger(subsystem: "com.gmango.mangodoro.widget", category: "intents")

// Removes the scheduled pomodoro alarm. UNUserNotificationCenter is
// per-process but the underlying pending-notification queue is keyed
// by the app's bundle ID, so cancellations from the widget extension
// affect the host app's scheduled notifications.
private func cancelScheduledAlarm() {
    UNUserNotificationCenter.current()
        .removePendingNotificationRequests(withIdentifiers: [pomodoroAlarmIdentifier])
}

private enum ActivityAction: String {
    case toggle
    case stop
}

/// POSTs to `<supabaseUrl>/functions/v1/activity-action`. Returns true
/// on a 2xx so the caller can decide whether to fall back to the App
/// Group flag path. Network/auth failures are logged and swallowed.
@available(iOS 17.0, *)
private func dispatchActivityAction(_ action: ActivityAction) async -> Bool {
    let defaults = UserDefaults(suiteName: appGroupID)
    guard
        let activityId = defaults?.string(forKey: activityIdKey), !activityId.isEmpty,
        let secret = defaults?.string(forKey: activitySecretKey), !secret.isEmpty,
        let urlBase = defaults?.string(forKey: supabaseUrlKey), !urlBase.isEmpty,
        let anonKey = defaults?.string(forKey: supabaseAnonKeyKey), !anonKey.isEmpty,
        let url = URL(string: "\(urlBase.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/functions/v1/activity-action")
    else {
        log.notice("activity-action: missing App Group config, falling back to local flag")
        return false
    }

    var request = URLRequest(url: url, timeoutInterval: 4)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(anonKey, forHTTPHeaderField: "apikey")
    request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")

    var body: [String: Any] = [
        "activity_id": activityId,
        "secret": secret,
        "action": action.rawValue
    ]
    // Forward the host's last-known content state if available so the
    // server uses fresh state instead of whatever it had stored at last
    // register/action. Covers in-app pause/resume that never round-tripped
    // through the server.
    if let stateJSON = defaults?.string(forKey: activityStateKey),
       let stateData = stateJSON.data(using: .utf8),
       let stateObj = try? JSONSerialization.jsonObject(with: stateData) {
        body["current_state"] = stateObj
    }
    do {
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
    } catch {
        log.error("activity-action: json encode failed: \(String(describing: error))")
        return false
    }

    do {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { return false }
        if (200..<300).contains(http.statusCode) {
            log.notice("activity-action: \(action.rawValue, privacy: .public) → \(http.statusCode)")
            return true
        }
        let snippet = String(data: data.prefix(200), encoding: .utf8) ?? "<binary>"
        log.error("activity-action: HTTP \(http.statusCode) — \(snippet, privacy: .public)")
        return false
    } catch {
        log.error("activity-action: network failure: \(String(describing: error))")
        return false
    }
}

@available(iOS 17.0, *)
struct ToggleTimerIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Toggle pomodoro timer"
    static let description = IntentDescription("Pauses or resumes the running pomodoro timer.")
    static let openAppWhenRun: Bool = false
    static let isDiscoverable: Bool = false

    func perform() async throws -> some IntentResult {
        log.notice("ToggleTimerIntent fired")

        let defaults = UserDefaults(suiteName: appGroupID)
        let wasRunning = defaults?.bool(forKey: lastToggleResultRunningKey) ?? false
        let nowRunning = !wasRunning

        // Send to the edge function. On success the APNs push will
        // update the lockscreen UI within ~1s. On failure we still
        // mark the pending-toggle so the host app reconciles when it
        // foregrounds.
        let dispatched = await dispatchActivityAction(.toggle)

        // If we just paused (regardless of dispatch success), drop the
        // host-scheduled local alarm so it doesn't fire at the original
        // endsAtMs while the timer is paused. The host reschedules it
        // when the user resumes.
        if !nowRunning {
            cancelScheduledAlarm()
        }

        defaults?.set(true, forKey: pendingToggleKey)
        defaults?.set(nowRunning, forKey: lastToggleResultRunningKey)
        log.notice("ToggleTimerIntent dispatched=\(dispatched) wasRunning=\(wasRunning) → nowRunning=\(nowRunning)")
        return .result()
    }
}

@available(iOS 17.0, *)
struct StopTimerIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Stop pomodoro timer"
    static let description = IntentDescription("Ends the current pomodoro phase and dismisses the activity.")
    static let openAppWhenRun: Bool = false
    static let isDiscoverable: Bool = false

    func perform() async throws -> some IntentResult {
        log.notice("StopTimerIntent fired")
        let dispatched = await dispatchActivityAction(.stop)
        cancelScheduledAlarm()
        if let defaults = UserDefaults(suiteName: appGroupID) {
            defaults.set(true, forKey: pendingStopKey)
            defaults.set(false, forKey: lastToggleResultRunningKey)
        }
        log.notice("StopTimerIntent dispatched=\(dispatched)")
        return .result()
    }
}
