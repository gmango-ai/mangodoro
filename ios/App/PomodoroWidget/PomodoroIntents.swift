import Foundation
import ActivityKit
import AppIntents
import UserNotifications
import WidgetKit
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
// Offline / failure fallback: on dispatch failure we leave App Group
// flags unchanged so the host app does not reconcile a tap that never
// reached the server. On success (including 502 when the DB persisted
// but APNs failed) we mirror the server's new_state back into the App
// Group so the next lockscreen tap sends fresh current_state.

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

// Refresh the home-screen widget so it reflects the toggle right away.
// Without this, a lockscreen / Dynamic Island tap updates the App Group
// state + Live Activity but the home widget keeps rendering the stale
// (still-running) snapshot until its own timeline policy fires.
private func reloadHomeWidget() {
    WidgetCenter.shared.reloadTimelines(ofKind: "MangodoroHomeWidget")
}

// Mirror the edge function's toggle so we can repaint instantly. running →
// paused (remaining seconds); paused → running (fresh end time).
private func computeToggledState(_ state: [String: Any]) -> [String: Any] {
    var next = state
    let nowMs = Date().timeIntervalSince1970 * 1000
    if state["isRunning"] as? Bool ?? false {
        let endsAt = state["endsAtEpochMs"] as? Double ?? nowMs
        next["isRunning"] = false
        next["pausedSecondsLeft"] = Int(max(0, (endsAt - nowMs) / 1000))
    } else {
        let paused = state["pausedSecondsLeft"] as? Int ?? 0
        next["isRunning"] = true
        next["endsAtEpochMs"] = nowMs + Double(paused) * 1000
        next.removeValue(forKey: "pausedSecondsLeft")
    }
    return next
}

// Optimistically reflect a toggle in the App Group + home widget BEFORE the
// network round-trip, so the widget responds instantly. Returns the original
// state JSON so a failed dispatch can revert. The round-trip's mirrorServerState
// then overwrites with the server's authoritative state.
private func applyOptimisticToggle() -> String? {
    guard let defaults = UserDefaults(suiteName: appGroupID),
          let json = defaults.string(forKey: activityStateKey),
          let data = json.data(using: .utf8),
          let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return nil }
    let next = computeToggledState(state)
    if let nextData = try? JSONSerialization.data(withJSONObject: next),
       let nextJSON = String(data: nextData, encoding: .utf8) {
        defaults.set(nextJSON, forKey: activityStateKey)
        defaults.set(next["isRunning"] as? Bool ?? false, forKey: lastToggleResultRunningKey)
        reloadHomeWidget()
    }
    return json
}

private func revertOptimisticToggle(_ originalJSON: String?) {
    guard let originalJSON, let defaults = UserDefaults(suiteName: appGroupID) else { return }
    defaults.set(originalJSON, forKey: activityStateKey)
    if let data = originalJSON.data(using: .utf8),
       let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        defaults.set(state["isRunning"] as? Bool ?? false, forKey: lastToggleResultRunningKey)
    }
    reloadHomeWidget()
}

private enum ActivityAction: String {
    case toggle
    case stop
}

@available(iOS 17.0, *)
private enum DispatchResult {
    case succeeded(newState: [String: Any])
    case apnsFailed(newState: [String: Any])
    case failed
}

@available(iOS 17.0, *)
private func mirrorServerState(_ newState: [String: Any], defaults: UserDefaults) {
    if let data = try? JSONSerialization.data(withJSONObject: newState),
       let json = String(data: data, encoding: .utf8) {
        defaults.set(json, forKey: activityStateKey)
    }
    if let isRunning = newState["isRunning"] as? Bool {
        defaults.set(isRunning, forKey: lastToggleResultRunningKey)
    }
}

