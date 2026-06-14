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
        // Wall-clock millisecond at which the current phase ends. The
        // widget converts to a Date and renders via Text(timerInterval:),
        // which the OS itself counts down — no push updates needed for
        // the per-second display.
        public var endsAtEpochMs: Double
        public var mode: String          // "work" | "shortBreak" | "longBreak"
        public var label: String         // "Focus" | "Short break" | "Long break"
        public var isSynced: Bool

        public init(endsAtEpochMs: Double, mode: String, label: String, isSynced: Bool) {
            self.endsAtEpochMs = endsAtEpochMs
            self.mode = mode
            self.label = label
            self.isSynced = isSynced
        }
    }

    // Constant for the duration of the activity. We don't carry anything
    // here because the changing fields all live in ContentState; left as
    // a stub so we can extend without breaking ABI.
    public var appName: String

    public init(appName: String = "Mangodoro") {
        self.appName = appName
    }
}
#endif
