import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { setUserStatus } from "../../lib/syncSession";

const PRESENCE = [
  { key: "active", label: "Active", dot: "bg-emerald-500" },
  { key: "available", label: "Available", dot: "bg-sky-500" },
  { key: "heads_down", label: "Heads-down", dot: "bg-violet-500" },
  { key: "in_meeting", label: "Meeting", dot: "bg-rose-500" },
  { key: "away", label: "Away", dot: "bg-amber-500" },
];

// Status + presence editor matched to the redesign mockup:
//   ● Active ▾   Making Pomodoro Great Again!
//
// One labeled row. Presence dot + dropdown on the left, free-form
// status text on the right (auto-saves on blur / Enter). Works
// whether or not the user is in a sync session — when in one,
// writes flow through the participant RPC so teammates see the
// update live; when not, falls back to the global set_user_status
// RPC so the office tile still updates.
export default function StatusSetter() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { settings, session: appSession } = useApp();
  const { syncSession, syncParticipants, setStatus: setSyncStatus } = useSyncSession();
  const userId = appSession?.user?.id;

  const me = (syncParticipants || []).find((p) => p.user_id === userId);
  const myStatus = (me?.status ?? settings?.status) || "";
  const myPresence = (me?.presence_state ?? settings?.presenceState) || "active";

  const [draft, setDraft] = useState(myStatus);
  const [presenceOpen, setPresenceOpen] = useState(false);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Sync local draft with remote whenever the upstream value changes
  // (e.g. another device updated the status). Skip if the user is
  // mid-edit to avoid clobbering their input.
  useEffect(() => {
    if (typeof document !== "undefined" && document.activeElement !== inputRef.current) {
      setDraft(myStatus);
    }
  }, [myStatus]);

  // Close the presence dropdown on outside click.
  useEffect(() => {
    if (!presenceOpen) return;
    const onClick = (e) => {
      if (!containerRef.current?.contains(e.target)) setPresenceOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [presenceOpen]);

  const apply = async (patch) => {
    if (syncSession && setSyncStatus) {
      await setSyncStatus(patch);
    } else {
      await setUserStatus(patch);
    }
  };
  const applyPresence = (state) => apply({ presenceState: state });
  const applyStatus = (value) => apply({ status: value });

  const presence = PRESENCE.find((p) => p.key === myPresence) || PRESENCE[0];

  return (
    <div ref={containerRef} className="flex items-center gap-3 min-w-0">
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setPresenceOpen((v) => !v)}
          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-semibold transition-colors ${
            dark
              ? "border-[var(--color-border)] bg-[var(--color-surface-raised)] text-slate-100 hover:border-[var(--color-accent)]"
              : "border-slate-200 bg-white text-slate-700 hover:border-[var(--color-accent)]"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${presence.dot}`} />
          {presence.label}
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>
        {presenceOpen && (
          <div
            className={`absolute z-10 mt-1 left-0 min-w-[140px] rounded-md border shadow-lg overflow-hidden ${
              dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-white"
            }`}
          >
            {PRESENCE.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => { applyPresence(opt.key); setPresenceOpen(false); }}
                className={`flex items-center gap-2 w-full px-2 py-1.5 text-xs text-left ${
                  myPresence === opt.key
                    ? dark ? "bg-[var(--color-surface-raised)] text-slate-100" : "bg-slate-50 text-slate-800"
                    : dark ? "text-slate-300 hover:bg-[var(--color-surface-raised)]" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${opt.dot}`} />
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== myStatus) applyStatus(draft); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.currentTarget.blur(); }
          if (e.key === "Escape") { setDraft(myStatus); e.currentTarget.blur(); }
        }}
        placeholder="What are you working on?"
        maxLength={80}
        className={`flex-1 min-w-0 text-xs bg-transparent border-none outline-none ${
          dark ? "text-slate-200 placeholder:text-slate-500" : "text-slate-700 placeholder:text-slate-400"
        }`}
      />
    </div>
  );
}
