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
// Per-user widget-action identity/credential (written by the plugin's
// getWidgetRegistration). Lets the Start button authenticate to widget-start.
private let userIdKey = "mangodoro.userId"
private let deviceIdKey = "mangodoro.deviceId"
private let widgetSecretKey = "mangodoro.widgetUserSecret"

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

// Compute the toggled time so a stale transition can degrade to a sensible
// number rather than 0:00. running → paused (remaining seconds); paused →
// running (fresh end time).
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

// Mark the toggle as IN PROGRESS in the App Group + home widget BEFORE the
// network round-trip, so the widget gives instant, honest feedback: a tap on
// pause flips the home widget to "Paused" / a tap on resume to "Resuming…"
// right away, then fills in the authoritative time once the server confirms.
//
// We deliberately do NOT show an optimistic *time* during the round-trip (the
// old behavior): the local state can be stale (the website may have changed
// the timer while the app was backgrounded), so a computed time could be
// wrong and then visibly "revert". A transition label only states intent; the
// real time arrives when mirrorServerState writes the server's authoritative
// state (which has no `transition` key, so it clears this).
//
// Safety net: we stamp `transitionAt` so the home widget stops honoring the
// label after a few seconds. If the round-trip dies before the reconcile
// clears it (e.g. the extension is suspended mid-flight), the widget falls
// back to the computed time below instead of being stuck on "Syncing…".
//
// Returns the ORIGINAL (pre-tap) state so the dispatch can revert on failure
// and forward it as the fallback current_state.
private func applyTransitionToggle() -> [String: Any]? {
    guard let defaults = UserDefaults(suiteName: appGroupID),
          let json = defaults.string(forKey: activityStateKey),
          let data = json.data(using: .utf8),
          let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return nil }
    let wasRunning = state["isRunning"] as? Bool ?? false
    // Base = the optimistically-toggled time (the stale-transition fallback);
    // the live label hides it while the transition is fresh.
    var transitional = computeToggledState(state)
    transitional["transition"] = wasRunning ? "pausing" : "resuming"
    transitional["transitionAt"] = Date().timeIntervalSince1970 * 1000
    if let nextData = try? JSONSerialization.data(withJSONObject: transitional),
       let nextJSON = String(data: nextData, encoding: .utf8) {
        defaults.set(nextJSON, forKey: activityStateKey)
        defaults.set(transitional["isRunning"] as? Bool ?? false, forKey: lastToggleResultRunningKey)
        reloadHomeWidget()
    }
    return state
}

private func revertOptimisticToggle(_ original: [String: Any]?) {
    guard let original, let defaults = UserDefaults(suiteName: appGroupID),
          let data = try? JSONSerialization.data(withJSONObject: original),
          let json = String(data: data, encoding: .utf8) else { return }
    defaults.set(json, forKey: activityStateKey)
    defaults.set(original["isRunning"] as? Bool ?? false, forKey: lastToggleResultRunningKey)
    reloadHomeWidget()
}

// Optimistically clear the activity snapshot so the home widget immediately
// shows the stopped (empty "Start a session") state before the round-trip
// confirms. Returns the original snapshot so a failed stop can restore it.
private func applyOptimisticStop() -> [String: Any]? {
    guard let defaults = UserDefaults(suiteName: appGroupID) else { return nil }
    var original: [String: Any]?
    if let json = defaults.string(forKey: activityStateKey),
       let data = json.data(using: .utf8),
       let state = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        original = state
    }
    defaults.set(false, forKey: lastToggleResultRunningKey)
    defaults.removeObject(forKey: activityStateKey)
    reloadHomeWidget()
    return original
}

private func revertOptimisticStop(_ original: [String: Any]?) {
    guard let original, let defaults = UserDefaults(suiteName: appGroupID),
          let data = try? JSONSerialization.data(withJSONObject: original),
          let json = String(data: data, encoding: .utf8) else { return }
    defaults.set(json, forKey: activityStateKey)
    defaults.set(original["isRunning"] as? Bool ?? false, forKey: lastToggleResultRunningKey)
    reloadHomeWidget()
}

