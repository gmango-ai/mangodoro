import { useEffect, useRef, useState } from "react";
import { PenLine, X } from "lucide-react";
import { useApp } from "../context/AppContext";
import { usePomodoro } from "../pomodoro/PomodoroContext";
import { useTheme } from "../context/ThemeContext";

// "What did you work on?" capture around pomodoro phases. When a focus block
// ends (→ break) or a break ends (→ next focus) — per the user's reflect_when
// setting — pops a small prompt. Saving sets your current task/status (flows to
// the task segment + work_status), capturing the work as a byproduct of focus.
const BREAKS = new Set(["shortBreak", "longBreak"]);

export default function ReflectionPrompt() {
  const { settings, clockIn, renameCurrentTask, updateClockIn, updateStatus } = useApp();
  const { mode } = usePomodoro();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const prevRef = useRef(mode);
  const taRef = useRef(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev === mode) return;
    prevRef.current = mode;
    const when = settings?.reflectWhen || "off";
    if (when === "off") return;
    const focusEnded = prev === "work" && BREAKS.has(mode);
    const breakEnded = BREAKS.has(prev) && mode === "work";
    const show =
      (focusEnded && (when === "after_focus" || when === "both")) ||
      (breakEnded && (when === "before_focus" || when === "both"));
    if (show) {
      setText((clockIn?.description || settings?.status || "").trim());
      setOpen(true);
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (open) requestAnimationFrame(() => taRef.current?.focus()); }, [open]);

  if (!open) return null;

  const save = () => {
    const v = text.trim();
    if (v) {
      if (clockIn) { updateClockIn?.({ description: v }); renameCurrentTask?.(v); }
      else updateStatus?.({ status: v });
    }
    setOpen(false);
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
  };

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.35)" }}>
      <div
        className="w-full max-w-sm rounded-2xl border shadow-xl p-4"
        style={{ background: dark ? "var(--color-surface)" : "#fff", borderColor: dark ? "var(--color-border)" : "rgb(226,232,240)" }}
      >
        <div className="flex items-center gap-2 mb-2">
          <PenLine className="w-4 h-4 text-[var(--color-accent)]" />
          <span className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>What did you work on?</span>
          <button type="button" onClick={() => setOpen(false)} aria-label="Skip" className={`ml-auto ${dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={3}
          placeholder="A quick note on this focus block…"
          className={`w-full resize-none rounded-lg border px-3 py-2 text-sm ${dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500" : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"}`}
        />
        <div className="flex items-center justify-end gap-2 mt-2.5">
          <button type="button" onClick={() => setOpen(false)} className={`text-sm px-3 py-1.5 rounded-lg ${dark ? "text-slate-400 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"}`}>Skip</button>
          <button type="button" onClick={save} disabled={!text.trim()} className="text-sm font-semibold px-3 py-1.5 rounded-lg text-white bg-[var(--color-accent)] disabled:opacity-40">Save</button>
        </div>
      </div>
    </div>
  );
}
