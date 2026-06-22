import ActivityKit
import AppIntents
import WidgetKit
import SwiftUI

/// Lockscreen + Dynamic Island UI for the pomodoro Live Activity — "Airy"
/// design (see AiryWidgetKit.swift for the shared tokens/components).
///
/// Theming:
///   • Lockscreen — no explicit background tint, so iOS renders the platter
///     in its vibrant translucent material (adapts to wallpaper light/dark).
///     Text uses `.primary` / `.secondary`; the only intentional color is the
///     phase accent on the ring, the countdown, and the primary button.
///   • Dynamic Island — the cutout is always dark, so content is white with
///     the accent ring/time carrying the color.
///
/// The hero is the rounded-square `AiryRing` that drains with time left; the
/// numeral keeps ticking via `Text(timerInterval:)`.
///
/// Lock-screen pause/stop buttons require iOS 17+ (LiveActivityIntent).
@available(iOS 16.1, *)
struct PomodoroLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PomodoroActivityAttributes.self) { context in
            PomodoroLockScreenView(state: context.state)
                // No background tint: keep the neutral system platter so the
                // Airy white/dark card reads correctly against any wallpaper
                // and `.primary`/`.secondary` text stays legible.
                .activitySystemActionForegroundColor(accentColor(context.state))
        } dynamicIsland: { context in
            let accent = accentColor(context.state)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 11) {
                        AiryRing(
                            fraction: ringFraction(context.state),
                            accent: accent,
                            track: Color.white.opacity(0.16),
                            size: 40,
                            lineWidth: 5
                        ) {
                            Text("\(minsLeft(context.state))m")
                                .font(.system(size: 12, weight: .semibold).monospacedDigit())
                                .foregroundColor(.white)
                        }
                        VStack(alignment: .leading, spacing: 3) {
                            Text(context.state.label)
                                .font(.subheadline.weight(.semibold))
                                .foregroundColor(.white)
                                .lineLimit(1)
                            statusLabel(for: context.state, onDark: true)
                        }
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    CountdownText(state: context.state)
                        .font(.system(size: 28, weight: .semibold, design: .rounded).monospacedDigit())
                        .foregroundColor(accent)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    // Interactive controls need iOS 17 (LiveActivityIntent).
                    // The availability check must live INSIDE the region's
                    // ViewBuilder — the content builder that assembles the
                    // regions can't take control flow.
                    if #available(iOS 17.0, *) {
                        HStack(spacing: 8) {
                            AiryPrimaryButton(
                                intent: ToggleTimerIntent(),
                                isRunning: context.state.isRunning,
                                accent: accent,
                                height: 40
                            )
                            AirySecondaryButton(
                                intent: StopTimerIntent(),
                                systemName: "stop.fill",
                                bg: Color.white.opacity(0.14),
                                fg: .white,
                                size: 40
                            )
                        }
                        .padding(.top, 4)
                    }
                }
            } compactLeading: {
                Image(systemName: "timer")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(accent)
            } compactTrailing: {
                CountdownText(state: context.state)
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundColor(accent)
                    .frame(maxWidth: 52)
            } minimal: {
                Image(systemName: "timer")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(accent)
            }
            .keylineTint(accent)
        }
    }

    @ViewBuilder
    private func statusLabel(for state: PomodoroActivityAttributes.State, onDark: Bool) -> some View {
        let color: Color = onDark ? .white.opacity(0.7) : .secondary
        if !state.isRunning {
            Text("Paused").font(.caption2).foregroundColor(color)
        } else if state.isSynced {
            Text("Sync session").font(.caption2).foregroundColor(color)
        } else {
            Text("Focus timer").font(.caption2).foregroundColor(color)
        }
    }

    private func accentColor(_ state: PomodoroActivityAttributes.State) -> Color {
        airyPhaseAccent(mode: state.mode, accentHex: state.accentColorHex, breakHex: state.breakColorHex)
    }

    private func ringFraction(_ state: PomodoroActivityAttributes.State) -> Double {
        airyRingFraction(
            isRunning: state.isRunning,
            endsAtEpochMs: state.endsAtEpochMs,
            pausedSecondsLeft: state.pausedSecondsLeft,
            phaseDurationSeconds: state.phaseDurationSeconds,
            mode: state.mode
        )
    }

    private func minsLeft(_ state: PomodoroActivityAttributes.State) -> Int {
        airyMinsLeft(
            isRunning: state.isRunning,
            endsAtEpochMs: state.endsAtEpochMs,
            pausedSecondsLeft: state.pausedSecondsLeft
        )
    }
}