// Optimistically show a running work session so the widget flips to a countdown
// the instant Start is tapped. The duration is a placeholder (25:00) — the
// server's authoritative ends_at arrives moments later via the silent
// home-widget refresh push and corrects it. Keeps the last-known accent.
private func applyOptimisticStart() {
    guard let defaults = UserDefaults(suiteName: appGroupID) else { return }
    let nowMs = Date().timeIntervalSince1970 * 1000
    var state: [String: Any] = [
        "endsAtEpochMs": nowMs + 1500 * 1000,
        "mode": "work",
        "label": "Focus",
        "isSynced": false,
        "isRunning": true
    ]
    if let json = defaults.string(forKey: activityStateKey),
       let data = json.data(using: .utf8),
       let prev = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
       let accent = prev["accentColorHex"] {
        state["accentColorHex"] = accent
    }
    if let data = try? JSONSerialization.data(withJSONObject: state),
       let json = String(data: data, encoding: .utf8) {
        defaults.set(json, forKey: activityStateKey)
        defaults.set(true, forKey: lastToggleResultRunningKey)
        reloadHomeWidget()
    }
}

// Start never reached the server → snap the widget back to idle.
private func revertOptimisticStart() {
    guard let defaults = UserDefaults(suiteName: appGroupID) else { return }
    defaults.set(false, forKey: lastToggleResultRunningKey)
    defaults.removeObject(forKey: activityStateKey)
    reloadHomeWidget()
}

