import { Play, Pause, Timer, Users } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useTheme } from "../context/ThemeContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { useVideoCall } from "../context/VideoCallContext";
import { usePomodoro } from "../pomodoro/PomodoroContext";

// Floating pomodoro button. The nav had a Pomodoro link + a RunningTimerPill;
// both are gone from the (busy) nav and folded into this one FAB, which both
// surfaces the live timer state and opens the floating PomodoroSurface on click.
//
// States mirror the old pill:
//   running        → an accent pill "FOCUS · 24:13" (pulsing), synced shows a
//                    people icon
//   paused / idle  → a compact circular Timer button
//
// Positioned bottom-right, clear of the mobile BottomNav; when a call is in
// picture-in-picture (also bottom-right) it lifts above the PiP so the two never
// overlap.
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

export default function PomodoroFab({ onOpen }) {
  const location = useLocation();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { mode, secondsLeft, isRunning } = usePomodoro();
  const { syncSession } = useSyncSession();
  const { call, stageEl } = useVideoCall();

  // A call renders as a bottom-right PiP when there's a call but no on-page stage
  // to host it. Lift the FAB above the PiP (≈200px tall + margins) when so.
  const pipActive = !!call && !stageEl;
  const synced = !!syncSession;
  const showTimer = isRunning;
  const safeSeconds = Number.isFinite(secondsLeft) ? secondsLeft : 0;
  const onPomodoroPage = location.pathname.startsWith("/pomodoro");

  // Bottom offset: clear the BottomNav on touch/small screens (it's hidden at
  // xl), and lift above a PiP when one is showing.
  const bottomCls = pipActive
    ? "bottom-[15rem] xl:bottom-[14rem]"
    : "bottom-[calc(5rem+env(safe-area-inset-bottom))] xl:bottom-6";

  const activeCls = "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]";
  const idleCls = dark
    ? "border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-slate-200 hover:border-[var(--color-accent)]"
    : "border border-slate-200 bg-white text-slate-700 hover:border-[var(--color-accent)]";

  return (
    <button
      type="button"
      onClick={() => onOpen?.()}
      title={showTimer ? `${modeLabel(mode)} timer — ${formatTime(safeSeconds)} left` : "Open pomodoro"}
      aria-label={showTimer ? `${modeLabel(mode)} timer, ${formatTime(safeSeconds)} remaining` : "Open pomodoro"}
      className={`fixed right-4 sm:right-6 z-[110] shadow-lg transition-all ${bottomCls} ${
        showTimer
          ? `inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold ${activeCls}`
          : `inline-flex items-center justify-center w-14 h-14 rounded-full ${idleCls}`
      } ${onPomodoroPage ? "opacity-90" : ""}`}
    >
      {showTimer ? (
        <>
          {synced
            ? <Users className="w-4 h-4" />
            : (isRunning
              ? <Pause className="w-4 h-4" fill="currentColor" />
              : <Timer className="w-4 h-4" />)}
          <span className="uppercase tracking-wider text-[10px] opacity-90">{modeLabel(mode)}</span>
          <span className="text-sm font-display font-bold tabular-nums">{formatTime(safeSeconds)}</span>
        </>
      ) : (
        <Play className="w-6 h-6" fill="currentColor" />
      )}
    </button>
  );
}
