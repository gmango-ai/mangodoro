import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";

export default function ClockBanner() {
  const {
    clockIn, clockedElapsed, breakElapsed,
    startClockBreak, endClockBreak,
    clockOutAndFill, projects, clockedTick,
  } = useApp();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();

  // clockedTick keeps the elapsed time live
  void clockedTick;

  if (!clockIn) return null;

  const onBreak = !!clockIn.activeBreak;
  const entryProjects = (clockIn.projectIds || [])
    .map((id) => projects.find((p) => p.id === id))
    .filter(Boolean);

  function handleStop() {
    clockOutAndFill();
    navigate("/");
  }

  return (
    <div className={`fixed bottom-0 left-0 right-0 z-50 border-t backdrop-blur-xl ${
      dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white/95 border-slate-200"
    }`}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Left: status indicator + time + projects */}
        <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
            onBreak ? "bg-orange-400" : "bg-emerald-400 animate-pulse"
          }`} />
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-base font-display font-bold tabular-nums flex-shrink-0 ${dark ? "text-white" : "text-slate-800"}`}>
                {clockedElapsed()}
              </span>
              {onBreak && (
                <span className={`text-xs font-medium flex-shrink-0 px-2 py-0.5 rounded-full ${
                  dark ? "bg-orange-500/20 text-orange-400" : "bg-orange-100 text-orange-600"
                }`}>
                  break · {breakElapsed()}
                </span>
              )}
            </div>
            {entryProjects.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                {entryProjects.map((p) => (
                  <span
                    key={p.id}
                    className="text-xs px-2 py-0.5 rounded-full border font-medium flex-shrink-0"
                    style={{ backgroundColor: p.color + "22", color: p.color, borderColor: p.color + "44" }}
                  >
                    {p.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: large pause + stop buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Big pause/break button */}
          <button
            onClick={onBreak ? endClockBreak : startClockBreak}
            className={`flex items-center gap-2 font-semibold px-5 py-2.5 rounded-xl border transition-colors text-sm ${
              onBreak
                ? dark
                  ? "border-orange-500/60 text-orange-300 bg-orange-500/15 hover:bg-orange-500/25"
                  : "border-orange-400 text-orange-700 bg-orange-50 hover:bg-orange-100"
                : dark
                  ? "border-slate-500/60 text-slate-200 bg-slate-700/50 hover:bg-slate-700/80 hover:border-slate-400"
                  : "border-slate-300 text-slate-700 bg-slate-50 hover:bg-slate-100 hover:border-slate-400"
            }`}
          >
            {onBreak ? (
              <>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                </svg>
                Resume
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                Pause
              </>
            )}
          </button>

          {/* Stop button */}
          <button
            onClick={handleStop}
            className="flex items-center gap-2 font-semibold px-5 py-2.5 rounded-xl border transition-colors text-sm border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-light)] hover:bg-[var(--color-accent-light-hover)]"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
            </svg>
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}
