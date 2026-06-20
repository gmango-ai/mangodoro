import WidgetKit
import SwiftUI
import AppIntents

/// Home screen / lockscreen-stack widget showing the current pomodoro
/// session at a glance. Reads its data from the same App Group key the
/// Live Activity plugin mirrors on every start/update/pause — so the
/// widget and the lockscreen activity stay in lockstep without a
/// separate persistence path.
///
/// Theming: container background is an accent-colored gradient using
/// the same hex the user picked in the app, with the white Mangodoro
/// silhouette over it (mirrors the splash). Reads as "Mangodoro" at a
/// glance rather than a generic dark widget.

@available(iOS 14.0, *)
struct PomodoroHomeWidget: Widget {
    static let kind = "MangodoroHomeWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: PomodoroSnapshotProvider()) { entry in
            let tint = entry.snapshot.flatMap { Color(hex: $0.accentColorHex) } ?? .teal
            PomodoroHomeWidgetView(entry: entry, tint: tint)
                .containerBackground(for: .widget) {
                    LinearGradient(
                        colors: [
                            tint,
                            tint.opacity(0.78),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                }
        }
        .configurationDisplayName("Mangodoro")
        .description("Current pomodoro session.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct PomodoroSnapshot {
    let isRunning: Bool
    let mode: String
    let label: String
    let room: String?
    let endsAtEpochMs: Double
    let pausedSecondsLeft: Int?
    let accentColorHex: String?

    static func read() -> PomodoroSnapshot? {
        let defaults = UserDefaults(suiteName: "group.com.gmango.mangodoro")
        guard
            let json = defaults?.string(forKey: "mangodoro.currentActivityState"),
            let data = json.data(using: .utf8),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        let roomRaw = (obj["room"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return PomodoroSnapshot(
            isRunning: obj["isRunning"] as? Bool ?? false,
            mode: obj["mode"] as? String ?? "work",
            label: obj["label"] as? String ?? "Pomodoro",
            room: (roomRaw?.isEmpty == false) ? roomRaw : nil,
            endsAtEpochMs: obj["endsAtEpochMs"] as? Double ?? 0,
            pausedSecondsLeft: obj["pausedSecondsLeft"] as? Int,
            accentColorHex: obj["accentColorHex"] as? String
        )
    }
}

struct PomodoroHomeEntry: TimelineEntry {
    let date: Date
    let snapshot: PomodoroSnapshot?
}

struct PomodoroSnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> PomodoroHomeEntry {
        PomodoroHomeEntry(date: Date(), snapshot: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (PomodoroHomeEntry) -> Void) {
        completion(PomodoroHomeEntry(date: Date(), snapshot: PomodoroSnapshot.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PomodoroHomeEntry>) -> Void) {
        let snapshot = PomodoroSnapshot.read()
        let entry = PomodoroHomeEntry(date: Date(), snapshot: snapshot)
        let refresh: Date
        if let s = snapshot, s.isRunning, s.endsAtEpochMs > 0 {
            let endsAt = Date(timeIntervalSince1970: s.endsAtEpochMs / 1000.0)
            refresh = max(Date().addingTimeInterval(60), endsAt.addingTimeInterval(2))
        } else {
            refresh = Date().addingTimeInterval(60 * 60)
        }
        completion(Timeline(entries: [entry], policy: .after(refresh)))
    }
}

@available(iOS 14.0, *)
struct PomodoroHomeWidgetView: View {
    let entry: PomodoroHomeEntry
    let tint: Color
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let s = entry.snapshot {
            switch family {
            case .systemMedium:
                mediumView(s)
            default:
                smallView(s)
            }
        } else {
            emptyView
        }
    }

    @ViewBuilder
    private func smallView(_ s: PomodoroSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                MangoMark().frame(width: 28, height: 28)
                Spacer(minLength: 0)
                statusPill(isRunning: s.isRunning)
            }
            Spacer(minLength: 0)
            if let room = s.room {
                roomChip(room, size: 9)
            }
            Text(s.label)
                .font(.caption.weight(.medium))
                .foregroundColor(.white.opacity(0.85))
                .lineLimit(1)
            HomeCountdown(snapshot: s)
                .font(.system(size: 26, weight: .bold, design: .rounded).monospacedDigit())
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if #available(iOS 17.0, *) {
                HomeControls(isRunning: s.isRunning, compact: true).padding(.top, 1)
            }
        }
    }

    @ViewBuilder
    private func mediumView(_ s: PomodoroSnapshot) -> some View {
        HStack(spacing: 14) {
            MangoMark().frame(width: 52, height: 52)
            VStack(alignment: .leading, spacing: 3) {
                if let room = s.room {
                    roomChip(room, size: 11)
                }
                Text(s.label)
                    .font(.headline)
                    .foregroundColor(.white)
                    .lineLimit(1)
                statusPill(isRunning: s.isRunning)
                Spacer(minLength: 0)
                if #available(iOS 17.0, *) {
                    HomeControls(isRunning: s.isRunning)
                }
            }
            Spacer()
            HomeCountdown(snapshot: s)
                .font(.system(size: 38, weight: .bold, design: .rounded).monospacedDigit())
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
    }

    private var emptyView: some View {
        // No active session. ActivityKit requires Live Activities to be
        // started from the foreground app, so tapping opens the app (the
        // widget's default tap target) where a session can be started.
        VStack(spacing: 8) {
            ZStack {
                Circle().fill(Color.white.opacity(0.22)).frame(width: 46, height: 46)
                Image(systemName: "play.fill")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(.white)
            }
            Text("Start a session")
                .font(.caption.weight(.semibold))
                .foregroundColor(.white)
                .multilineTextAlignment(.center)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func roomChip(_ room: String, size: CGFloat) -> some View {
        HStack(spacing: 3) {
            Image(systemName: "person.2.fill").font(.system(size: size - 1, weight: .semibold))
            Text(room).lineLimit(1)
        }
        .font(.system(size: size, weight: .semibold))
        .foregroundColor(.white.opacity(0.85))
    }

    @ViewBuilder
    private func statusPill(isRunning: Bool) -> some View {
        let label = isRunning ? "Running" : "Paused"
        Text(label)
            .font(.caption2.weight(.semibold))
            .foregroundColor(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(
                Capsule()
                    .fill(Color.white.opacity(isRunning ? 0.28 : 0.18))
            )
    }
}

/// Interactive controls for the home widget (iOS 17+). Pause/resume runs
/// ToggleTimerIntent; reset runs StopTimerIntent — the same intents the
/// Live Activity uses, so they go through the activity-action edge
/// function and reconcile back to the app.
@available(iOS 17.0, *)
private struct HomeControls: View {
    let isRunning: Bool
    var compact: Bool = false

    var body: some View {
        HStack(spacing: compact ? 8 : 10) {
            ctrl(ToggleTimerIntent(), systemName: isRunning ? "pause.fill" : "play.fill",
                 size: compact ? 30 : 34, fill: 0.26)
            ctrl(StopTimerIntent(), systemName: "stop.fill",
                 size: compact ? 28 : 30, fill: 0.16)
        }
    }

    private func ctrl<I: AppIntent>(_ intent: I, systemName: String, size: CGFloat, fill: Double) -> some View {
        Button(intent: intent) {
            Image(systemName: systemName)
                .font(.system(size: size * 0.42, weight: .bold))
                .foregroundColor(.white)
                .frame(width: size, height: size)
                .background(Circle().fill(Color.white.opacity(fill)))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
    }
}

@available(iOS 14.0, *)
private struct HomeCountdown: View {
    let snapshot: PomodoroSnapshot
    private static let intervalStart = Date(timeIntervalSince1970: 0)

    var body: some View {
        if snapshot.isRunning, snapshot.endsAtEpochMs > 0 {
            let endsAt = Date(timeIntervalSince1970: snapshot.endsAtEpochMs / 1000.0)
            if endsAt > Date() {
                Text(timerInterval: Self.intervalStart...endsAt, countsDown: true)
            } else {
                Text("0:00")
            }
        } else {
            let sec = snapshot.pausedSecondsLeft ?? 0
            Text("\(sec / 60):\(String(format: "%02d", sec % 60))")
        }
    }
}

/// White Mangodoro silhouette on a soft translucent white circle so the
/// mark reads clearly on whatever accent tint is behind the widget.
@available(iOS 14.0, *)
private struct MangoMark: View {
    var body: some View {
        ZStack {
            Circle().fill(Color.white.opacity(0.18))
            Circle().stroke(Color.white.opacity(0.35), lineWidth: 1)
            if let appIcon = UIImage(named: "WidgetAppIcon") {
                Image(uiImage: appIcon)
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .foregroundColor(.white)
                    .padding(5)
            } else {
                Image(systemName: "timer")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundColor(.white)
            }
        }
    }
}
