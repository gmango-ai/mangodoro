import Foundation
import Capacitor
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Bridges the JS `registerPlugin('LiveActivity')` calls to ActivityKit.
///
/// On iOS 16.1+ we manage a single `Activity<PomodoroActivityAttributes>`
/// instance keyed by phase. start() either spawns a fresh activity or
/// updates the existing one. The widget renders the countdown via
/// `Text(timerInterval:)` so the OS handles per-second ticking — JS
/// only calls in on phase boundaries.
///
/// The JS name "LiveActivity" → Swift class mapping is wired in
/// LiveActivityPlugin.m via the CAP_PLUGIN macro.
@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    public override func load() {
        super.load()
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

        guard endsAtMs > Date().timeIntervalSince1970 * 1000 else {
            stopAll()
            call.resolve()
            return
        }

        let state = PomodoroActivityAttributes.State(
            endsAtEpochMs: endsAtMs,
            mode: mode,
            label: label,
            isSynced: isSynced
        )

        // If an activity is already live, update it instead of stacking.
        if let existing = Activity<PomodoroActivityAttributes>.activities.first {
            Task {
                if #available(iOS 16.2, *) {
                    await existing.update(ActivityContent(state: state, staleDate: nil))
                } else {
                    await existing.update(using: state)
                }
                await MainActor.run { call.resolve() }
            }
            return
        }

        let attributes = PomodoroActivityAttributes()
        do {
            if #available(iOS 16.2, *) {
                _ = try Activity<PomodoroActivityAttributes>.request(
                    attributes: attributes,
                    content: ActivityContent(state: state, staleDate: nil),
                    pushType: nil
                )
            } else {
                _ = try Activity<PomodoroActivityAttributes>.request(
                    attributes: attributes,
                    contentState: state,
                    pushType: nil
                )
            }
            call.resolve()
        } catch {
            call.reject("Failed to start Live Activity: \(error.localizedDescription)")
        }
        #else
        call.resolve(["supported": false])
        #endif
    }

    @objc func update(_ call: CAPPluginCall) {
        // Identical contract to start() — ActivityKit treats the two the
        // same as long as something is already live.
        start(call)
    }

    @objc func stop(_ call: CAPPluginCall) {
        stopAll()
        call.resolve()
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
