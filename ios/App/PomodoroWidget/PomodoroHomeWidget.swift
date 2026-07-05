import WidgetKit
import SwiftUI
import AppIntents
import Foundation

/// Home screen / lockscreen-stack widget showing the current pomodoro
/// session at a glance — "Airy" design (shared tokens/components live in
/// AiryWidgetKit.swift). Reads its data from the same App Group key the
/// Live Activity plugin mirrors on every start/update/pause, so the widget
/// and the lockscreen activity stay in lockstep without a separate
/// persistence path.
///
/// Look: the widget container *is* the floating card (white in light /
/// deep navy in dark); a rounded-square ring drains with time left; the
/// accent is phase-driven (work = the user's accent, break = their break
/// color).

@available(iOS 14.0, *)
struct PomodoroHomeWidget: Widget {
    static let kind = "MangodoroHomeWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: PomodoroSnapshotProvider()) { entry in
            // The widget *is* the Airy card: its container background is the
            // surface (white in light / deep navy in dark), and the content
            // sits directly on it. The OS frames it against the wallpaper.
            PomodoroHomeWidgetView(entry: entry)
                .containerBackground(for: .widget) { AiryHomeBackground() }
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
    // Break-phase color + current phase length, for the Airy ring/accent.
    // Optional — absent in pre-redesign snapshots; the views fall back to
    // the accent and per-mode default durations.
    let breakColorHex: String?
    let phaseDurationSeconds: Double?
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
            breakColorHex: obj["breakColorHex"] as? String,
            phaseDurationSeconds: obj["phaseDurationSeconds"] as? Double,
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
            // The countdown itself ticks via Text(timerInterval:) without
            // reloads, so a reload only matters to catch a STATE change made on
            // another device (pause / resume / reset). The real-time path for
            // that is the silent background push — but iOS throttles and drops
            // those (worst when the app is backgrounded), which left the widget
            // stuck on a stale phase until it ended. So also re-pull the
            // authoritative state periodically (≤ ~20 min) as a self-heal,
            // capped well within WidgetKit's ~40-70/day reload budget: at most
            // one extra reload per work phase.
            let endsAt = Date(timeIntervalSince1970: s.endsAtEpochMs / 1000.0)
            let phaseEnd = endsAt.addingTimeInterval(2)
            let periodicHeal = now.addingTimeInterval(20 * 60)
            refresh = max(now.addingTimeInterval(60), min(phaseEnd, periodicHeal))
        } else {
            refresh = now.addingTimeInterval(60 * 60)
        }
        return Timeline(entries: [entry], policy: .after(refresh))
    }
}

/// The widget's own surface — the Airy card. Reads the color scheme so the
/// card is white in light mode and deep navy in dark.
@available(iOS 14.0, *)
private struct AiryHomeBackground: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View { AiryTheme.resolve(scheme).fill }
}

@available(iOS 14.0, *)
struct PomodoroHomeWidgetView: View {
    let entry: PomodoroHomeEntry
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme

    private var theme: AiryTheme { AiryTheme.resolve(scheme) }

    var body: some View {
        if let s = entry.snapshot {
            switch family {
            case .systemMedium: mediumView(s)
            default: smallView(s)
            }
        } else {
            emptyView
        }
    }

    private func accent(_ s: PomodoroSnapshot) -> Color {
        airyPhaseAccent(mode: s.mode, accentHex: s.accentColorHex, breakHex: s.breakColorHex)
    }
    private func fraction(_ s: PomodoroSnapshot) -> Double {
        airyRingFraction(
            isRunning: s.isRunning, endsAtEpochMs: s.endsAtEpochMs,
            pausedSecondsLeft: s.pausedSecondsLeft,
            phaseDurationSeconds: s.phaseDurationSeconds, mode: s.mode
        )
    }
    private func mins(_ s: PomodoroSnapshot) -> Int {
        airyMinsLeft(isRunning: s.isRunning, endsAtEpochMs: s.endsAtEpochMs, pausedSecondsLeft: s.pausedSecondsLeft)
    }

