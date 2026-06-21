import WidgetKit
import SwiftUI
import AppIntents
import Foundation

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
    // "pausing" | "resuming" while a widget tap's server round-trip is in
    // flight, else nil. The widget shows a transition label instead of a
    // (possibly stale) time until the authoritative state is mirrored back.
    let transition: String?
    // Epoch ms when `transition` was set. Safety net: we stop honoring a
    // transition this long after it was stamped so a dead round-trip can't
    // leave the widget stuck on "Syncing…".
    let transitionAtMs: Double?

    // Honor the transition label only briefly. Past the TTL (round-trip
    // presumably died without reconciling), fall through to the underlying
    // time. A missing stamp is treated as just-now for backward compat.
    static let transitionTTL: TimeInterval = 8
    func activeTransition(now: Date = Date()) -> String? {
        guard let transition else { return nil }
        let age = now.timeIntervalSince1970 - (transitionAtMs ?? now.timeIntervalSince1970 * 1000) / 1000.0
        return (age >= 0 && age < Self.transitionTTL) ? transition : nil
    }

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
            accentColorHex: obj["accentColorHex"] as? String,
            transition: obj["transition"] as? String,
            transitionAtMs: obj["transitionAt"] as? Double
        )
    }

    // Pull the SAME authoritative content state the Live Activity renders (the
    // server's pomodoro_activity_tokens.state, kept fresh by activity-action /
    // activity-push) and mirror it into the App Group, so the home widget,
    // lock screen, and Dynamic Island agree — even after a website change that
    // happened while the app was backgrounded (which only pushed the LA).
    // Returns .unavailable on any network/parse failure so the caller keeps
    // the last-known local snapshot.
    static func fetchAuthoritative() async -> AuthoritativeState {
        let defaults = UserDefaults(suiteName: "group.com.gmango.mangodoro")
        guard
            let urlBase = defaults?.string(forKey: "mangodoro.supabaseUrl"), !urlBase.isEmpty,
            let anon = defaults?.string(forKey: "mangodoro.supabaseAnonKey"), !anon.isEmpty,
            let activityId = defaults?.string(forKey: "mangodoro.currentActivityId"), !activityId.isEmpty,
            let secret = defaults?.string(forKey: "mangodoro.currentActivitySecret"), !secret.isEmpty,
            let url = URL(string: "\(urlBase.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/functions/v1/activity-state")
        else { return .unavailable }

        var req = URLRequest(url: url, timeoutInterval: 4)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(anon, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(anon)", forHTTPHeaderField: "Authorization")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["activity_id": activityId, "secret": secret])

        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              let http = resp as? HTTPURLResponse
        else { return .unavailable }
        if http.statusCode == 404 { return .ended }
        guard (200..<300).contains(http.statusCode),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              var state = obj["state"] as? [String: Any]
        else { return .unavailable }

        // Preserve a locally-known room (the server state doesn't carry it).
        if state["room"] == nil,
           let json = defaults?.string(forKey: "mangodoro.currentActivityState"),
           let d = json.data(using: .utf8),
           let prev = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
           let room = prev["room"] {
            state["room"] = room
        }
        guard let stateData = try? JSONSerialization.data(withJSONObject: state),
              let stateJSON = String(data: stateData, encoding: .utf8)
        else { return .unavailable }
        // Authoritative state is non-transitional, so mirroring it clears any
        // stale transition marker too.
        defaults?.set(stateJSON, forKey: "mangodoro.currentActivityState")
        if let running = state["isRunning"] as? Bool {
            defaults?.set(running, forKey: "mangodoro.lastToggleResultRunning")
        }
        guard let snapshot = PomodoroSnapshot.read() else { return .unavailable }
        return .active(snapshot)
    }
}

