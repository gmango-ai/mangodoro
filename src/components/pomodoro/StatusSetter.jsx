import { useEffect, useRef, useState } from "react";
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
  { key: "out_to_lunch", label: "Lunch", dotLight: "bg-orange-500", dotDark: "bg-orange-400" },
];

// Click-to-expand status editor.
//
// Closed state (one row):
//   [ ● Active · Making Pomodoro Great Again!        ]
//
// Open state (form):
//   [ Active ] [ Available ] [ Heads-down ] [ Meeting ] [ Away ]
//   [ What are you working on?                                  ]
//   Use current task                            Close    Save
//
// Auto-falls-back from the participant RPC (when synced) to the
// global set_user_status RPC (when not in a sync session), so the
// row also writes the user's office-tile status from anywhere.
//
// currentTaskHint, when present, lets the user pull whatever they're
// clocked into ("ProjectName — what they're doing") into the status
// with a single click.
export default function StatusSetter({ currentTaskHint = "" }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { settings, session: appSession } = useApp();
  const { syncSession, syncParticipants, setStatus: setSyncStatus } = useSyncSession();
  const userId = appSession?.user?.id;

  const me = (syncParticipants || []).find((p) => p.user_id === userId);
  const myStatus = (me?.status ?? settings?.status) || "";
  const myPresence = (me?.presence_state ?? settings?.presenceState) || "active";

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(myStatus);

  // Refresh the draft from remote whenever upstream changes (another
  // device wrote it), except while the user is actively editing.
  useEffect(() => {
    if (!editing) setDraft(myStatus);
  }, [myStatus, editing]);

  const apply = async (patch) => {
    if (syncSession && setSyncStatus) {
      await setSyncStatus(patch);
    } else {
      await setUserStatus(patch);
    }
  };
  const applyPresence = (state) => apply({ presenceState: state });
  const save = () => { apply({ status: draft }); setEditing(false); };
  const cancel = () => { setDraft(myStatus); setEditing(false); };

  const presence = PRESENCE.find((p) => p.key === myPresence) || PRESENCE[0];
  const dotCls = dark ? presence.dotDark : presence.dotLight;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(myStatus); setEditing(true); }}
        className={`w-full flex items-center gap-2 text-left text-[11px] px-3 py-2 rounded-lg border transition-colors ${
          dark
            ? "border-[var(--color-border)] bg-[var(--color-surface)] text-slate-300 hover:border-[var(--color-accent)]"
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

  return (
    <div className={`rounded-lg border p-2.5 space-y-2 ${
      dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "bg-white border-slate-200"
    }`}>
      <div className="flex flex-wrap gap-1">
        {PRESENCE.map((opt) => {
          const active = myPresence === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => applyPresence(opt.key)}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                active
                  ? dark ? "bg-slate-700 text-slate-100" : "bg-slate-100 text-slate-800 shadow-sm"
                  : dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${dark ? opt.dotDark : opt.dotLight}`} />
              {opt.label}
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
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") cancel();
        }}
        className={`w-full h-9 px-3 rounded-md border text-xs ${
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
          onClick={cancel}
          className={`text-[11px] font-semibold px-3 py-1.5 rounded-md ${
            dark ? "text-slate-400 hover:bg-[var(--color-surface-raised)]" : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          Close
        </button>
        <button
          type="button"
          onClick={save}
          className="text-[11px] font-semibold px-3 py-1.5 rounded-md text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
        >
          Save
        </button>
      </div>
    </div>
  );
}
