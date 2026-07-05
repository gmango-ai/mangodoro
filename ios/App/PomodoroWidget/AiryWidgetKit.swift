import SwiftUI
import WidgetKit
import AppIntents

// Shared design system for the "Airy" pomodoro widgets — used by both the
// home-screen widget (PomodoroHomeWidget) and the Live Activity /
// Dynamic Island (PomodoroLiveActivity).
//
// The look: bright floating surfaces, a rounded-square (squircle) progress
// ring that drains as the hero element, tight numerals, and a phase-driven
// accent (work = the user's accent, breaks = their break color). Light/dark
// token sets mirror the imported "Pomodoro Widgets Airy" design.
//
// Components take plain colors/values (not the state structs) so the home
// widget's `PomodoroSnapshot` and the Live Activity's
// `PomodoroActivityAttributes.State` can both drive them.

// MARK: - Color(hex:)

extension Color {
    /// Parses "#RRGGBB" / "#RRGGBBAA" (with or without the leading #).
    /// Lives here so both widget files share one implementation.
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

// MARK: - Theme tokens

/// Light/dark surface tokens from the Airy design. `fg`/`sub` are text,
/// `track` is the ring's unfilled rail, `btn`/`btnFg` the secondary
/// buttons, `chip` the small pill backgrounds.
@available(iOS 14.0, *)
struct AiryTheme {
    let fill: Color
    let fg: Color
    let sub: Color
    let hair: Color
    let track: Color
    let btn: Color
    let btnFg: Color
    let chip: Color

    static let light = AiryTheme(
        fill: .white,
        fg: Color(hex: "#0B1020") ?? .black,
        sub: Color(hex: "#7A879D") ?? .gray,
        hair: Color(red: 11 / 255, green: 16 / 255, blue: 32 / 255).opacity(0.06),
        track: Color(red: 11 / 255, green: 16 / 255, blue: 32 / 255).opacity(0.08),
        btn: Color(hex: "#EEF3FC") ?? Color.gray.opacity(0.1),
        btnFg: Color(hex: "#3D5170") ?? .secondary,
        chip: Color(hex: "#F1F5FD") ?? Color.gray.opacity(0.08)
    )

    static let dark = AiryTheme(
        fill: Color(hex: "#141E3C") ?? Color(white: 0.08),
        fg: Color(hex: "#EAF1FF") ?? .white,
        sub: Color(hex: "#9AA6BE") ?? .gray,
        hair: Color(red: 125 / 255, green: 150 / 255, blue: 230 / 255).opacity(0.12),
        track: Color(red: 234 / 255, green: 241 / 255, blue: 255 / 255).opacity(0.10),
        btn: Color(red: 234 / 255, green: 241 / 255, blue: 255 / 255).opacity(0.10),
        btnFg: Color(hex: "#EAF1FF") ?? .white,
        chip: Color(red: 234 / 255, green: 241 / 255, blue: 255 / 255).opacity(0.06)
    )

    static func resolve(_ scheme: ColorScheme) -> AiryTheme { scheme == .dark ? .dark : .light }
}

// MARK: - Phase helpers

/// Brand fallback when no accent hex was mirrored (fresh installs, stale
/// snapshots): the Mangodoro orange, sampled from the app icon's gradient
/// midpoint (#EC785A → #EF8148 → #F6A40A).
@available(iOS 14.0, *)
let airyBrandFallback = Color(hex: "#EF8148") ?? .orange

/// Work uses the user's accent; breaks use the analogous break color
/// (falling back to the accent, then the brand orange).
@available(iOS 14.0, *)
func airyPhaseAccent(mode: String, accentHex: String?, breakHex: String?) -> Color {
    if mode != "work" {
        return Color(hex: breakHex) ?? Color(hex: accentHex) ?? airyBrandFallback
    }
    return Color(hex: accentHex) ?? airyBrandFallback
}

/// Per-mode fallback length when the content state predates
/// `phaseDurationSeconds` (so the ring still draws sensibly).
func airyDefaultDuration(mode: String) -> Double {
    switch mode {
    case "shortBreak": return 300
    case "longBreak": return 900
    default: return 1500
    }
}

/// Remaining fraction (0...1) the ring should fill. Computed at render time
/// — widgets/Live Activities can't run a continuous animation, so the ring
/// is stepwise per reload while the numeral ticks via Text(timerInterval:).
func airyRingFraction(
    isRunning: Bool,
    endsAtEpochMs: Double,
    pausedSecondsLeft: Int?,
    phaseDurationSeconds: Double?,
    mode: String,
    now: Date = Date()
) -> Double {
    let total = max(1, phaseDurationSeconds ?? airyDefaultDuration(mode: mode))
    let remaining: Double = isRunning
        ? max(0, endsAtEpochMs / 1000.0 - now.timeIntervalSince1970)
        : Double(max(0, pausedSecondsLeft ?? 0))
    return min(1, max(0, remaining / total))
}

/// Whole minutes remaining (rounded up), for the ring's "{n}m" center.
func airyMinsLeft(
    isRunning: Bool,
    endsAtEpochMs: Double,
    pausedSecondsLeft: Int?,
    now: Date = Date()
) -> Int {
    let secs: Double = isRunning
        ? max(0, endsAtEpochMs / 1000.0 - now.timeIntervalSince1970)
        : Double(max(0, pausedSecondsLeft ?? 0))
    return Int(ceil(secs / 60.0))
}

// MARK: - Ring

/// Rounded-square progress ring. `fraction` is the remaining portion shown
/// in `accent` over a faint `track` rail. `center` is whatever sits inside
/// (a countdown, "{n}m", etc.).
@available(iOS 14.0, *)
struct AiryRing<Center: View>: View {
    var fraction: Double
    var accent: Color
    var track: Color
    var size: CGFloat
    var lineWidth: CGFloat?
    @ViewBuilder var center: () -> Center

