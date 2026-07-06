import { useEffect, useRef, useState } from "react";
import { ArrowUpDown, Check } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { PARTICIPANT_SORTS } from "../../lib/participantSort";
import { useParticipantSort } from "../../hooks/useParticipantSort";

// Compact "Sort: …" dropdown for the participant lists. Writes the shared
// participant-sort choice, so every list updates together. `iconOnly` drops
// the label for tight spots (e.g. the office sidebar widget header).
export default function ParticipantSortPicker({ iconOnly = false, className = "" }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [mode, setMode] = useParticipantSort();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = PARTICIPANT_SORTS.find((s) => s.key === mode) || PARTICIPANT_SORTS[0];

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Sort by ${active.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 min-h-[44px] sm:min-h-0 rounded-md transition-colors ${
          dark
            ? "text-slate-400 hover:text-slate-200 hover:bg-[var(--color-surface-raised)]"
            : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
        }`}
      >
        <ArrowUpDown className="w-3 h-3 shrink-0" />
        {!iconOnly && <span className="normal-case tracking-normal">{active.label}</span>}
      </button>
      {open && (
        <div
          role="listbox"
          className={`absolute right-0 z-20 mt-1 min-w-[140px] rounded-lg border py-1 shadow-lg ${
            dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
          }`}
        >
          {PARTICIPANT_SORTS.map((s) => {
            const selected = s.key === mode;
            return (
              <button
                key={s.key}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setMode(s.key);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 min-h-[44px] sm:min-h-0 text-left text-[11px] transition-colors ${
                  selected
                    ? "text-[var(--color-accent)] font-semibold"
                    : dark
                      ? "text-slate-300 hover:bg-[var(--color-surface-raised)]"
                      : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {s.label}
                {selected && <Check className="w-3 h-3 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
