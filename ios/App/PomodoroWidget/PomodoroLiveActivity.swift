import ActivityKit
import AppIntents
import WidgetKit
import SwiftUI

/// Lockscreen + Dynamic Island UI for the pomodoro Live Activity.
///
/// Theming:
///   • Lockscreen — no explicit background tint, so iOS renders the
///     platter with the same vibrant translucent material as system
///     notifications. Text uses `.primary` / `.secondary` so it adapts
///     to wallpaper brightness.
///   • Dynamic Island — the cutout is always dark; content stays
///     explicit `.white` for legibility.
///   • Brand mark — a saturated accent-colored circle with the white
///     Mangodoro silhouette overlaid (the same mark the splashscreen
///     uses). Provides the only intentional color in the lockscreen
///     so the activity reads as Mangodoro without overwhelming.
///
/// Lock-screen pause/play/stop buttons require iOS 17+ (LiveActivityIntent).
@available(iOS 16.1, *)
struct PomodoroLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PomodoroActivityAttributes.self) { context in
            PomodoroLockScreenView(state: context.state)
                // Lighter translucent variant: the accent color washed at
                // ~70% opacity so the wallpaper shows through and the
                // activity sits in the same visual register as the
                // translucent system notification platters below it.
                // Keep white foreground because iOS dims wallpapers on
                // the lockscreen enough that white text still reads.
                .activityBackgroundTint((Color(hex: context.state.accentColorHex) ?? .teal).opacity(0.7))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 10) {
                        MangoMark(tint: accentColor(context.state))
                            .frame(width: 38, height: 38)
                        VStack(alignment: .leading, spacing: 2) {
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
                        .font(.system(size: 30, weight: .semibold, design: .rounded).monospacedDigit())
                        .foregroundColor(.white)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    // Interactive controls need iOS 17 (LiveActivityIntent).
                    // The availability check must live INSIDE the region's
                    // ViewBuilder — the DynamicIslandExpandedContentBuilder that
                    // assembles the regions can't take control flow, so an
                    // `if #available` wrapped around the region fails to compile
                    // ("Expanded could not be inferred"). On iOS 16 the region is
                    // simply empty.
                    if #available(iOS 17.0, *) {
                        HStack(spacing: 12) {
                            ToggleButton(
                                isRunning: context.state.isRunning,
                                tint: accentColor(context.state),
                                size: 44
                            )
                            StopButton(tint: accentColor(context.state), size: 36)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
            } compactLeading: {
                MangoMark(tint: accentColor(context.state))
            } compactTrailing: {
                CountdownText(state: context.state)
                    .font(.caption.monospacedDigit().weight(.medium))
                    .foregroundColor(.white)
                    .frame(maxWidth: 52)
            } minimal: {
                MangoMark(tint: accentColor(context.state))
            }
            .keylineTint(accentColor(context.state))
        }
    }

    @ViewBuilder
    private func statusLabel(for state: PomodoroActivityAttributes.State, onDark: Bool) -> some View {
        if !state.isRunning {
            Text("Paused")
                .font(.caption2)
                .foregroundColor(onDark ? .white.opacity(0.7) : .secondary)
        } else if state.isSynced {
            Text("Sync session")
                .font(.caption2)
                .foregroundColor(onDark ? .white.opacity(0.7) : .secondary)
        }
    }

    private func accentColor(_ state: PomodoroActivityAttributes.State) -> Color {
        Color(hex: state.accentColorHex) ?? .teal
    }
}

@available(iOS 16.1, *)
private struct PomodoroLockScreenView: View {
    let state: PomodoroActivityAttributes.State

