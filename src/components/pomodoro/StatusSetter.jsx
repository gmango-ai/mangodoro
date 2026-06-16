import { useState } from "react";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { setUserStatus } from "../../lib/syncSession";

const PRESENCE = [
  { key: "active", label: "Active", dotLight: "bg-emerald-500", dotDark: "bg-emerald-400" },
  { key: "available", label: "Available", dotLight: "bg-sky-500", dotDark: "bg-sky-400" },
  { key: "heads_down", label: "Heads-down", dotLight: "bg-violet-500", dotDark: "bg-violet-400" },
  { key: "in_meeting", label: "Meeting", dotLight: "bg-rose-500", dotDark: "bg-rose-400" },
  { key: "away", label: "Away", dotLight: "bg-amber-500", dotDark: "bg-amber-400" },
];

// Status + presence editor. Works whether or not the user is in a sync
// session — when in one, writes flow through setSyncParticipantStatus
// (so teammates see the update live); when not, falls back to the
// global set_user_status RPC so the user's office tile still reflects
// their state.
//
// The previous version only rendered inside the sync panel and called
// the participant RPC directly; in the menubar popover this meant
// "set status" silently no-op'd whenever the user wasn't synced.
export default function StatusSetter({ currentTaskHint = "" }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { settings } = useApp();
  const { syncSession, syncParticipants, setStatus: setSyncStatus } = useSyncSession();
  const { session: appSession } = useApp();
  const userId = appSession?.user?.id;

  // Pull "my" state from the sync participant row if synced, else
  // from the user's own user_settings (which mirrors what the office
  // tiles + retros render).
  const me = (syncParticipants || []).find((p) => p.user_id === userId);
  const myStatus = (me?.status ?? settings?.status) || "";
  const myPresence = (me?.presence_state ?? settings?.presenceState) || "active";

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(myStatus);

  const presence = PRESENCE.find((p) => p.key === myPresence) || PRESENCE[0];
  const dotCls = dark ? presence.dotDark : presence.dotLight;

  const applyPresence = async (state) => {
    if (syncSession && setSyncStatus) {
      await setSyncStatus({ presenceState: state });
    } else {
      await setUserStatus({ presenceState: state });
    }
  };
  const applyStatus = async (value) => {
    if (syncSession && setSyncStatus) {
      await setSyncStatus({ status: value });
    } else {
      await setUserStatus({ status: value });
    }
  };

  if (editing) {
    return (
      <div className={`rounded-md border p-2 space-y-2 ${
        dark ? "border-[var(--color-border)] bg-[var(--color-bg)]" : "bg-white border-slate-200"
      }`}>
        <div className="flex flex-wrap gap-1">
          {PRESENCE.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => applyPresence(opt.key)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                myPresence === opt.key
                  ? dark ? "bg-slate-700 text-slate-100" : "bg-slate-100 text-slate-800 shadow-sm"
                  : dark ? "text-slate-500 hover:text-slate-300" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${dark ? opt.dotDark : opt.dotLight}`} />
              {opt.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What are you working on?"
          maxLength={80}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") { applyStatus(draft); setEditing(false); }
            if (e.key === "Escape") setEditing(false);
          }}
          className={`w-full h-8 px-2 rounded-md border text-[11px] ${
            dark
              ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500"
              : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
          }`}
        />
        <div className="flex items-center gap-1">
          {currentTaskHint && (
            <button
              type="button"
              onClick={() => setDraft(currentTaskHint)}
              title="Use what you're clocked into"
              className={`text-[10px] font-semibold px-2 py-1 rounded-md ${
                dark ? "bg-[var(--color-surface-raised)] text-slate-300 hover:bg-slate-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Use current task
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setEditing(false)}
            className={`text-[10px] font-semibold px-2 py-1 rounded-md ${
              dark ? "text-slate-400 hover:bg-[var(--color-surface-raised)]" : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => { applyStatus(draft); setEditing(false); }}
            className="text-[10px] font-semibold px-2 py-1 rounded-md text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(myStatus); setEditing(true); }}
      className={`w-full flex items-center gap-2 text-left text-[11px] px-2 py-1.5 rounded-md border transition-colors ${
        dark
          ? "border-[var(--color-border)] bg-[var(--color-bg)] text-slate-300 hover:border-[var(--color-accent)]"
          : "bg-white border-slate-200 text-slate-700 hover:border-[var(--color-accent)]"
      }`}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotCls}`} />
      <span className={`shrink-0 font-semibold ${dark ? "text-slate-200" : "text-slate-800"}`}>
        {presence.label}
      </span>
      <span className="truncate">
        {myStatus
          ? <>· {myStatus}</>
          : <span className={dark ? "text-slate-500 italic" : "text-slate-400 italic"}>+ add status</span>}
      </span>
    </button>
  );
}
