import { ChevronDown } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useTeam } from "../../context/TeamContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";

// Team/session identity header: a colored team avatar + name + live
// state line. The live state line tells the user at a glance:
//
//   not synced:     team name only
//   you're leading: "● Live · N in session"
//   someone leads:  "Synced · {leader name} is leading"
//
// `interactive` (default false) controls whether the dropdown chevron
// is rendered. We surface it only on surfaces that benefit from
// team/sync identity (popover, floating); the in-page surface inside
// the main app already has a Nav-level team switcher.
export default function TeamIdentityHeader({ interactive = false }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { activeTeam } = useTeam();
  const { syncSession, syncParticipants } = useSyncSession();
  const { isController } = usePomodoro();

  if (!activeTeam) return null;

  const accent = activeTeam.color || "#14b8a6";
  const iconUrl = activeTeam.icon_url || "";
  const initial = (activeTeam.name || "?")[0].toUpperCase();

  let stateLine = null;
  if (syncSession) {
    if (isController) {
      const n = (syncParticipants || []).length;
      stateLine = (
        <p className="text-[11px] inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className={`font-semibold ${dark ? "text-emerald-300" : "text-emerald-700"}`}>
            Live
          </span>
          <span className={dark ? "text-slate-500" : "text-slate-400"}>·</span>
          <span className={dark ? "text-slate-300" : "text-slate-600"}>
            {n} in session
          </span>
        </p>
      );
    } else {
      const leader = (syncParticipants || []).find((p) => p.user_id === syncSession.leader_id);
      const leaderName = leader?.display_name || "Someone";
      stateLine = (
        <p className={`text-[11px] ${dark ? "text-slate-400" : "text-slate-500"}`}>
          Synced <span className="opacity-60">·</span>{" "}
          <span className={`font-semibold ${dark ? "text-slate-200" : "text-slate-700"}`}>
            {leaderName}
          </span>{" "}
          is leading
        </p>
      );
    }
  }

  return (
    <div className="flex items-center gap-2.5">
      {/* Team avatar — colored square with icon or team initial */}
      <div
        className="w-9 h-9 rounded-lg shrink-0 inline-flex items-center justify-center text-white font-bold text-sm shadow-sm"
        style={{ background: accent }}
        aria-hidden
      >
        {iconUrl ? (
          <img src={iconUrl} alt="" className="w-full h-full object-cover rounded-lg" />
        ) : (
          initial
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 min-w-0">
          <span className={`text-sm font-bold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
            {activeTeam.name}
          </span>
          {interactive && (
            <ChevronDown className={`w-3.5 h-3.5 shrink-0 ${dark ? "text-slate-500" : "text-slate-400"}`} />
          )}
        </div>
        {stateLine}
      </div>
    </div>
  );
}
