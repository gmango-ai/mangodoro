import Foundation
import Capacitor
import CryptoKit
import WidgetKit
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Bridges the JS `registerPlugin('LiveActivity')` calls to ActivityKit.
///
/// On iOS 16.1+ we manage a single `Activity<PomodoroActivityAttributes>`
/// instance. start() spawns or updates the activity to a running state;
/// pause() flips it to a frozen state without ending the activity;
/// resume() flips it back; stop() is the only call that actually ends.
/// The widget renders the countdown via Text(timerInterval:) so the OS
/// handles per-second ticking — JS only calls in on phase boundaries.
///
/// Pure-Swift CAPBridgedPlugin registration. Auto-discovery alone isn't
/// enough for in-app plugins in Capacitor 8; MangodoroBridgeViewController
/// explicitly registers an instance of this class on capacitorDidLoad.
@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumePendingToggle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addListener", returnType: CAPPluginReturnCallback),
        CAPPluginMethod(name: "removeAllListeners", returnType: CAPPluginReturnPromise)
    ]

    /// Tracks the AsyncSequence subscription to `activity.pushTokenUpdates`.
    /// Cancelled on stop() and replaced each time start() runs so we never
    /// duplicate emissions if the activity is replaced.
    private var pushTokenTask: Task<Void, Never>?

    public override func load() {
        super.load()
    }

    /// Persist the timer's running state to the App Group so the widget
    /// extension's LiveActivityIntent can read it even when the freshly
    /// launched extension process can't see Activity<...>.activities
    /// (which is empty across the host/extension boundary on a cold
    /// intent dispatch). Without this, ToggleTimerIntent has no way to
    /// know whether to pause or resume, and `lastToggleResultRunningKey`
    /// stays stuck at `false` so the JS-side comparison never fires the
    /// resume callback.
    private static func writeRunningState(_ isRunning: Bool) {
        UserDefaults(suiteName: AppGroup.identifier)?
            .set(isRunning, forKey: AppGroup.lastToggleResultRunningKey)
    }

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else {
            call.resolve(["supported": false])
            return
        }
        #if canImport(ActivityKit)
        let endsAtMs = call.getDouble("endsAtMs") ?? 0
        let mode = call.getString("mode") ?? "work"
        let label = call.getString("label") ?? "Pomodoro"
        let isSynced = call.getBool("isSynced") ?? false
        let accentColorHex = call.getString("accentColorHex")
        let isRunning = call.getBool("isRunning") ?? true
        let pausedSecondsLeft = call.getInt("pausedSecondsLeft")

        // Mirror the Supabase client config to the App Group so the
        // widget extension can hit our activity-action edge function
        // without needing to ship its own copy of the URL/anon key.
        // Anon key is a public client credential — safe to mirror.
        Self.mirrorSupabaseConfig(
            url: call.getString("supabaseUrl"),
            anonKey: call.getString("supabaseAnonKey")
        )

        // A running call with no future end timestamp is meaningless —
        // stop instead of trying to start an already-expired activity.
        if isRunning && endsAtMs <= Date().timeIntervalSince1970 * 1000 {
            stopAll()
            call.resolve()
            return
        }

        Self.writeRunningState(isRunning)

        let state = PomodoroActivityAttributes.State(
            endsAtEpochMs: endsAtMs,
            pausedSecondsLeft: isRunning ? nil : pausedSecondsLeft,
            mode: mode,
            label: label,
            isSynced: isSynced,
            isRunning: isRunning,
            accentColorHex: accentColorHex
        )
        Self.mirrorContentState(state)

        if let existing = Activity<PomodoroActivityAttributes>.activities.first {
            Task {
                if #available(iOS 16.2, *) {
                    await existing.update(ActivityContent(state: state, staleDate: nil))
                } else {
                    await existing.update(using: state)
                }
                await MainActor.run {
                    self.observePushToken(for: existing)
                    call.resolve()
                }
            }
            return
        }

        let attributes = PomodoroActivityAttributes()
        do {
            let activity: Activity<PomodoroActivityAttributes>
            if #available(iOS 16.2, *) {
                activity = try Activity<PomodoroActivityAttributes>.request(
                    attributes: attributes,
                    content: ActivityContent(state: state, staleDate: nil),
                    pushType: .token
                )
            } else {
                activity = try Activity<PomodoroActivityAttributes>.request(
                    attributes: attributes,
                    contentState: state,
                    pushType: .token
                )
            }
            observePushToken(for: activity)
            call.resolve()
        } catch {
            call.reject("Failed to start Live Activity: \(error.localizedDescription)")
        }
        #else
        call.resolve(["supported": false])
        #endif
    }

    @objc func update(_ call: CAPPluginCall) {
        start(call)
    }

    @objc func pause(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { call.resolve(); return }
        Self.writeRunningState(false)
        #if canImport(ActivityKit)
        guard let existing = Activity<PomodoroActivityAttributes>.activities.first else {
            call.resolve()
            return
        }
        var state: PomodoroActivityAttributes.State
        if #available(iOS 16.2, *) {
            state = existing.content.state
        } else {
            state = existing.contentState
        }
        let pausedSecondsLeft = call.getInt("pausedSecondsLeft")
            ?? Int(max(0, (state.endsAtEpochMs - Date().timeIntervalSince1970 * 1000) / 1000))
        state.isRunning = false
        state.pausedSecondsLeft = pausedSecondsLeft
        if let accentColorHex = call.getString("accentColorHex") {
            state.accentColorHex = accentColorHex
        }
        Self.mirrorContentState(state)
        Task {
            if #available(iOS 16.2, *) {
                await existing.update(ActivityContent(state: state, staleDate: nil))
            } else {
                await existing.update(using: state)
            }
            await MainActor.run { call.resolve() }
        }
        #else
        call.resolve()
        #endif
    }

    @objc func resume(_ call: CAPPluginCall) {
        // resume() is just start() with isRunning=true; JS computes the
        // fresh endsAtMs from the remaining seconds at the moment of
        // resume so the widget's countdown picks up exactly where it
        // left off.
        start(call)
    }

    @objc func stop(_ call: CAPPluginCall) {
        Self.writeRunningState(false)
        pushTokenTask?.cancel()
        pushTokenTask = nil
        Self.clearActivityCredentials()
        stopAll()
        call.resolve()
    }

    /// Subscribes to `activity.pushTokenUpdates`. The async sequence yields
    /// the current token on subscription if one is already issued, then
    /// yields rotations. Each token gets shipped to JS via the
    /// `pushTokenReceived` listener event along with the SHA256 of the
    /// per-activity secret we just minted; JS forwards both to our
    /// activity-register edge function. We also stash the raw secret +
    /// activity_id in the App Group so the widget extension can pick
    /// them up to authenticate its call to activity-action.
    @available(iOS 16.1, *)
    private func observePushToken(for activity: Activity<PomodoroActivityAttributes>) {
        let activityId = activity.id
        let secret: String
        let defaults = UserDefaults(suiteName: AppGroup.identifier)
        if defaults?.string(forKey: AppGroup.activityIdKey) == activityId,
           let cached = defaults?.string(forKey: AppGroup.activitySecretKey),
           !cached.isEmpty {
            secret = cached
        } else {
            secret = Self.generateSecretHex()
            defaults?.set(secret, forKey: AppGroup.activitySecretKey)
            defaults?.set(activityId, forKey: AppGroup.activityIdKey)
        }
        let secretHash = Self.sha256Hex(secret)

        #if DEBUG
        let apnsEnv = "sandbox"
        #else
        let apnsEnv = "production"
        #endif

        pushTokenTask?.cancel()
        pushTokenTask = Task { [weak self] in
            for await tokenData in activity.pushTokenUpdates {
                let tokenHex = tokenData.map { String(format: "%02x", $0) }.joined()
                let payload: [String: Any] = [
                    "activityId": activityId,
                    "pushToken": tokenHex,
                    "secretHash": secretHash,
                    "apnsEnv": apnsEnv
                ]
                // Hop to the main thread via DispatchQueue rather than
                // MainActor.run — CAPPlugin isn't @MainActor-isolated and
                // Swift 6 rejects capturing `self` across a structured
                // concurrency boundary into a non-isolated closure.
                DispatchQueue.main.async { [weak self] in
                    self?.notifyListeners("pushTokenReceived", data: payload)
                }
            }
        }
    }

    private static func generateSecretHex() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            // Fall back to /dev/urandom via UUID-mixing — still ~128 bits.
            return UUID().uuidString.replacingOccurrences(of: "-", with: "")
                + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    private static func sha256Hex(_ input: String) -> String {
        let digest = SHA256.hash(data: Data(input.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private static func mirrorSupabaseConfig(url: String?, anonKey: String?) {
        let defaults = UserDefaults(suiteName: AppGroup.identifier)
        if let url, !url.isEmpty {
            defaults?.set(url, forKey: AppGroup.supabaseUrlKey)
        }
        if let anonKey, !anonKey.isEmpty {
            defaults?.set(anonKey, forKey: AppGroup.supabaseAnonKeyKey)
        }
    }

    private static func clearActivityCredentials() {
        let defaults = UserDefaults(suiteName: AppGroup.identifier)
        defaults?.removeObject(forKey: AppGroup.activitySecretKey)
        defaults?.removeObject(forKey: AppGroup.activityIdKey)
        defaults?.removeObject(forKey: AppGroup.activityStateKey)
        reloadHomeWidget()
    }

    /// Mirrors the activity content state to the App Group so the widget
    /// extension can forward it to the activity-action edge function. The
    /// server uses this as the source of truth when computing the next
    /// state — avoids a "first tap does nothing" bug when the user
    /// pauses/resumes from inside the app (which the server otherwise
    /// wouldn't know about until next phase boundary).
    @available(iOS 16.1, *)
    private static func mirrorContentState(_ state: PomodoroActivityAttributes.State) {
        var payload: [String: Any] = [
            "endsAtEpochMs": state.endsAtEpochMs,
            "mode": state.mode,
            "label": state.label,
            "isSynced": state.isSynced,
            "isRunning": state.isRunning
        ]
        if let pausedSecondsLeft = state.pausedSecondsLeft {
            payload["pausedSecondsLeft"] = pausedSecondsLeft
        }
        if let accentColorHex = state.accentColorHex {
            payload["accentColorHex"] = accentColorHex
        }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        UserDefaults(suiteName: AppGroup.identifier)?
            .set(json, forKey: AppGroup.activityStateKey)
        reloadHomeWidget()
    }

    /// Asks WidgetKit to re-render the home screen widget. The widget
    /// reads from the same App Group key we just wrote so this catches
    /// the fresh snapshot. No-op when WidgetKit isn't available (we
    /// guarded by import at the top — it's part of the iOS 14+ SDK so
    /// the call site is unconditional, but the runtime ignores it on
    /// unsupported devices).
    private static func reloadHomeWidget() {
        WidgetCenter.shared.reloadTimelines(ofKind: "MangodoroHomeWidget")
    }

    /// Reads the App Group flags written by widget intents (toggle and
    /// stop). JS polls this so a tap on the lockscreen is mirrored back
    /// to Supabase + the scheduled alarm + the visible activity.
    @objc func consumePendingToggle(_ call: CAPPluginCall) {
        let defaults = UserDefaults(suiteName: AppGroup.identifier)
        let pendingToggle = defaults?.bool(forKey: AppGroup.pendingTogglePresentKey) ?? false
        let pendingStop = defaults?.bool(forKey: AppGroup.pendingStopKey) ?? false
        if pendingToggle {
            defaults?.set(false, forKey: AppGroup.pendingTogglePresentKey)
        }
        if pendingStop {
            defaults?.set(false, forKey: AppGroup.pendingStopKey)
        }
        let nowRunning = defaults?.bool(forKey: AppGroup.lastToggleResultRunningKey) ?? false
        call.resolve([
            "pending": pendingToggle,
            "nowRunning": nowRunning,
            "pendingStop": pendingStop
        ])
    }

    private func stopAll() {
        guard #available(iOS 16.1, *) else { return }
        #if canImport(ActivityKit)
        Task {
            for activity in Activity<PomodoroActivityAttributes>.activities {
                if #available(iOS 16.2, *) {
                    await activity.end(nil, dismissalPolicy: .immediate)
                } else {
                    await activity.end(dismissalPolicy: .immediate)
                }
            }
        }
        #endif
    }
}

/// Shared identifiers for the App Group used to coordinate between the
/// widget extension (LiveActivityIntent.perform) and the main app
/// (LiveActivityPlugin.consumePendingToggle). The group must be enabled
/// in Signing & Capabilities for BOTH the App and PomodoroWidget targets
/// — see ios/LIVE_ACTIVITY_SETUP.md.
enum AppGroup {
    static let identifier = "group.com.gmango.mangodoro"
    static let pendingTogglePresentKey = "mangodoro.pendingTimerToggle"
    static let lastToggleResultRunningKey = "mangodoro.lastToggleResultRunning"
    static let pendingStopKey = "mangodoro.pendingTimerStop"

    // Per-Live-Activity credentials the widget extension uses to
    // authenticate calls to the activity-action edge function.
    static let activityIdKey = "mangodoro.currentActivityId"
    static let activitySecretKey = "mangodoro.currentActivitySecret"

    // Public Supabase client config mirrored from the JS layer so the
    // widget can build requests without a separate build step.
    static let supabaseUrlKey = "mangodoro.supabaseUrl"
    static let supabaseAnonKeyKey = "mangodoro.supabaseAnonKey"

    // Latest content state as JSON, written by the host on every
    // start/update/pause. The widget forwards this to the edge function
    // so the server's toggle math uses fresh state even if the host
    // changed it without telling the server.
    static let activityStateKey = "mangodoro.currentActivityState"
}