@available(iOS 17.0, *)
private func parseDispatchResponse(
    _ action: ActivityAction,
    data: Data,
    statusCode: Int,
    defaults: UserDefaults
) -> DispatchResult {
    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let newState = json["new_state"] as? [String: Any] else {
        let snippet = String(data: data.prefix(200), encoding: .utf8) ?? "<binary>"
        log.error("activity-action: HTTP \(statusCode) — \(snippet, privacy: .public)")
        return .failed
    }

    if statusCode == 502 {
        let apnsStatus = json["apns_status"] as? Int ?? -1
        log.error("activity-action: APNs failed apns_status=\(apnsStatus, privacy: .public)")
        mirrorServerState(newState, defaults: defaults)
        return .apnsFailed(newState: newState)
    }

    if (200..<300).contains(statusCode) {
        if let ok = json["ok"] as? Bool, ok {
            log.notice("activity-action: \(action.rawValue, privacy: .public) → \(statusCode) ok=true")
            mirrorServerState(newState, defaults: defaults)
            return .succeeded(newState: newState)
        }
        let apnsStatus = json["apns_status"] as? Int ?? -1
        log.error("activity-action: APNs failed apns_status=\(apnsStatus, privacy: .public)")
        return .failed
    }

    let snippet = String(data: data.prefix(200), encoding: .utf8) ?? "<binary>"
    log.error("activity-action: HTTP \(statusCode) — \(snippet, privacy: .public)")
    return .failed
}

/// POSTs to `<supabaseUrl>/functions/v1/activity-action`. On success
/// mirrors the server's new_state into the App Group for the next tap.
@available(iOS 17.0, *)
private func dispatchActivityAction(_ action: ActivityAction) async -> DispatchResult {
    guard let defaults = UserDefaults(suiteName: appGroupID) else {
        log.notice("activity-action: App Group unavailable")
        return .failed
    }
    guard
        let activityId = defaults.string(forKey: activityIdKey), !activityId.isEmpty,
        let secret = defaults.string(forKey: activitySecretKey), !secret.isEmpty,
        let urlBase = defaults.string(forKey: supabaseUrlKey), !urlBase.isEmpty,
        let anonKey = defaults.string(forKey: supabaseAnonKeyKey), !anonKey.isEmpty,
        let url = URL(string: "\(urlBase.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/functions/v1/activity-action")
    else {
        log.notice("activity-action: missing App Group config")
        return .failed
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
    if let stateJSON = defaults.string(forKey: activityStateKey),
       let stateData = stateJSON.data(using: .utf8),
       let stateObj = try? JSONSerialization.jsonObject(with: stateData) {
        body["current_state"] = stateObj
    }
    do {
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
    } catch {
        log.error("activity-action: json encode failed: \(String(describing: error))")
        return .failed
    }

    do {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { return .failed }
        return parseDispatchResponse(action, data: data, statusCode: http.statusCode, defaults: defaults)
    } catch {
        log.error("activity-action: network failure: \(String(describing: error))")
        return .failed
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

        // Instant feedback: repaint the home widget from the toggled state
        // before the network round-trip confirms it.
        let original = applyOptimisticToggle()

        let result = await dispatchActivityAction(.toggle)

        switch result {
        case .succeeded(let newState), .apnsFailed(let newState):
            let nowRunning = newState["isRunning"] as? Bool ?? false
            if !nowRunning {
                cancelScheduledAlarm()
            }
            UserDefaults(suiteName: appGroupID)?.set(true, forKey: pendingToggleKey)
            reloadHomeWidget()
            log.notice("ToggleTimerIntent ok nowRunning=\(nowRunning)")
        case .failed:
            revertOptimisticToggle(original)
            log.notice("ToggleTimerIntent failed — reverted optimistic toggle")
        }

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
        let result = await dispatchActivityAction(.stop)

        switch result {
        case .succeeded, .apnsFailed:
            cancelScheduledAlarm()
            if let defaults = UserDefaults(suiteName: appGroupID) {
                defaults.set(true, forKey: pendingStopKey)
                defaults.set(false, forKey: lastToggleResultRunningKey)
                defaults.removeObject(forKey: activityStateKey)
            }
            reloadHomeWidget()
            log.notice("StopTimerIntent ok")
        case .failed:
            log.notice("StopTimerIntent failed — flags unchanged")
        }

        return .result()
    }
}
