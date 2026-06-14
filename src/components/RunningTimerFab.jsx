import { useLocation } from "react-router-dom";
import { usePomodoro } from "../pomodoro/PomodoroContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { useTheme } from "../context/ThemeContext";
import { Play, Timer, Users } from "lucide-react";

// Persistent quick-launch button that hovers in the bottom-right of
// every page except /pomodoro itself. Three visual states:
//   1) idle      → "Play" icon, neutral. Tap = open floating timer.
//   2) running   → mode label + remaining time. Tap = open floating timer.
//   3) synced    → adds a "people" indicator + uses the sync color.
//
// Tap opens the floating PomodoroTimer modal (the same one Nav's
// quick-timer button uses), not /pomodoro — the modal keeps the user
// in context with the page they were on. Designed to extend later
// into a multi-session picker once a user can hold multiple sessions
// across orgs.
export default function RunningTimerFab({ onOpen }) {
  const location = useLocation();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { mode, secondsLeft, isRunning } = usePomodoro();
  const { syncSession } = useSyncSession();

  // Hide on /pomodoro — the user can already see the timer there.
  if (location.pathname.startsWith("/pomodoro")) return null;

  const synced = !!syncSession;
  const showTimer = isRunning;
  const label = showTimer ? formatTime(secondsLeft) : null;
  const subLabel = showTimer ? modeLabel(mode) : "Start";

  const baseCls = "fixed z-40 flex items-center gap-2.5 rounded-full shadow-lg transition-all active:scale-[0.97]";
  const positionCls = "bottom-5 right-5";
  // On mobile we respect the safe-area inset so the FAB doesn't sit
  // under the home indicator.
  const safeAreaStyle = {
    bottom: "max(1.25rem, env(safe-area-inset-bottom, 0))",
  };

  const colorCls = showTimer
    ? "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] shadow-[var(--color-accent)]/30"
    : dark
      ? "bg-[var(--color-surface-raised)] text-slate-100 border border-[var(--color-border)] hover:bg-slate-700/40"
      : "bg-white text-slate-800 border border-slate-200 hover:bg-slate-50";

  return (
    <button
      type="button"
      onClick={() => onOpen?.()}
      className={`${baseCls} ${positionCls} ${colorCls} ${showTimer ? "px-4 py-2.5" : "px-3.5 py-2.5"}`}
      style={safeAreaStyle}
      aria-label={showTimer ? `${subLabel} timer — ${label} remaining` : "Open pomodoro"}
    >
      {showTimer ? (
        synced ? <Users className="w-4 h-4 shrink-0" /> : <Timer className="w-4 h-4 shrink-0" />
      ) : (
        <Play className="w-4 h-4 shrink-0" fill="currentColor" />
      )}
      <span className="flex flex-col items-start leading-tight">
        <span className="text-[10px] uppercase tracking-wider opacity-80">{subLabel}</span>
        {label && (
          <span className="text-sm font-mono font-bold tabular-nums">{label}</span>
        )}
      </span>
    </button>
  );
}

function modeLabel(m) {
  if (m === "shortBreak") return "Short break";
  if (m === "longBreak") return "Long break";
  return "Focus";
}

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
