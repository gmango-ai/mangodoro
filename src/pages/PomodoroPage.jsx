import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useTheme } from "../context/ThemeContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { Button } from "@/components/ui/button";
import { Users as UsersIcon, Timer, ArrowRight } from "lucide-react";
import PomodoroSurface from "../components/pomodoro/PomodoroSurface";
import GettingStartedChecklist from "../components/tour/GettingStartedChecklist";
import GoalsList from "../components/GoalsList";
import { Skeleton, SkeletonCard } from "../components/Skeleton";
import { useWeekGoals } from "../hooks/useWeekGoals";

// /pomodoro is the timer, full stop. Personal by default — no friction
// to start a focus block. Picking a room or syncing with a teammate
// lives on /office; this page just renders the timer (which already
// flips into synced display when SyncSessionContext has a session).
export default function PomodoroPage({ session, onOpenSync }) {
  const { settings, clockIn, projects, dataLoaded } = useApp();
  const { activeTeamId, activeTeamSessions } = useTeam();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { syncSession } = useSyncSession();
  const dark = theme === "dark";

  const inSession = !!syncSession;

  const currentTaskHint = (() => {
    if (!clockIn) return "";
    const projId = clockIn.projectIds?.[0];
    const proj = projId ? projects?.find((p) => p.id === projId)?.name : null;
    const desc = (clockIn.description || "").trim();
    if (proj && desc) return `${proj} — ${desc}`;
    if (proj) return proj;
    if (desc) return desc;
    return "";
  })();

  function modeLabel(m) {
    return m === "shortBreak"
      ? "Short break"
      : m === "longBreak"
      ? "Long break"
      : "Focus";
  }
  function timeLeft(s) {
    if (!s) return "";
    if (!s.is_running || !s.ends_at)
      return `${Math.ceil((s.remaining_seconds || 0) / 60)}m`;
    return `${Math.max(
      0,
      Math.ceil((new Date(s.ends_at).getTime() - Date.now()) / 60000)
    )}m left`;
  }

  // Current week's retro goals for the user's tagged departments —
  // glance-able context above the timer keeps the goal in mind during
  // a focus block.
  const { goals: weekGoals } = useWeekGoals();

  // Other sessions to surface in the sidebar. When solo, show all
  // active rooms; when synced, exclude the one we're in.
  const otherSessions = (activeTeamSessions || []).filter(
    (s) => !syncSession || s.id !== syncSession.id
  );

  // Online-count card: distinct users across every active session in
  // the org. Dedupes in case anyone's somehow in two at once.
  const onlineCount = (() => {
    const ids = new Set();
    for (const s of activeTeamSessions || []) {
      for (const o of s.occupants || []) if (o.user_id) ids.add(o.user_id);
    }
    return ids.size;
  })();

  // Where the "Sync" button goes — into the office for team users
  // (room picker), or the ad-hoc modal for solo users who just want
  // to share a code with a coworker.
  function handleSyncClick() {
    if (activeTeamId) navigate("/office");
    else onOpenSync?.();
  }

  if (!dataLoaded) {
    return (
      <div
        className={`max-w-4xl mx-auto px-4 py-6 ${
          dark ? "text-slate-100" : "text-slate-800"
        }`}
        aria-busy="true"
        aria-label="Loading pomodoro"
      >
        <Skeleton className="h-7 w-32 mb-4" />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <SkeletonCard className="p-6 space-y-4">
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-9 w-40 mx-auto rounded-md" />
            </SkeletonCard>
          </div>
          <SkeletonCard className="p-4 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-24" />
          </SkeletonCard>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`max-w-4xl mx-auto px-4 py-6 ${
        dark ? "text-slate-100" : "text-slate-800"
      }`}
    >
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Pomodoro</h1>
        {!inSession && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncClick}
            className="h-8 text-xs"
          >
            <UsersIcon className="w-3.5 h-3.5 mr-1.5" />
            {activeTeamId ? "Sync with office" : "Start sync session"}
            <ArrowRight className="w-3 h-3 ml-1.5 opacity-60" />
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 space-y-3">
          <PomodoroSurface
            variant="page"
            onOpenSync={onOpenSync}
            currentTaskHint={currentTaskHint}
          />
        </div>

        <aside className="space-y-4">
          {/* Getting-started checklist — self-hides once every visible item is
              done. This is the default landing, so it's where new users see it. */}
          <GettingStartedChecklist />
          <div
            className={`rounded-2xl border p-4 ${
              dark
                ? "bg-[var(--color-surface)] border-[var(--color-border)]"
                : "bg-white border-slate-200"
            }`}
          >
            <h3
              className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
                dark ? "text-slate-400" : "text-slate-500"
              }`}
            >
              Online now
            </h3>
            <div className="flex items-baseline gap-2">
              <span
                className={`text-2xl font-bold font-mono ${
                  onlineCount > 0
                    ? "text-[var(--color-accent)]"
                    : dark
                    ? "text-slate-500"
                    : "text-slate-400"
                }`}
              >
                {onlineCount}
              </span>
              <span
                className={`text-xs ${
                  dark ? "text-slate-400" : "text-slate-500"
                }`}
              >
                {onlineCount === 1
                  ? "person in a session"
                  : "people in sessions"}
              </span>
            </div>
            {(activeTeamSessions?.length || 0) > 0 && (
              <p
                className={`text-[11px] mt-1 ${
                  dark ? "text-slate-500" : "text-slate-400"
                }`}
              >
                across {activeTeamSessions.length} active{" "}
                {activeTeamSessions.length === 1 ? "room" : "rooms"}
              </p>
            )}
          </div>

          {otherSessions.length > 0 && (
            <div
              className={`rounded-2xl border p-4 ${
                dark
                  ? "bg-[var(--color-surface)] border-[var(--color-border)]"
                  : "bg-white border-slate-200"
              }`}
            >
              <h3
                className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
                  dark ? "text-slate-400" : "text-slate-500"
                }`}
              >
                {inSession ? "Other team sessions" : "Active sessions"}
              </h3>
              <ul className="space-y-1.5">
                {otherSessions.map((s) => (
                  <li
                    key={s.id}
                    className={`flex items-center gap-2 text-xs ${
                      dark ? "text-slate-300" : "text-slate-700"
                    }`}
                  >
                    <Timer className="w-3 h-3 shrink-0" />
                    <span className="flex-1 truncate">
                      {s.leader_name}
                      {s.room_id && (
                        <span
                          className={`ml-1 ${
                            dark ? "text-slate-500" : "text-slate-400"
                          }`}
                        >
                          · {modeLabel(s.mode)} · {timeLeft(s)}
                        </span>
                      )}
                    </span>
                    <span
                      className={dark ? "text-slate-500" : "text-slate-400"}
                    >
                      {s.participant_count}
                    </span>
                  </li>
                ))}
              </ul>
              {!inSession && activeTeamId && (
                <Link
                  to="/office"
                  className={`inline-flex items-center gap-1 text-[11px] mt-3 hover:underline ${
                    dark ? "text-slate-400" : "text-slate-500"
                  }`}
                >
                  Open office <ArrowRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          )}

          {weekGoals.length > 0 && (
            <div
              className={`rounded-2xl border p-4 ${
                dark
                  ? "bg-[var(--color-surface)] border-[var(--color-border)]"
                  : "bg-white border-slate-200"
              }`}
            >
              <h3
                className={`text-xs font-semibold uppercase tracking-wider mb-2 ${
                  dark ? "text-slate-400" : "text-slate-500"
                }`}
              >
                Current Goals
              </h3>
              <GoalsList goals={weekGoals} dark={dark} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