    // MARK: small (2x2)
    private func smallView(_ s: PomodoroSnapshot) -> some View {
        let accent = accent(s)
        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                Image(systemName: "timer").font(.system(size: 16, weight: .bold)).foregroundColor(accent)
                Spacer(minLength: 0)
                Circle().fill(s.isRunning ? accent : theme.sub).frame(width: 7, height: 7)
            }
            Spacer(minLength: 0)
            VStack(alignment: .leading, spacing: 4) {
                HomeCountdown(snapshot: s)
                    .font(.system(size: 26, weight: .bold, design: .rounded).monospacedDigit())
                    .foregroundColor(theme.fg)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text("\(s.label.uppercased()) · \(mins(s))m")
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(0.6)
                    .foregroundColor(accent)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if #available(iOS 17.0, *) {
                AiryPrimaryButton(intent: HomeToggleTimerIntent(), isRunning: s.isRunning, accent: accent, height: 32)
                    .padding(.top, 8)
            }
        }
    }

    // MARK: medium (4x2)
    private func mediumView(_ s: PomodoroSnapshot) -> some View {
        let accent = accent(s)
        return VStack(spacing: 12) {
            HStack(spacing: 14) {
                AiryRing(fraction: fraction(s), accent: accent, track: theme.track, size: 72) {
                    VStack(spacing: 2) {
                        HomeCountdown(snapshot: s)
                            .font(.system(size: 17, weight: .semibold, design: .rounded).monospacedDigit())
                            .foregroundColor(theme.fg)
                            .lineLimit(1).minimumScaleFactor(0.6)
                        Text(s.label.uppercased())
                            .font(.system(size: 8, weight: .semibold))
                            .tracking(0.6)
                            .foregroundColor(accent)
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 4)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(s.room ?? "Focus session")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(theme.fg)
                        .lineLimit(1)
                    statusChip(s)
                }
                Spacer(minLength: 0)
            }
            if #available(iOS 17.0, *) {
                controls(s)
            }
        }
    }

    @available(iOS 17.0, *)
    @ViewBuilder
    private func controls(_ s: PomodoroSnapshot) -> some View {
        if let t = s.activeTransition() {
            AiryProcessing(
                label: t == "resuming" ? "Resuming…" : "Pausing…",
                accent: accent(s), sub: theme.sub, height: 38
            )
        } else {
            HStack(spacing: 8) {
                AiryPrimaryButton(intent: HomeToggleTimerIntent(), isRunning: s.isRunning, accent: accent(s), height: 38)
                AirySecondaryButton(intent: HomeStopTimerIntent(), systemName: "stop.fill", bg: theme.btn, fg: theme.btnFg, size: 38)
            }
        }
    }

    private func statusChip(_ s: PomodoroSnapshot) -> some View {
        let text = s.activeTransition() != nil ? "Syncing…" : (s.isRunning ? "Running" : "Paused")
        return HStack(spacing: 6) {
            // Dim the dot while paused, matching the small view's indicator.
            Circle().fill(s.isRunning ? accent(s) : theme.sub).frame(width: 6, height: 6)
            Text(text).font(.system(size: 11, weight: .semibold)).foregroundColor(theme.sub).lineLimit(1)
        }
        .padding(.horizontal, 9)
        .frame(height: 22)
        .background(Capsule().fill(theme.chip))
    }

    // MARK: empty / idle
    @ViewBuilder
    private var emptyView: some View {
        // No active session. On iOS 17+ the Start button kicks off a personal
        // timer in-place via HomeStartTimerIntent (→ widget-start), no app
        // launch. On older iOS the tile is passive and tapping opens the app.
        if #available(iOS 17.0, *) {
            Button(intent: HomeStartTimerIntent()) { emptyContent }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            emptyContent.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var emptyContent: some View {
        let accent = airyBrandFallback
        return VStack(spacing: 10) {
            AiryRing(fraction: 1, accent: accent, track: theme.track, size: 54, lineWidth: 6) {
                Image(systemName: "play.fill").font(.system(size: 18, weight: .bold)).foregroundColor(accent)
            }
            Text("Start a session")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(theme.fg)
                .multilineTextAlignment(.center)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