/// POSTs to `<supabaseUrl>/functions/v1/widget-start`, authenticated by the
/// per-user widget secret. Starts a personal work timer server-side; the
/// website updates via realtime, the Live Activity appears via push-to-start,
/// and the silent refresh push corrects this widget's optimistic time.
@available(iOS 17.0, *)
private func dispatchWidgetStart() async -> Bool {
    guard let defaults = UserDefaults(suiteName: appGroupID) else { return false }
    guard
        let userId = defaults.string(forKey: userIdKey), !userId.isEmpty,
        let deviceId = defaults.string(forKey: deviceIdKey), !deviceId.isEmpty,
        let secret = defaults.string(forKey: widgetSecretKey), !secret.isEmpty,
        let urlBase = defaults.string(forKey: supabaseUrlKey), !urlBase.isEmpty,
        let anonKey = defaults.string(forKey: supabaseAnonKeyKey), !anonKey.isEmpty,
        let url = URL(string: "\(urlBase.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/functions/v1/widget-start")
    else {
        log.notice("widget-start: missing App Group config")
        return false
    }
    var request = URLRequest(url: url, timeoutInterval: 8)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(anonKey, forHTTPHeaderField: "apikey")
    request.setValue("Bearer \(anonKey)", forHTTPHeaderField: "Authorization")
    let payload: [String: Any] = ["user_id": userId, "device_id": deviceId, "secret": secret]
    do { request.httpBody = try JSONSerialization.data(withJSONObject: payload) }
    catch { return false }
    do {
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { return false }
        if (200..<300).contains(http.statusCode) { return true }
        log.error("widget-start: HTTP \(http.statusCode)")
        return false
    } catch {
        log.error("widget-start: network failure: \(String(describing: error))")
        return false
    }
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
private func dispatchActivityAction(_ action: ActivityAction, currentState: [String: Any]? = nil) async -> DispatchResult {
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
    // Forward the host's last-known content state so the server toggles from
    // the right state. Prefer the caller-supplied ORIGINAL state (so an
    // optimistic local toggle doesn't make the server flip the wrong way);
    // fall back to the mirrored App Group state.
    if let currentState {
        body["current_state"] = currentState
    } else if let stateJSON = defaults.string(forKey: activityStateKey),
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

// MARK: - Shared network + reconcile
//
// The optimistic App Group write has already happened by the time these
// run; here we do the authoritative server round-trip and reconcile the
// local snapshot to the server's truth (or revert the optimistic change if
// the round-trip ultimately failed).

@available(iOS 17.0, *)
private func dispatchToggleAndReconcile(original: [String: Any]?) async {
    let result = await dispatchActivityAction(.toggle, currentState: original)
    switch result {
    case .succeeded(let newState), .apnsFailed(let newState):
        let nowRunning = newState["isRunning"] as? Bool ?? false
        if !nowRunning { cancelScheduledAlarm() }
        // dispatchActivityAction already mirrored the server state into the
        // App Group; repaint so the widget settles on the authoritative value.
        reloadHomeWidget()
        log.debug("toggle reconciled nowRunning=\(nowRunning)")
    case .failed:
        // The round-trip never reached the server — snap the optimistic flip
        // back to the pre-tap state so the widget doesn't lie.
        revertOptimisticToggle(original)
        log.notice("toggle failed — reverted optimistic flip")
    }
}

@available(iOS 17.0, *)
private func dispatchStopAndReconcile(restoreOnFailure original: [String: Any]?) async {
    let result = await dispatchActivityAction(.stop)
    switch result {
    case .succeeded, .apnsFailed:
        cancelScheduledAlarm()
        reloadHomeWidget()
        log.debug("stop reconciled")
    case .failed:
        revertOptimisticStop(original)
        log.notice("stop failed — restored session")
    }
}

// MARK: - Live Activity buttons (lock screen / Dynamic Island)
//
// MUST be LiveActivityIntent so they run in-process for the Live Activity
// without launching the host app. These AWAIT the round-trip: the
// lock-screen UI is driven by the edge function's APNs push, so there's no
// faster local path to wait for anyway.

@available(iOS 17.0, *)
struct ToggleTimerIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Toggle pomodoro timer"
    static let description = IntentDescription("Pauses or resumes the running pomodoro timer.")
    static let openAppWhenRun: Bool = false
    static let isDiscoverable: Bool = false

    func perform() async throws -> some IntentResult {
        log.debug("ToggleTimerIntent fired")
        let original = applyTransitionToggle()
        UserDefaults(suiteName: appGroupID)?.set(true, forKey: pendingToggleKey)
        await dispatchToggleAndReconcile(original: original)
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
        log.debug("StopTimerIntent fired")
        let original = applyOptimisticStop()
        UserDefaults(suiteName: appGroupID)?.set(true, forKey: pendingStopKey)
        await dispatchStopAndReconcile(restoreOnFailure: original)
        return .result()
    }
}

// MARK: - Home Screen widget buttons
//
// Deliberately PLAIN AppIntents, not LiveActivityIntent (a home-widget
// button running a LiveActivityIntent gets tagged SessionStartingAction,
// which makes chronod freeze the widget's reloads for a fixed ~3.8s settle).
//
// They also DO NOT await the network: the optimistic App Group write has
// flipped the snapshot synchronously, so `perform()` returns immediately and
// the system repaints the widget from the flipped local state without the
// (cold-on-first-tap) round-trip on the critical path — instant response.
// The round-trip runs detached and reconciles when it lands; the pending
// flag is set synchronously so the app still converges on next open even if
// the detached request is cut short by the extension suspending.

@available(iOS 17.0, *)
struct HomeToggleTimerIntent: AppIntent {
    static let title: LocalizedStringResource = "Toggle pomodoro timer"
    static let description = IntentDescription("Pauses or resumes the running pomodoro timer.")
    static let openAppWhenRun: Bool = false
    static let isDiscoverable: Bool = false

    func perform() async throws -> some IntentResult {
        log.debug("HomeToggleTimerIntent fired")
        let original = applyTransitionToggle()
        UserDefaults(suiteName: appGroupID)?.set(true, forKey: pendingToggleKey)
        Task.detached(priority: .userInitiated) {
            await dispatchToggleAndReconcile(original: original)
        }
        return .result()
    }
}

@available(iOS 17.0, *)
struct HomeStopTimerIntent: AppIntent {
    static let title: LocalizedStringResource = "Stop pomodoro timer"
    static let description = IntentDescription("Ends the current pomodoro phase and resets the timer.")
    static let openAppWhenRun: Bool = false
    static let isDiscoverable: Bool = false

    func perform() async throws -> some IntentResult {
        log.debug("HomeStopTimerIntent fired")
        let original = applyOptimisticStop()
        UserDefaults(suiteName: appGroupID)?.set(true, forKey: pendingStopKey)
        Task.detached(priority: .userInitiated) {
            await dispatchStopAndReconcile(restoreOnFailure: original)
        }
        return .result()
    }
}

// Start a personal timer straight from the home widget when none is running —
// no app launch. Plain AppIntent (not LiveActivityIntent): the Live Activity is
// created server-side via push-to-start, so this just writes the DB through
// widget-start. Optimistic local flip first for instant feedback.
@available(iOS 17.0, *)
struct HomeStartTimerIntent: AppIntent {
    static let title: LocalizedStringResource = "Start pomodoro timer"
    static let description = IntentDescription("Starts a focus session.")
    static let openAppWhenRun: Bool = false
    static let isDiscoverable: Bool = false

    func perform() async throws -> some IntentResult {
        log.debug("HomeStartTimerIntent fired")
        applyOptimisticStart()
        Task.detached(priority: .userInitiated) {
            let ok = await dispatchWidgetStart()
            if !ok { revertOptimisticStart() }
        }
        return .result()
    }
}
