import { useRef, useState } from "react";
import { Play, Pause, Timer, Users, ChevronLeft, ChevronRight } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { useVideoCall } from "../context/VideoCallContext";
import { usePomodoro } from "../pomodoro/PomodoroContext";

// Floating pomodoro button — opens the PomodoroSurface and surfaces the live
// timer. It stays FULLY off-screen by default so it never covers content; a
// small edge tab (an arrow) shows/hides it, triggered by a click OR resting the
// pointer on the tab for 3 seconds. While hidden, a running timer shows as a
// pulsing dot on the tab so you still know one's going.
//
// Lifts above a bottom-right video PiP so the two never overlap.
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
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { mode, secondsLeft, isRunning } = usePomodoro();
  const { syncSession } = useSyncSession();
  const { call, stageEl } = useVideoCall();

  const [shown, setShown] = useState(false);
  // Hover-for-3s toggle. `fired` guards against double-firing (a click plus the
  // pending hover timer) and is reset on each fresh hover / cleared on leave.
  const hoverTimer = useRef(null);
  const firedRef = useRef(false);
  const toggle = () => { firedRef.current = true; setShown((v) => !v); };
  const onTabEnter = () => {
    firedRef.current = false;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      if (!firedRef.current) { firedRef.current = true; setShown((v) => !v); }
    }, 3000);
  };
  const onTabLeave = () => clearTimeout(hoverTimer.current);

  const pipActive = !!call && !stageEl;
  const synced = !!syncSession;
  const showTimer = isRunning;
  const safeSeconds = Number.isFinite(secondsLeft) ? secondsLeft : 0;

  // Vertical offset: clear the BottomNav on touch/small screens (hidden at xl),
  // and lift above a bottom-right call PiP when one is showing.
  const bottomCls = pipActive
    ? "bottom-[15rem] xl:bottom-[14rem]"
    : "bottom-[calc(5rem+env(safe-area-inset-bottom))] xl:bottom-6";

  const activeCls = "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]";
  const idleCls = dark
    ? "border border-[var(--color-border)] bg-[var(--color-surface-raised)] text-slate-200 hover:border-[var(--color-accent)]"
    : "border border-slate-200 bg-white text-slate-700 hover:border-[var(--color-accent)]";

  return (
    <>
      {/* Edge tab — the only thing on screen while the FAB is hidden. */}
      <button
        type="button"
        onClick={toggle}
        onMouseEnter={onTabEnter}
        onMouseLeave={onTabLeave}
        title={shown ? "Hide the pomodoro button" : "Show the pomodoro button"}
        aria-label={shown ? "Hide the pomodoro button" : "Show the pomodoro button"}
        aria-expanded={shown}
        className={`fixed right-0 z-[111] inline-flex items-center justify-center w-5 h-12 rounded-l-lg border border-r-0 shadow-md transition-colors ${bottomCls} ${
          dark
            ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-300 hover:text-white"
            : "bg-white border-slate-200 text-slate-500 hover:text-slate-800"
        }`}
      >
        {shown ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        {showTimer && !shown && (
          <span className="absolute -top-1 -left-1 w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" aria-hidden="true" />
        )}
      </button>

      {/* The FAB — parked fully off-screen past the right edge until shown. */}
      <button
        type="button"
        onClick={() => onOpen?.()}
        tabIndex={shown ? 0 : -1}
        aria-hidden={!shown}
        title={showTimer ? `${modeLabel(mode)} timer — ${formatTime(safeSeconds)} left` : "Open pomodoro"}
        aria-label={showTimer ? `${modeLabel(mode)} timer, ${formatTime(safeSeconds)} remaining` : "Open pomodoro"}
        className={`fixed right-8 z-[110] shadow-lg transition-all duration-300 ${bottomCls} ${
          shown ? "translate-x-0 opacity-100" : "translate-x-[calc(100%+2.5rem)] opacity-0 pointer-events-none"
        } ${
          showTimer
            ? `inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-semibold ${activeCls}`
            : `inline-flex items-center justify-center w-12 h-12 rounded-full ${idleCls}`
        }`}
      >
        {showTimer ? (
          <>
            {synced
              ? <Users className="w-4 h-4" />
              : <Pause className="w-4 h-4" fill="currentColor" />}
            <span className="uppercase tracking-wider text-[10px] opacity-90">{modeLabel(mode)}</span>
            <span className="text-sm font-display font-bold tabular-nums">{formatTime(safeSeconds)}</span>
          </>
        ) : (
          <Play className="w-6 h-6" fill="currentColor" />
        )}
      </button>
    </>
  );
}
