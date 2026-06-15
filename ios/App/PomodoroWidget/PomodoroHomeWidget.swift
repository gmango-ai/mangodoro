import WidgetKit
import SwiftUI

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
        return PomodoroSnapshot(
            isRunning: obj["isRunning"] as? Bool ?? false,
            mode: obj["mode"] as? String ?? "work",
            label: obj["label"] as? String ?? "Pomodoro",
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
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                MangoMark().frame(width: 32, height: 32)
                Spacer(minLength: 0)
                statusPill(isRunning: s.isRunning)
            }
            Spacer(minLength: 0)
            Text(s.label)
                .font(.caption.weight(.medium))
                .foregroundColor(.white.opacity(0.85))
                .lineLimit(1)
            HomeCountdown(snapshot: s)
                .font(.system(size: 30, weight: .bold, design: .rounded).monospacedDigit())
                .foregroundColor(.white)
        }
    }

    @ViewBuilder
    private func mediumView(_ s: PomodoroSnapshot) -> some View {
        HStack(spacing: 14) {
            MangoMark().frame(width: 56, height: 56)
            VStack(alignment: .leading, spacing: 4) {
                Text(s.label)
                    .font(.headline)
                    .foregroundColor(.white)
                    .lineLimit(1)
                statusPill(isRunning: s.isRunning)
                Spacer(minLength: 0)
            }
            Spacer()
            HomeCountdown(snapshot: s)
                .font(.system(size: 40, weight: .bold, design: .rounded).monospacedDigit())
                .foregroundColor(.white)
        }
    }

    private var emptyView: some View {
        VStack(spacing: 10) {
            MangoMark().frame(width: 48, height: 48)
            Text("Tap to start a session")
                .font(.caption.weight(.medium))
                .foregroundColor(.white.opacity(0.9))
                .multilineTextAlignment(.center)
                .lineLimit(2)
        }
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
