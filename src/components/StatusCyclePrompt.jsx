import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { usePomodoro } from "../pomodoro/PomodoroContext";
import { useApp } from "../context/AppContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { useTheme } from "../context/ThemeContext";
import { availabilityDot, availabilityLabel } from "../lib/presence";
import { applyStatusOverride, clearStatusOverride } from "../lib/statusActions";
import { readStatusOnCycle } from "../lib/statusCyclePref";

// At the end of each Pomodoro phase (focus or break), per the status-at-cycle
// preference (Settings → "Status at Pomodoro end"): clear your manual status,
// or pop a quick prompt to clear / update it. Transition detection mirrors
// ReflectionPrompt. Writes bridge to the legacy surfaces too (room list).
const BREAKS = new Set(["shortBreak", "longBreak"]);
const QUICK = ["available", "focusing", "away", "off"];

export default function StatusCyclePrompt() {
  const { mode } = usePomodoro();
  const { session, updateStatus } = useApp();
  const { syncSession, setStatus } = useSyncSession();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const userId = session?.user?.id;
  const prevRef = useRef(mode);
  const [prompt, setPrompt] = useState(null); // { phase: 'focus'|'break' } | null

  const doClear = () => {
    clearStatusOverride({ userId, syncSession, updateStatus, setStatus });
    setPrompt(null);
  };

  const doSet = (availability) => {
    applyStatusOverride({ availability, message: null, expiresAt: null, userId, syncSession, updateStatus, setStatus });
    setPrompt(null);
  };

  useEffect(() => {
    const prev = prevRef.current;
    if (prev === mode) return;
    prevRef.current = mode;
    const pref = readStatusOnCycle();
    if (pref === "off") return;
    const focusEnded = prev === "work" && BREAKS.has(mode);
    const breakEnded = BREAKS.has(prev) && mode === "work";
    if (!focusEnded && !breakEnded) return;
    if (pref === "clear") { doClear(); return; }
    if (pref === "ask") setPrompt({ phase: focusEnded ? "focus" : "break" });
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-dismiss if ignored, so it doesn't linger into the next phase.
  useEffect(() => {
    if (!prompt) return undefined;
    const id = setTimeout(() => setPrompt(null), 20000);
    return () => clearTimeout(id);
  }, [prompt]);

  if (!prompt) return null;

  return (
    <div
      className="fixed left-1/2 z-[9997] w-[min(23rem,calc(100vw-1.5rem))] -translate-x-1/2"
      style={{ bottom: "calc(1rem + var(--bottom-inset))" }}
    >
      <div
        className="rounded-2xl border p-3 shadow-xl"
        style={{ background: dark ? "var(--color-surface)" : "#fff", borderColor: dark ? "var(--color-border)" : "rgb(226,232,240)" }}
      >
        <div className="mb-2 flex items-center gap-2">
          <span className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
            {prompt.phase === "focus" ? "Focus block done — update your status?" : "Break's over — update your status?"}
          </span>
          <button
            type="button"
            onClick={() => setPrompt(null)}
            aria-label="Keep current status"
            className={`ml-auto ${dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {QUICK.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => doSet(a)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                dark ? "border-[var(--color-border)] text-slate-200 hover:bg-white/10" : "border-slate-200 text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${availabilityDot(a)}`} />
              {availabilityLabel(a)}
            </button>
          ))}
          <button
            type="button"
            onClick={doClear}
            className={`ml-auto rounded-full px-2.5 py-1 text-xs font-medium ${dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"}`}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
