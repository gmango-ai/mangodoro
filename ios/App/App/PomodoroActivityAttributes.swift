import Foundation
#if canImport(ActivityKit)
import ActivityKit

// Shared between the main app target (where the plugin starts/updates
// activities) and the widget extension (where the UI is rendered). The
// Xcode project must add this file to BOTH targets — see
// ios/LIVE_ACTIVITY_SETUP.md.
@available(iOS 16.1, *)
public struct PomodoroActivityAttributes: ActivityAttributes {
    public typealias ContentState = State

    public struct State: Codable, Hashable {
        // When `isRunning` is true the widget renders a live countdown
        // to this timestamp via Text(timerInterval:) so the OS owns
        // ticking. When paused the field is ignored and the UI shows
        // `pausedSecondsLeft` as a frozen MM:SS instead.
        public var endsAtEpochMs: Double
        public var pausedSecondsLeft: Int?
        public var mode: String          // "work" | "shortBreak" | "longBreak"
        public var label: String         // "Focus" | "Short break" | "Long break"
        public var isSynced: Bool
        public var isRunning: Bool
        // Hex string like "#0d9488". Optional; widget falls back to the
        // system tint if absent. Reflects the user's accent setting from
        // the main app, passed through on every start/update.
        public var accentColorHex: String?

        public init(
            endsAtEpochMs: Double,
            pausedSecondsLeft: Int? = nil,
            mode: String,
            label: String,
            isSynced: Bool,
            isRunning: Bool,
            accentColorHex: String? = nil
        ) {
            self.endsAtEpochMs = endsAtEpochMs
            self.pausedSecondsLeft = pausedSecondsLeft
            self.mode = mode
            self.label = label
            self.isSynced = isSynced
            self.isRunning = isRunning
            self.accentColorHex = accentColorHex
        }
    }

    public var appName: String

    public init(appName: String = "Mangodoro") {
        self.appName = appName
    }
}
#endif