// Result of pulling the authoritative state. `.ended` → the activity was
// stopped server-side (show empty); `.unavailable` → couldn't reach the
// server (caller keeps the local snapshot).
enum AuthoritativeState {
    case active(PomodoroSnapshot)
    case ended
    case unavailable
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
        let local = PomodoroSnapshot.read()
        // A tap's transition is in flight → keep showing it; don't override
        // with a possibly mid-round-trip server snapshot.
        if let s = local, s.activeTransition() != nil {
            completion(Self.makeTimeline(s))
            return
        }
        // Otherwise pull the authoritative state the Live Activity uses so the
        // home widget, lock screen, and Dynamic Island agree — even after a
        // website change that happened while the app was backgrounded.
        Task {
            switch await PomodoroSnapshot.fetchAuthoritative() {
            case .active(let s):
                completion(Self.makeTimeline(s))
            case .ended:
                UserDefaults(suiteName: "group.com.gmango.mangodoro")?
                    .removeObject(forKey: "mangodoro.currentActivityState")
                completion(Self.makeTimeline(nil))
            case .unavailable:
                completion(Self.makeTimeline(local))
            }
        }
    }

    // Build the single-entry timeline + refresh policy for `snapshot`.
    static func makeTimeline(_ snapshot: PomodoroSnapshot?) -> Timeline<PomodoroHomeEntry> {
        let now = Date()
        let entry = PomodoroHomeEntry(date: now, snapshot: snapshot)
        let refresh: Date
        if let s = snapshot, s.transition != nil, let atMs = s.transitionAtMs,
           atMs / 1000.0 + PomodoroSnapshot.transitionTTL > now.timeIntervalSince1970 {
            // A toggle round-trip is in flight: reload right after the label's
            // TTL so a stuck "Syncing…" auto-resolves to the underlying time.
            refresh = Date(timeIntervalSince1970: atMs / 1000.0 + PomodoroSnapshot.transitionTTL)
        } else if let s = snapshot, s.isRunning, s.endsAtEpochMs > 0 {
            let endsAt = Date(timeIntervalSince1970: s.endsAtEpochMs / 1000.0)
            refresh = max(now.addingTimeInterval(60), endsAt.addingTimeInterval(2))
        } else {
            refresh = now.addingTimeInterval(60 * 60)
        }
        return Timeline(entries: [entry], policy: .after(refresh))
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
                statusPill(isRunning: s.isRunning, transition: s.activeTransition())
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
                statusPill(isRunning: s.isRunning, transition: s.activeTransition())
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
    private func statusPill(isRunning: Bool, transition: String?) -> some View {
        let label = transition != nil ? "Syncing…" : (isRunning ? "Running" : "Paused")
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
/// HomeToggleTimerIntent; reset runs HomeStopTimerIntent — plain AppIntents
/// (NOT the Live Activity's LiveActivityIntent versions). A Home Screen
/// widget button running a LiveActivityIntent gets tagged as a
/// SessionStartingAction, which makes chronod freeze the widget's reloads
/// for a fixed ~3.8s settle before it can repaint. The plain AppIntents
/// avoid that hold while still hitting the same activity-action edge
/// function, so the lock-screen Live Activity updates via APNs as before.
@available(iOS 17.0, *)
private struct HomeControls: View {
    let isRunning: Bool
    var compact: Bool = false

    var body: some View {
        HStack(spacing: compact ? 8 : 10) {
            ctrl(HomeToggleTimerIntent(), systemName: isRunning ? "pause.fill" : "play.fill",
                 size: compact ? 44 : 56, fill: 0.42)
            ctrl(HomeStopTimerIntent(), systemName: "stop.fill",
                 size: compact ? 38 : 46, fill: 0.22)
        }
    }

    private func ctrl<I: AppIntent>(_ intent: I, systemName: String, size: CGFloat, fill: Double) -> some View {
        Button(intent: intent) {
            Image(systemName: systemName)
                .font(.system(size: size * 0.42, weight: .bold))
                .foregroundColor(.white)
                .frame(width: size, height: size)
                .background(Circle().fill(Color.white.opacity(fill)))
                .padding(10)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

@available(iOS 14.0, *)
private struct HomeCountdown: View {
    let snapshot: PomodoroSnapshot
    private static let intervalStart = Date(timeIntervalSince1970: 0)

    var body: some View {
        if let t = snapshot.activeTransition() {
            // Round-trip in flight: show intent, not a (possibly stale) time —
            // "Resuming…" before a resume, "Paused" the instant you pause. The
            // real time fills in when the server's state is mirrored back (or
            // the TTL lapses and we fall through to the computed time).
            Text(t == "resuming" ? "Resuming…" : "Paused")
        } else if snapshot.isRunning, snapshot.endsAtEpochMs > 0 {
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