    init(
        fraction: Double,
        accent: Color,
        track: Color,
        size: CGFloat,
        lineWidth: CGFloat? = nil,
        @ViewBuilder center: @escaping () -> Center
    ) {
        self.fraction = fraction
        self.accent = accent
        self.track = track
        self.size = size
        self.lineWidth = lineWidth
        self.center = center
    }

    private var lw: CGFloat { lineWidth ?? max(4, size * 0.085) }
    private var corner: CGFloat { size * 0.30 }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: corner, style: .continuous)
                .stroke(track, lineWidth: lw)
                .padding(lw / 2)
            RoundedRectangle(cornerRadius: corner, style: .continuous)
                .trim(from: 0, to: min(1, max(0.0001, fraction)))
                .stroke(accent, style: StrokeStyle(lineWidth: lw, lineCap: .round, lineJoin: .round))
                .padding(lw / 2)
            center()
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Controls (iOS 17+)

/// Primary pause/resume pill, phase-accent filled. Generic over the intent
/// so the home widget (HomeToggleTimerIntent) and the Live Activity
/// (ToggleTimerIntent, a LiveActivityIntent) can both use it.
@available(iOS 17.0, *)
struct AiryPrimaryButton<I: AppIntent>: View {
    let intent: I
    let isRunning: Bool
    let accent: Color
    var height: CGFloat = 38

    var body: some View {
        Button(intent: intent) {
            HStack(spacing: 7) {
                Image(systemName: isRunning ? "pause.fill" : "play.fill")
                    .font(.system(size: height * 0.40, weight: .bold))
                Text(isRunning ? "Pause" : "Resume")
                    .font(.system(size: height * 0.34, weight: .semibold))
                    .lineLimit(1)
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .background(RoundedRectangle(cornerRadius: height * 0.34, style: .continuous).fill(accent))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Square secondary button (stop, etc.).
@available(iOS 17.0, *)
struct AirySecondaryButton<I: AppIntent>: View {
    let intent: I
    let systemName: String
    let bg: Color
    let fg: Color
    var size: CGFloat = 38

    var body: some View {
        Button(intent: intent) {
            Image(systemName: systemName)
                .font(.system(size: size * 0.42, weight: .bold))
                .foregroundColor(fg)
                .frame(width: size, height: size)
                .background(RoundedRectangle(cornerRadius: size * 0.34, style: .continuous).fill(bg))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// Optimistic "Pausing… / Resuming…" placeholder shown in place of the
/// control row while a tap's round-trip is in flight. Static (widgets don't
/// animate), so it reads as a calm status line rather than a dead spinner.
@available(iOS 14.0, *)
struct AiryProcessing: View {
    let label: String
    let accent: Color
    let sub: Color
    var height: CGFloat = 38

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "hourglass")
                .font(.system(size: height * 0.34, weight: .bold))
                .foregroundColor(accent)
            Text(label)
                .font(.system(size: height * 0.34, weight: .semibold))
                .foregroundColor(sub)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
    }
}