    var body: some View {
        HStack(spacing: 14) {
            // On the accent-tinted platter the glyph background blends
            // with the platter itself, so we render the logo on a
            // softly translucent white circle to keep it crisp.
            MangoMark(style: .onAccent)
                .frame(width: 56, height: 56)
            VStack(alignment: .leading, spacing: 2) {
                Text(state.label)
                    .font(.subheadline.weight(.semibold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                subtitle
                    .font(.caption2)
                    .foregroundColor(.white.opacity(0.78))
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if #available(iOS 17.0, *) {
                HStack(spacing: 10) {
                    ToggleButton(
                        isRunning: state.isRunning,
                        tint: accentColor,
                        size: 44
                    )
                    StopButton(tint: accentColor, size: 36)
                }
            }
            CountdownText(state: state)
                .font(.system(size: 34, weight: .semibold, design: .rounded).monospacedDigit())
                .foregroundColor(.white)
                // Keep the timer on a single line: scale down to fit rather
                // than wrapping, and claim width ahead of the label/buttons.
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .layoutPriority(1)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
    }

    private var accentColor: Color {
        Color(hex: state.accentColorHex) ?? .teal
    }

    @ViewBuilder
    private var subtitle: some View {
        if !state.isRunning {
            Text("Paused")
        } else if state.isSynced {
            Text("Sync session")
        } else {
            Text("Tap to open")
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
        .id(state.isRunning
            ? "running"
            : "paused-\(state.pausedSecondsLeft ?? -1)")
    }

    private func formatMMSS(_ totalSec: Int) -> String {
        let m = max(0, totalSec) / 60
        let s = max(0, totalSec) % 60
        return "\(m):\(String(format: "%02d", s))"
    }
}

/// Brand mark: white Mangodoro silhouette inside a circle. Two styles:
///   • `.onAccent` — translucent white circle, used on the lockscreen
///     where the activity platter is already painted in the accent
///     color, so the glyph background is white-on-tint.
///   • `.tinted(Color)` — solid accent fill, used on the Dynamic
///     Island and minimal presentations where the surrounding cutout
///     is always dark, so the glyph carries the only color.
@available(iOS 16.1, *)
private struct MangoMark: View {
    enum Style {
        case onAccent
        case tinted(Color)
    }
    let style: Style

    init(style: Style = .onAccent) { self.style = style }
    init(tint: Color) { self.style = .tinted(tint) }

    var body: some View {
        ZStack {
            // On the accent-tinted platter the logo carries itself —
            // dropping the translucent circle lets it fill the whole
            // frame and the white silhouette has high contrast against
            // the saturated background.
            if case .tinted(let tint) = style {
                Circle().fill(tint)
            }
            if let appIcon = UIImage(named: "WidgetAppIcon") {
                Image(uiImage: appIcon)
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .foregroundColor(.white)
                    // Tighter padding so the mark fills the frame.
                    // .tinted needs a touch of inset so the silhouette
                    // doesn't kiss the circle's edge; .onAccent has no
                    // circle so we can let it run edge-to-edge.
                    .padding(paddingForStyle)
            } else {
                Image(systemName: "timer")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(.white)
            }
        }
    }

    private var paddingForStyle: CGFloat {
        switch style {
        case .onAccent: return 0
        case .tinted: return 4
        }
    }
}

@available(iOS 17.0, *)
private struct ToggleButton: View {
    let isRunning: Bool
    let tint: Color
    let size: CGFloat

    var body: some View {
        if isRunning {
            button(systemName: "pause.fill").id("pause")
        } else {
            button(systemName: "play.fill").id("play")
        }
    }

    private func button(systemName: String) -> some View {
        Button(intent: ToggleTimerIntent()) {
            ZStack {
                Circle().fill(tint)
                Image(systemName: systemName)
                    .font(.system(size: size * 0.46, weight: .bold))
                    .foregroundColor(.white)
            }
            .frame(width: size, height: size)
            // Generous invisible hit area so the button is easy to hit
            // quickly even though the visible circle stays compact.
            .padding(9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

@available(iOS 17.0, *)
private struct StopButton: View {
    let tint: Color
    let size: CGFloat

    var body: some View {
        Button(intent: StopTimerIntent()) {
            ZStack {
                Circle().fill(tint)
                Image(systemName: "stop.fill")
                    .font(.system(size: size * 0.46, weight: .bold))
                    .foregroundColor(.white)
            }
            .frame(width: size, height: size)
            .padding(9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

extension Color {
    init?(hex: String?) {
        guard var raw = hex?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        if raw.hasPrefix("#") { raw.removeFirst() }
        guard raw.count == 6 || raw.count == 8 else { return nil }
        var value: UInt64 = 0
        guard Scanner(string: raw).scanHexInt64(&value) else { return nil }
        let r, g, b, a: Double
        if raw.count == 6 {
            r = Double((value >> 16) & 0xFF) / 255.0
            g = Double((value >> 8) & 0xFF) / 255.0
            b = Double(value & 0xFF) / 255.0
            a = 1.0
        } else {
            r = Double((value >> 24) & 0xFF) / 255.0
            g = Double((value >> 16) & 0xFF) / 255.0
            b = Double((value >> 8) & 0xFF) / 255.0
            a = Double(value & 0xFF) / 255.0
        }
        self = Color(red: r, green: g, blue: b, opacity: a)
    }
}