@available(iOS 16.1, *)
private struct PomodoroLockScreenView: View {
    let state: PomodoroActivityAttributes.State

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 14) {
                AiryRing(
                    fraction: fraction,
                    accent: accent,
                    track: Color.primary.opacity(0.12),
                    size: 54,
                    lineWidth: 6
                ) {
                    Text("\(mins)m")
                        .font(.system(size: 13, weight: .semibold).monospacedDigit())
                        .foregroundColor(.primary)
                }
                VStack(alignment: .leading, spacing: 5) {
                    Text(state.label)
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(.primary)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        Circle().fill(accent).frame(width: 6, height: 6)
                        subtitle
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                }
                .layoutPriority(1)
                Spacer(minLength: 8)
                CountdownText(state: state)
                    .font(.system(size: 30, weight: .semibold, design: .rounded).monospacedDigit())
                    .foregroundColor(accent)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    // Cap the width: the running countdown is a Text(timerInterval:)
                    // anchored at epoch 0 (for tick stability), which otherwise
                    // reserves a huge intrinsic width and starves the label.
                    .frame(maxWidth: 96, alignment: .trailing)
            }
            if #available(iOS 17.0, *) {
                HStack(spacing: 9) {
                    AiryPrimaryButton(
                        intent: ToggleTimerIntent(),
                        isRunning: state.isRunning,
                        accent: accent,
                        height: 42
                    )
                    AirySecondaryButton(
                        intent: StopTimerIntent(),
                        systemName: "stop.fill",
                        bg: Color.primary.opacity(0.08),
                        fg: .primary,
                        size: 42
                    )
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    private var accent: Color {
        airyPhaseAccent(mode: state.mode, accentHex: state.accentColorHex, breakHex: state.breakColorHex)
    }

    private var fraction: Double {
        airyRingFraction(
            isRunning: state.isRunning,
            endsAtEpochMs: state.endsAtEpochMs,
            pausedSecondsLeft: state.pausedSecondsLeft,
            phaseDurationSeconds: state.phaseDurationSeconds,
            mode: state.mode
        )
    }

    private var mins: Int {
        airyMinsLeft(
            isRunning: state.isRunning,
            endsAtEpochMs: state.endsAtEpochMs,
            pausedSecondsLeft: state.pausedSecondsLeft
        )
    }

    @ViewBuilder
    private var subtitle: some View {
        if !state.isRunning {
            Text("Paused")
        } else if state.isSynced {
            Text("Sync session")
        } else {
            Text("Focus timer")
        }
    }
}

@available(iOS 16.1, *)
private struct CountdownText: View {
    let state: PomodoroActivityAttributes.State

    // A long-past anchor for the timer interval. SwiftUI's
    // Text(timerInterval:) with countsDown:true displays (end - now)
    // regardless of where the interval starts, so anchoring to epoch 0
    // means every re-render captures the SAME interval and the OS-driven
    // ticker keeps a consistent cadence instead of resetting each time
    // the surrounding view rebuilds.
    private static let intervalStart = Date(timeIntervalSince1970: 0)

    var body: some View {
        Group {
            if state.isRunning {
                let endsAt = Date(timeIntervalSince1970: state.endsAtEpochMs / 1000.0)
                if endsAt > Date() {
                    Text(timerInterval: Self.intervalStart...endsAt, countsDown: true)
                } else {
                    Text("0:00")
                }
            } else {
                Text(formatMMSS(state.pausedSecondsLeft ?? 0))
            }
        }
        // The id deliberately omits endsAtEpochMs while running so that
        // steady-state updates (or no-op activity refreshes) don't tear
        // down and rebuild the OS-driven timer view, which is what
        // produced the "seconds skip / speed up" artifact. Pause↔resume
        // still flips the id because isRunning changes.
        .id(state.isRunning ? "running" : "paused-\(state.pausedSecondsLeft ?? -1)")
    }

    private func formatMMSS(_ totalSec: Int) -> String {
        let m = max(0, totalSec) / 60
        let s = max(0, totalSec) % 60
        return "\(m):\(String(format: "%02d", s))"
    }
}
