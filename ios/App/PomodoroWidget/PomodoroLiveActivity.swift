import ActivityKit
import WidgetKit
import SwiftUI

/// Lockscreen + Dynamic Island UI for the pomodoro Live Activity.
///
/// Uses `Text(timerInterval:countsDown:)` so the countdown digits
/// auto-update on the lockscreen without any push notifications — the
/// OS owns ticking. JS just sends the end timestamp.
@available(iOS 16.1, *)
struct PomodoroLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PomodoroActivityAttributes.self) { context in
            PomodoroLockScreenView(state: context.state)
                .activityBackgroundTint(Color.black.opacity(0.7))
                .activitySystemActionForegroundColor(Color.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.state.label, systemImage: phaseIcon(context.state.mode))
                        .font(.caption)
                        .foregroundColor(.white)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    PomodoroCountdownText(endsAtEpochMs: context.state.endsAtEpochMs)
                        .font(.title2.monospacedDigit())
                        .foregroundColor(.white)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if context.state.isSynced {
                        Text("Sync session")
                            .font(.caption2)
                            .foregroundColor(.white.opacity(0.7))
                    }
                }
            } compactLeading: {
                Image(systemName: phaseIcon(context.state.mode))
                    .foregroundColor(.white)
            } compactTrailing: {
                PomodoroCountdownText(endsAtEpochMs: context.state.endsAtEpochMs)
                    .font(.caption.monospacedDigit())
                    .foregroundColor(.white)
            } minimal: {
                Image(systemName: phaseIcon(context.state.mode))
                    .foregroundColor(.white)
            }
        }
    }

    private func phaseIcon(_ mode: String) -> String {
        switch mode {
        case "work": return "timer"
        case "shortBreak", "longBreak": return "cup.and.saucer.fill"
        default: return "timer"
        }
    }
}

@available(iOS 16.1, *)
private struct PomodoroLockScreenView: View {
    let state: PomodoroActivityAttributes.State

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: phaseIcon)
                .font(.title2)
                .foregroundColor(.white)
            VStack(alignment: .leading, spacing: 2) {
                Text(state.label)
                    .font(.headline)
                    .foregroundColor(.white)
                if state.isSynced {
                    Text("Sync session")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.7))
                }
            }
            Spacer()
            PomodoroCountdownText(endsAtEpochMs: state.endsAtEpochMs)
                .font(.system(size: 34, weight: .semibold, design: .rounded).monospacedDigit())
                .foregroundColor(.white)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
    }

    private var phaseIcon: String {
        switch state.mode {
        case "work": return "timer"
        case "shortBreak", "longBreak": return "cup.and.saucer.fill"
        default: return "timer"
        }
    }
}

@available(iOS 16.1, *)
private struct PomodoroCountdownText: View {
    let endsAtEpochMs: Double

    var body: some View {
        let endsAt = Date(timeIntervalSince1970: endsAtEpochMs / 1000.0)
        if endsAt > Date() {
            // OS-driven countdown — the displayed value ticks every second
            // without us pushing updates.
            Text(timerInterval: Date()...endsAt, countsDown: true)
        } else {
            Text("0:00")
        }
    }
}
