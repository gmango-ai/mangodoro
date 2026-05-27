import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Users as UsersIcon, Timer, Sparkles } from "lucide-react";
import PomodoroTimer from "../components/PomodoroTimer";
import UserAvatar from "../components/UserAvatar";
import { joinSyncSession } from "../lib/syncSession";

// Slim wrapper that mirrors how AppLayout wires the timer, but renders it
// inline in a full page instead of a floating panel.
export default function PomodoroPage({ session, syncState }) {
  const { settings } = useApp();
  const { activeTeamSessions } = useTeam();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();

  const {
    syncSession, syncParticipants, presenceMap,
    onOpenSync, onLeaveSync, onEndSync,
    onTransferLeader, onKickParticipant, onSetStatus,
    currentTaskHint,
  } = syncState;

  const [soloMode, setSoloMode] = useState(false); // true after "Custom pomodoro"
  const [joinError, setJoinError] = useState("");

  const presenceLabel = settings.presenceState === "in_meeting" ? "In meeting"
    : settings.presenceState === "heads_down" ? "Heads-down"
    : settings.presenceState === "away" ? "Away"
    : settings.presenceState === "available" ? "Available"
    : "Active";

  // Pop-out is handled by the embedded PomodoroTimer's built-in
  // Picture-in-Picture button (PictureInPicture2 icon in its header).
  // We don't need a separate route-based popout — the Document PiP
  // window is a better UX (no URL bar, always-on-top) and the timer's
  // view-mode toggle lives inside it.

  async function handleJoinTeamSession(s) {
    const name = (settings?.name || "").trim();
    if (!name) {
      setJoinError("Set a display name in Settings before joining.");
      return;
    }
    setJoinError("");
    const { data, error } = await joinSyncSession(s.join_code, name);
    if (error) {
      setJoinError(error.message?.includes("display_name_required")
        ? "A display name is required."
        : error.message || "Could not join.");
      return;
    }
    if (data?.session) {
      // Notify AppLayout (same tab) and popout (other tabs).
      window.dispatchEvent(new CustomEvent("ql-sync-session-joined", { detail: { session: data.session } }));
      try { new BroadcastChannel("pomodoro").postMessage({ type: "sync-changed" }); } catch { /* ignore */ }
    }
  }

  const inSession = !!syncSession;
  // Sync-first landing: if not in a session AND no solo flag, show the
  // landing screen with active team sessions and the "Start a session"
  // primary action. Otherwise mount the timer.
  const showTimer = inSession || soloMode;

  function modeLabel(m) { return m === "shortBreak" ? "Short break" : m === "longBreak" ? "Long break" : "Focus"; }
  function timeLeft(s) {
    if (!s) return "";
    if (!s.is_running || !s.ends_at) return `${Math.ceil((s.remaining_seconds || 0) / 60)}m`;
    return `${Math.max(0, Math.ceil((new Date(s.ends_at).getTime() - Date.now()) / 60000))}m left`;
  }

  return (
    <div className={`max-w-4xl mx-auto px-4 py-6 ${dark ? "text-slate-100" : "text-slate-800"}`}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Pomodoro</h1>
      </div>

      {/* ── Sync-first landing screen ─────────────────────────── */}
      {!showTimer && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2 space-y-4">
            {/* Active team sessions (the simple "see and join" surface) */}
            <div className={`rounded-2xl border p-4 ${dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"}`}>
              <h2 className={`text-sm font-semibold uppercase tracking-wider mb-3 ${dark ? "text-slate-400" : "text-slate-500"}`}>
                Active team pomodoros
              </h2>
              {joinError && (
                <p className={`text-xs mb-2 ${dark ? "text-red-400" : "text-red-600"}`}>{joinError}</p>
              )}
              {activeTeamSessions.length === 0 ? (
                <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
                  No one on your team has a session running right now.
                </p>
              ) : (
                <ul className="space-y-2">
                  {activeTeamSessions.map((s) => (
                    <li
                      key={s.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
                        dark ? "bg-slate-800/40" : "bg-slate-50"
                      }`}
                    >
                      <UserAvatar url={s.leader_avatar} name={s.leader_name} size={36} className="shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
                          {s.leader_name}
                        </p>
                        <p className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>
                          {modeLabel(s.mode)} · {s.participant_count}/{s.max_participants} · {timeLeft(s)}
                        </p>
                      </div>
                      <Button size="sm" onClick={() => handleJoinTeamSession(s)}>Join</Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Primary: start a synced session. */}
            <div className={`rounded-2xl border p-5 ${dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"}`}>
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${dark ? "bg-cyan-500/10" : "bg-teal-50"}`}>
                  <UsersIcon className={`w-5 h-5 ${dark ? "text-cyan-400" : "text-teal-600"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-bold">Start a synced session</p>
                  <p className={`text-sm mt-0.5 ${dark ? "text-slate-400" : "text-slate-500"}`}>
                    Default. Your teammates can see it and join with one click.
                  </p>
                  <Button onClick={onOpenSync} className="mt-3">Start session</Button>
                </div>
              </div>
            </div>

            {/* Secondary: solo / custom timer. */}
            <button
              type="button"
              onClick={() => setSoloMode(true)}
              className={`w-full text-left rounded-2xl border p-4 transition-colors ${
                dark
                  ? "bg-slate-900/50 border-slate-700 hover:border-slate-600 hover:bg-slate-900"
                  : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${dark ? "bg-slate-800" : "bg-slate-100"}`}>
                  <Sparkles className={`w-5 h-5 ${dark ? "text-slate-300" : "text-slate-600"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold">Custom pomodoro</p>
                  <p className={`text-sm mt-0.5 ${dark ? "text-slate-400" : "text-slate-500"}`}>
                    Just for you. Set your own durations and sound — no one else sees this one.
                  </p>
                </div>
              </div>
            </button>
          </div>

          <aside className="space-y-4">
            <div className={`rounded-2xl border p-4 ${dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"}`}>
              <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${dark ? "text-slate-400" : "text-slate-500"}`}>
                Your status
              </h3>
              <p className={`text-sm font-semibold ${dark ? "text-slate-200" : "text-slate-800"}`}>{presenceLabel}</p>
              {settings.status && (
                <p className={`text-sm mt-1 truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
                  {settings.status}
                </p>
              )}
              <p className={`text-[11px] mt-2 ${dark ? "text-slate-500" : "text-slate-400"}`}>
                Edit your status in Settings.
              </p>
            </div>
          </aside>
        </div>
      )}

      {/* ── Timer view ────────────────────────────────────────── */}
      {showTimer && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2 space-y-3">
            {soloMode && !inSession && (
              <button
                type="button"
                onClick={() => setSoloMode(false)}
                className={`text-xs ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}
              >
                ← Back to sessions
              </button>
            )}
            <PomodoroTimer
              open
              embedded
              onClose={() => {}}
              userId={session.user.id}
              syncSession={syncSession}
              syncParticipants={syncParticipants}
              presenceMap={presenceMap}
              onOpenSync={onOpenSync}
              onLeaveSync={() => { onLeaveSync(); setSoloMode(false); }}
              onEndSync={() => { onEndSync(); setSoloMode(false); }}
              onTransferLeader={onTransferLeader}
              onKickParticipant={onKickParticipant}
              onSetStatus={onSetStatus}
              currentTaskHint={currentTaskHint}
            />
          </div>

          <aside className="space-y-4">
            {/* When in a synced session, show other active team sessions too. */}
            {inSession && activeTeamSessions.length > 0 && (
              <div className={`rounded-2xl border p-4 ${dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"}`}>
                <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${dark ? "text-slate-400" : "text-slate-500"}`}>
                  Other team sessions
                </h3>
                <ul className="space-y-1.5">
                  {activeTeamSessions.filter((s) => s.id !== syncSession.id).map((s) => (
                    <li key={s.id} className={`flex items-center gap-2 text-xs ${dark ? "text-slate-300" : "text-slate-700"}`}>
                      <Timer className="w-3 h-3 shrink-0" />
                      <span className="flex-1 truncate">{s.leader_name}</span>
                      <span className={dark ? "text-slate-500" : "text-slate-400"}>{s.participant_count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className={`rounded-2xl border p-4 ${dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"}`}>
              <h3 className={`text-xs font-semibold uppercase tracking-wider mb-2 ${dark ? "text-slate-400" : "text-slate-500"}`}>
                Your status
              </h3>
              <p className={`text-sm font-semibold ${dark ? "text-slate-200" : "text-slate-800"}`}>{presenceLabel}</p>
              {settings.status && (
                <p className={`text-sm mt-1 truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
                  {settings.status}
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
