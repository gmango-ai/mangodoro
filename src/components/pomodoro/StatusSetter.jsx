import { useEffect, useState } from "react";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { useResolvedSelf } from "../../hooks/useResolvedSelf";
import { availabilityDot, availabilityLabel } from "../../lib/presence";
import { applyStatusOverride } from "../../lib/statusActions";

// Click-to-expand status editor on the pomodoro surface. Reads the live resolved
// status (useResolvedSelf) and writes the unified manual override
// (applyStatusOverride) — the SAME model as the nav StatusChip, so setting your
// status here propagates everywhere. currentTaskHint pulls whatever you're
// clocked into as the message in one click.
const PRESETS = ["online", "focusing", "meeting", "lunch", "commuting"];

export default function StatusSetter({ currentTaskHint = "" }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { session, updateStatus } = useApp();
  const { syncSession, setStatus } = useSyncSession();
  const { resolved } = useResolvedSelf();
  const userId = session?.user?.id;

  const availability = resolved?.availability || "offline";
  const overridden = !!resolved?.override;
  const message = resolved?.override?.message || "";

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message);
  useEffect(() => { if (!editing) setDraft(message); }, [message, editing]);

  const write = (avail) =>
    applyStatusOverride({ availability: avail, message: draft.trim() || null, userId, syncSession, updateStatus, setStatus });
  const setPreset = (a) => write(a);
  const save = () => { write(overridden ? availability : "online"); setEditing(false); };
  const cancel = () => { setDraft(message); setEditing(false); };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(message); setEditing(true); }}
        className={`w-full flex items-center gap-2 text-left text-[11px] px-3 py-2 min-h-[44px] sm:min-h-0 rounded-lg border transition-colors ${
          dark
            ? "border-[var(--color-border)] bg-[var(--color-surface)] text-slate-300 hover:border-[var(--color-accent)]"
            : "bg-white border-slate-200 text-slate-700 hover:border-[var(--color-accent)]"
        }`}
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${availabilityDot(availability)}`} />
        <span className={`shrink-0 font-semibold ${dark ? "text-slate-200" : "text-slate-800"}`}>
          {availabilityLabel(availability)}
        </span>
        <span className="truncate">
          {message
            ? <>· {message}</>
            : <span className={dark ? "text-slate-500 italic" : "text-slate-400 italic"}>+ add status</span>}
        </span>
      </button>
    );
  }

  return (
    <div className={`rounded-lg border p-2.5 space-y-2 ${
      dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "bg-white border-slate-200"
    }`}>
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((a) => {
          const active = overridden && availability === a;
          return (
            <button
              key={a}
              type="button"
              onClick={() => setPreset(a)}
              className={`inline-flex items-center gap-1.5 px-2 py-1 min-h-[44px] sm:min-h-0 rounded-md text-[10px] font-semibold transition-colors ${
                active
                  ? dark ? "bg-slate-700 text-slate-100" : "bg-slate-100 text-slate-800 shadow-sm"
                  : dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${availabilityDot(a)}`} />
              {availabilityLabel(a)}
            </button>
          );
        })}
      </div>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="What are you working on?"
        maxLength={80}
        autoFocus
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
        className={`w-full h-11 sm:h-9 px-3 rounded-md border text-xs ${
          dark
            ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500"
            : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
        }`}
      />
      <div className="flex items-center gap-1.5">
        {currentTaskHint && (
          <button
            type="button"
            onClick={() => setDraft(currentTaskHint)}
            title="Use what you're clocked into"
            className={`inline-flex items-center text-[10px] font-semibold px-2 py-1 min-h-[44px] sm:min-h-0 rounded-md ${
              dark ? "bg-[var(--color-surface-raised)] text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            Use current task
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={cancel}
          className={`inline-flex items-center justify-center min-h-[44px] sm:min-h-0 text-[11px] font-semibold px-3 py-1.5 rounded-md ${
            dark ? "text-slate-400 hover:bg-[var(--color-surface-raised)]" : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          Close
        </button>
        <button
          type="button"
          onClick={save}
          className="inline-flex items-center justify-center min-h-[44px] sm:min-h-0 text-[11px] font-semibold px-3 py-1.5 rounded-md text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
        >
          Save
        </button>
      </div>
    </div>
  );
}
