import { useEffect, useState } from "react";
import { Square } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { onAlarmStateChange, stopCompletionSound } from "../../lib/pomodoroSound";

/** Shown while a completion alarm is ringing (especially repeat ∞). */
export default function AlarmStopBanner() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [playing, setPlaying] = useState(false);

  useEffect(() => onAlarmStateChange(setPlaying), []);

  if (!playing) return null;

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
        dark
          ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
          : "border-amber-300 bg-amber-50 text-amber-900"
      }`}
    >
      <span>Alarm playing</span>
      <button
        type="button"
        onClick={() => stopCompletionSound()}
        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 transition-colors ${
          dark
            ? "bg-amber-500/20 hover:bg-amber-500/30 text-amber-100"
            : "bg-amber-200/80 hover:bg-amber-300 text-amber-950"
        }`}
      >
        <Square className="w-3 h-3" />
        Stop
      </button>
    </div>
  );
}
