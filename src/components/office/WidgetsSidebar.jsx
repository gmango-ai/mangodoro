import { useState } from "react";
import { ClipboardList, Search, Target, X as XIcon } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { Button } from "@/components/ui/button";
import { unlinkRetroFromSession } from "../../lib/syncSession";
import RetroPicker from "./RetroPicker";
import PomodoroWidget from "./PomodoroWidget";
import GoalsWidget from "./GoalsWidget";

// App-wide widgets sidebar. The retro widget is the primary action
// today (entry point for attaching a retro to the active session).
// Tasks slot stays as a placeholder for ClickUp lookup. Both render
// regardless of whether the user is in a room or in the hallway —
// each widget self-gates on the session/team context it needs.
export default function WidgetsSidebar() {
  const { theme } = useTheme();
  const dark = theme === "dark";

  return (
    <aside
      className={`flex flex-col h-full border-r min-w-0 ${
        dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
      }`}
    >
      <div className={`px-4 py-3 border-b ${
        dark ? "border-[var(--color-border)]" : "border-slate-200"
      }`}>
        <p className={`text-[10px] font-semibold uppercase tracking-wider ${
          dark ? "text-slate-500" : "text-slate-400"
        }`}>
          Widgets
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <PomodoroWidget dark={dark} />
        <GoalsWidget dark={dark} />
        <RetroWidget dark={dark} />
        <TasksWidget dark={dark} />
      </div>
    </aside>
  );
}

// Entry point for the retro-in-room flow.
//   Not in a session  → muted "Join a session to attach a retro" hint
//   In a session, no retro linked, leader → "Start a retro" CTA
//   In a session, no retro linked, not leader → "Waiting for leader" hint
//   Retro linked → chip + Unlink (leader only)
function RetroWidget({ dark }) {
  const { session } = useApp();
  const { syncSession } = useSyncSession();
  const [pickerOpen, setPickerOpen] = useState(false);

  const userId = session?.user?.id;
  const inSession = !!syncSession;
  const linkedRetroId = inSession ? (syncSession.retro_id || null) : null;
  const isLeader = inSession && syncSession.leader_id === userId;

  async function unlink() {
    if (!syncSession?.id) return;
    await unlinkRetroFromSession(syncSession.id);
  }

  return (
    <section className={`rounded-xl border overflow-hidden ${
      dark ? "border-[var(--color-border)] bg-[var(--color-surface-raised)]/40" : "border-slate-200 bg-slate-50"
    }`}>
      <header className={`flex items-center gap-1.5 px-3 py-2 ${
        dark ? "text-slate-400" : "text-slate-500"
      }`}>
        <Target className="w-3 h-3" />
        <span className="text-[10px] font-bold uppercase tracking-wider">Retro</span>
      </header>

      <div className="px-3 pb-3">
        {!inSession && (
          <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
            Join a session to attach a retro everyone can see.
          </p>
        )}

        {inSession && !linkedRetroId && isLeader && (
          <Button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="w-full justify-start"
            size="sm"
          >
            <Target className="w-3.5 h-3.5 mr-2" />
            Start a retro
          </Button>
        )}

        {inSession && !linkedRetroId && !isLeader && (
          <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
            The session leader can attach a retro for the group.
          </p>
        )}

        {linkedRetroId && (
          <div className="space-y-2">
            <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold w-full bg-[var(--color-accent-light)] text-[var(--color-accent)]`}>
              <Target className="w-3 h-3" fill="currentColor" />
              <span className="truncate flex-1">Retro attached</span>
              {isLeader && (
                <button
                  type="button"
                  onClick={unlink}
                  aria-label="Unlink retro"
                  title="Unlink retro"
                  className="p-0.5 rounded-full hover:bg-[var(--color-accent)]/15"
                >
                  <XIcon className="w-3 h-3" />
                </button>
              )}
            </div>
            <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
              Pick "Retro" in the room view-mode pill to take over the screen.
            </p>
          </div>
        )}
      </div>

      <RetroPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </section>
  );
}

function TasksWidget({ dark }) {
  return (
    <section className={`rounded-xl border overflow-hidden ${
      dark ? "border-[var(--color-border)] bg-[var(--color-surface-raised)]/40" : "border-slate-200 bg-slate-50"
    }`}>
      <header className={`flex items-center justify-between px-3 py-2 ${
        dark ? "text-slate-400" : "text-slate-500"
      }`}>
        <span className="text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
          <ClipboardList className="w-3 h-3" />
          Tasks
        </span>
      </header>
      <div className="px-3 pb-3 space-y-2">
        <div className={`relative ${
          dark ? "text-slate-500" : "text-slate-400"
        }`}>
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" />
          <input
            type="text"
            disabled
            placeholder="Search ClickUp tasks…"
            className={`w-full pl-8 pr-2 py-1.5 rounded-md border text-xs cursor-not-allowed ${
              dark
                ? "bg-[var(--color-surface)] border-[var(--color-border)] placeholder:text-slate-500"
                : "bg-white border-slate-200 placeholder:text-slate-400"
            }`}
          />
        </div>
        <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
          ClickUp integration lands next — link a task to your active session.
        </p>
        <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full inline-block ${
          dark ? "bg-[var(--color-surface)] text-slate-500" : "bg-white text-slate-400 border border-slate-200"
        }`}>
          Coming soon
        </span>
      </div>
    </section>
  );
}
