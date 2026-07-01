import { Timer, Users } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { useVideoCall } from "../context/VideoCallContext";
import { usePomodoro } from "../pomodoro/PomodoroContext";

// Slim pomodoro pull-tab docked to the right edge. Replaces the old floating FAB:
// a small clock tab that opens the PomodoroSurface on click, so it never covers
// content (the app reserves a little right-edge padding for it). When a timer is
// running the tab tints accent and shows the remaining minutes, so it stays a
// glanceable indicator without a big button.
function modeLabel(m) {
  if (m === "shortBreak") return "Short";
  if (m === "longBreak") return "Long";
  return "Focus";
}

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function PomodoroFab({ onToggle }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { mode, secondsLeft, isRunning } = usePomodoro();
  const { syncSession } = useSyncSession();
  const { call, stageEl } = useVideoCall();

  const pipActive = !!call && !stageEl;
  const synced = !!syncSession;
  const showTimer = isRunning;
  const safeSeconds = Number.isFinite(secondsLeft) ? secondsLeft : 0;
  const minsLeft = Math.max(0, Math.ceil(safeSeconds / 60));

  // Vertical position: clear the mobile BottomNav (hidden at xl) and lift above a
  // bottom-right call PiP when one is showing.
  const bottomCls = pipActive
    ? "bottom-[15rem] xl:bottom-[14rem]"
    : "bottom-[calc(5rem+env(safe-area-inset-bottom))] xl:bottom-6";

  const idleCls = dark
    ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-300 hover:text-white"
    : "bg-white border-slate-200 text-slate-500 hover:text-slate-800";

  return (
    <button
      type="button"
      data-pomodoro-tab=""
      onClick={() => onToggle?.()}
      title={showTimer ? `${modeLabel(mode)} · ${formatTime(safeSeconds)} left — open pomodoro` : "Open pomodoro"}
      aria-label={showTimer ? `${modeLabel(mode)} timer, ${formatTime(safeSeconds)} remaining — open pomodoro` : "Open pomodoro"}
      className={`fixed right-0 z-[111] inline-flex flex-col items-center justify-center gap-0.5 w-6 rounded-l-lg border border-r-0 shadow-md transition-colors ${bottomCls} ${
        showTimer
          ? "h-14 bg-[var(--color-accent)] border-[var(--color-accent)] text-white"
          : `h-12 ${idleCls}`
      }`}
    >
      {showTimer && synced ? <Users className="w-4 h-4" /> : <Timer className="w-4 h-4" />}
      {showTimer && (
        <span className="text-[9px] font-bold tabular-nums leading-none">{minsLeft}<span className="text-[7px] opacity-80">m</span></span>
      )}
    </button>
  );
}
