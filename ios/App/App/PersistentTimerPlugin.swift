import Foundation
import Capacitor
import CryptoKit
import UIKit
import WidgetKit
import UserNotifications
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
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin, NotificationHandlerProtocol {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "consumePendingToggle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDeviceToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getWidgetRegistration", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestNotificationPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getNotificationPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPendingNotificationURL", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addListener", returnType: CAPPluginReturnCallback),
        CAPPluginMethod(name: "removeAllListeners", returnType: CAPPluginReturnPromise)
    ]

    /// Latest ActivityKit push-to-start token (hex). Lets the server CREATE a
    /// Live Activity remotely (iOS 17.2+) when a timer starts on another
    /// surface. Captured by observePushToStartToken().
    static var pushToStartTokenHex: String?

    /// APNs environment for this build. Sandbox in DEBUG, production otherwise
    /// — both the per-activity and per-device token registrations use it so
    /// the server hits the right APNs host.
    static var apnsEnvironment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    /// Stable per-vendor device id used to key the device_push_tokens row, so
    /// re-registration (token rotation) updates the same row instead of piling
    /// up dead tokens.
    static var deviceIdentifier: String {
        UIDevice.current.identifierForVendor?.uuidString ?? ""
    }

    /// Tracks the AsyncSequence subscription to `activity.pushTokenUpdates`.
    /// Cancelled on stop() and replaced each time start() runs so we never
    /// duplicate emissions if the activity is replaced.
    private var pushTokenTask: Task<Void, Never>?

    /// Subscriptions to the push-to-start token stream and to new-activity
    /// updates (so a server-push-to-started activity gets its push token
    /// registered for subsequent updates/end). Started once in load().
    private var pushToStartTask: Task<Void, Never>?
    private var activityUpdatesTask: Task<Void, Never>?

    @available(iOS 16.1, *)
    private func resolveWithActivityId(_ call: CAPPluginCall, activity: Activity<PomodoroActivityAttributes>) {
        call.resolve(["activityId": activity.id])
    }

    public override func load() {
        super.load()
        // Pre-warm the widget extension when the app backgrounds. Reloading
        // the timeline launches PomodoroWidgetExtension and loads its binary
        // — which also contains the tap intents — so the first widget button
        // tap right after the user leaves the app doesn't pay the extension's
        // cold-launch cost before it can respond. (Has no effect once the OS
        // has reaped the extension after a long idle, but covers the common
        // "just left the app, tapped the widget" path.)
        NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { _ in
            WidgetCenter.shared.reloadTimelines(ofKind: "MangodoroHomeWidget")
        }

        // Forward the APNs device token (captured in AppDelegate) to JS so it
        // can register the device for silent home-widget refresh pushes.
        NotificationCenter.default.addObserver(
            forName: .mangodoroDeviceTokenReceived,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let token = note.userInfo?["token"] as? String, !token.isEmpty else { return }
            self?.notifyListeners("deviceTokenReceived", data: [
                "token": token,
                "apnsEnv": Self.apnsEnvironment,
                "deviceId": Self.deviceIdentifier
            ])
        }

        // Register as Capacitor's REMOTE-push handler so our ALERT pushes
        // (native-push edge function) present in the foreground and forward taps
        // to JS for deep-linking. Capacitor keeps the UNUserNotificationCenter
        // delegate and routes remote pushes here — the LocalNotifications plugin
        // keeps handling local pomodoro notifications untouched (no delegate
        // fight). See willPresent/didReceive below.
        bridge?.notificationRouter.pushNotificationHandler = self

        // Watch for activities the server push-to-starts (created without a
        // local start() call) so we register their push token for later
        // updates/end. iOS 17.2+ also yields a push-to-start token we forward
        // to JS for registration.
        if #available(iOS 16.1, *) { observeActivityUpdates() }
        if #available(iOS 17.2, *) { observePushToStartToken() }
    }

    @available(iOS 17.2, *)
    private func observePushToStartToken() {
        pushToStartTask?.cancel()
        pushToStartTask = Task { [weak self] in
            for await tokenData in Activity<PomodoroActivityAttributes>.pushToStartTokenUpdates {
                let hex = tokenData.map { String(format: "%02x", $0) }.joined()
                Self.pushToStartTokenHex = hex
                DispatchQueue.main.async { [weak self] in
                    self?.notifyListeners("pushToStartTokenReceived", data: [
                        "ptsToken": hex,
                        "apnsEnv": Self.apnsEnvironment,
                        "deviceId": Self.deviceIdentifier
                    ])
                }
            }
        }
    }

    @available(iOS 16.1, *)
    private func observeActivityUpdates() {
        activityUpdatesTask?.cancel()
        activityUpdatesTask = Task { [weak self] in
            for await activity in Activity<PomodoroActivityAttributes>.activityUpdates {
                await MainActor.run { self?.observePushToken(for: activity) }
            }
        }
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
        let breakColorHex = call.getString("breakColorHex")
        let phaseDurationSeconds = call.getDouble("phaseDurationSeconds")
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
            accentColorHex: accentColorHex,
            breakColorHex: breakColorHex,
            phaseDurationSeconds: phaseDurationSeconds
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
                    self.resolveWithActivityId(call, activity: existing)
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
            resolveWithActivityId(call, activity: activity)
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
        if let breakColorHex = call.getString("breakColorHex") {
            state.breakColorHex = breakColorHex
        }
        if let phaseDurationSeconds = call.getDouble("phaseDurationSeconds") {
            state.phaseDurationSeconds = phaseDurationSeconds
        }
        Self.mirrorContentState(state)
        Task {
            if #available(iOS 16.2, *) {
                await existing.update(ActivityContent(state: state, staleDate: nil))
            } else {
                await existing.update(using: state)
            }
            await MainActor.run { self.resolveWithActivityId(call, activity: existing) }
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
                let contentState: PomodoroActivityAttributes.State
                if #available(iOS 16.2, *) {
                    contentState = activity.content.state
                } else {
                    contentState = activity.contentState
                }
                var payload: [String: Any] = [
                    "activityId": activityId,
                    "pushToken": tokenHex,
                    "secretHash": secretHash,
                    "apnsEnv": apnsEnv,
                    "state": Self.stateDictionary(from: contentState)
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

    @available(iOS 16.1, *)
    private static func stateDictionary(from state: PomodoroActivityAttributes.State) -> [String: Any] {
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
        if let breakColorHex = state.breakColorHex {
            payload["breakColorHex"] = breakColorHex
        }
        if let phaseDurationSeconds = state.phaseDurationSeconds {
            payload["phaseDurationSeconds"] = phaseDurationSeconds
        }
        return payload
    }

    /// Mirrors the activity content state to the App Group so the widget
    /// extension can forward it to the activity-action edge function. The
    /// server uses this as the source of truth when computing the next
    /// state — avoids a "first tap does nothing" bug when the user
    /// pauses/resumes from inside the app (which the server otherwise
    /// wouldn't know about until next phase boundary).
    @available(iOS 16.1, *)
    private static func mirrorContentState(_ state: PomodoroActivityAttributes.State) {
        guard let data = try? JSONSerialization.data(withJSONObject: stateDictionary(from: state)),
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

    /// Returns the cached APNs device token (set by AppDelegate on
    /// registration). JS uploads it via the device-register edge function.
    @objc func getDeviceToken(_ call: CAPPluginCall) {
        call.resolve([
            "token": AppDelegate.deviceTokenHex ?? "",
            "apnsEnv": Self.apnsEnvironment,
            "deviceId": Self.deviceIdentifier
        ])
    }

    /// Stores the current user id + device id in the App Group and ensures a
    /// per-user "widget action" secret exists (minted on first use / when the
    /// user changes). Returns the data JS needs to register with device-register
    /// — the secret HASH (never the raw secret) plus any cached push tokens.
    /// The home-widget Start button reads the raw secret from the App Group to
    /// authenticate its call to widget-start.
    @objc func getWidgetRegistration(_ call: CAPPluginCall) {
        let defaults = UserDefaults(suiteName: AppGroup.identifier)
        let deviceId = Self.deviceIdentifier
        defaults?.set(deviceId, forKey: AppGroup.deviceIdKey)

        if let userId = call.getString("userId"), !userId.isEmpty {
            // A different user on this device → invalidate the old secret.
            if defaults?.string(forKey: AppGroup.userIdKey) != userId {
                defaults?.removeObject(forKey: AppGroup.widgetSecretKey)
            }
            defaults?.set(userId, forKey: AppGroup.userIdKey)
        }

        var secret = defaults?.string(forKey: AppGroup.widgetSecretKey) ?? ""
        if secret.isEmpty {
            secret = Self.generateSecretHex()
            defaults?.set(secret, forKey: AppGroup.widgetSecretKey)
        }

        call.resolve([
            "deviceId": deviceId,
            "pushToken": AppDelegate.deviceTokenHex ?? "",
            "ptsToken": Self.pushToStartTokenHex ?? "",
            "secretHash": Self.sha256Hex(secret),
            "apnsEnv": Self.apnsEnvironment
        ])
    }

    /// Prompt for notification authorization (alert + sound + badge) so ALERT
    /// pushes from the native-push edge function actually DISPLAY. Also (re)runs
    /// remote registration so the device token exists. Resolves { granted }.
    /// Called from the Settings "Push when the app is closed" toggle.
    @objc func requestNotificationPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            if granted {
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
            call.resolve(["granted": granted])
        }
    }

    /// Read the current notification authorization so the toggle can reflect it.
    /// Resolves { status: "granted" | "denied" | "prompt" }.
    @objc func getNotificationPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let status: String
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                status = "granted"
            case .denied:
                status = "denied"
            case .notDetermined:
                status = "prompt"
            @unknown default:
                status = "prompt"
            }
            call.resolve(["status": status])
        }
    }

    /// Drain a route from a notification tapped before JS attached its listener
    /// (cold launch from the notification). Resolves { url } (empty if none) and
    /// clears it so it fires once.
    @objc func getPendingNotificationURL(_ call: CAPPluginCall) {
        let url = AppDelegate.pendingTappedURL ?? ""
        AppDelegate.pendingTappedURL = nil
        call.resolve(["url": url])
    }

    // MARK: - NotificationHandlerProtocol (remote ALERT pushes)
    // Only REMOTE pushes reach these — Capacitor's NotificationRouter checks the
    // trigger type and routes local notifications to the LocalNotifications
    // plugin instead. Silent background pushes (content-available, our widget
    // refresh) don't invoke willPresent, so anything here is a user-facing alert.

    /// Show our alert pushes as a banner + sound even while the app is open.
    public func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        if #available(iOS 14.0, *) {
            return [.banner, .sound, .list]
        }
        return [.alert, .sound]
    }

    /// User tapped an alert. Forward its `url` to JS to deep-link, and stash it
    /// for getPendingNotificationURL() in case JS isn't listening yet (cold
    /// launch straight from the notification).
    public func didReceive(response: UNNotificationResponse) {
        let userInfo = response.notification.request.content.userInfo
        guard let url = userInfo["url"] as? String, !url.isEmpty else { return }
        AppDelegate.pendingTappedURL = url
        DispatchQueue.main.async { [weak self] in
            self?.notifyListeners("notificationTapped", data: ["url": url])
        }
    }

    /// Applies a state snapshot pushed from the server (silent background
    /// push) into the App Group so the home-screen widget reflects a change
    /// made on another device, then reloads the widget timeline. Merges onto
    /// the last-known state so fields the push omits (e.g. accent) persist.
    /// Called from AppDelegate's didReceiveRemoteNotification handler.
    static func applyRemoteWidgetState(_ info: [AnyHashable: Any]) {
        let defaults = UserDefaults(suiteName: AppGroup.identifier)

        // A reset / stop on another device clears the widget entirely.
        if (info["ended"] as? Bool) == true {
            defaults?.removeObject(forKey: AppGroup.activityStateKey)
            defaults?.set(false, forKey: AppGroup.lastToggleResultRunningKey)
            reloadHomeWidget()
            return
        }

        var state: [String: Any] = {
            if let json = defaults?.string(forKey: AppGroup.activityStateKey),
               let data = json.data(using: .utf8),
               let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                return obj
            }
            return [:]
        }()

        let isRunning = (info["isRunning"] as? Bool) ?? false
        state["isRunning"] = isRunning
        if let endsAtMs = (info["endsAtMs"] as? NSNumber)?.doubleValue {
            state["endsAtEpochMs"] = endsAtMs
        }
        if isRunning {
            state.removeValue(forKey: "pausedSecondsLeft")
        } else if let paused = (info["pausedSecondsLeft"] as? NSNumber)?.intValue {
            state["pausedSecondsLeft"] = paused
        }
        if let mode = info["mode"] as? String {
            state["mode"] = mode
            state["label"] = labelForMode(mode)
        }
        if let isSynced = info["isSynced"] as? Bool {
            state["isSynced"] = isSynced
        }

        defaults?.set(isRunning, forKey: AppGroup.lastToggleResultRunningKey)
        if let data = try? JSONSerialization.data(withJSONObject: state),
           let json = String(data: data, encoding: .utf8) {
            defaults?.set(json, forKey: AppGroup.activityStateKey)
        }
        reloadHomeWidget()
    }

    private static func labelForMode(_ mode: String) -> String {
        switch mode {
        case "work": return "Focus"
        case "shortBreak": return "Short break"
        case "longBreak": return "Long break"
        default: return "Pomodoro"
        }
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

    // Per-user "widget action" credential + identity, so the home-widget Start
    // button can start a personal timer via the widget-start edge function
    // without the app open (there's no user JWT natively). The raw secret lives
    // here; its SHA256 hash is registered against device_push_tokens.
    static let userIdKey = "mangodoro.userId"
    static let deviceIdKey = "mangodoro.deviceId"
    static let widgetSecretKey = "mangodoro.widgetUserSecret"
}
