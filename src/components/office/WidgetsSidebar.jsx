import { ClipboardList, Search } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";

// App-wide widgets sidebar. Not room-specific — these surfaces live
// here because they're "things you reach for while working,"
// independent of which room you happen to be in. Placeholder shell
// for now; ClickUp task lookup is the first real widget to land,
// followed by quick notes / saved links / etc.
//
// Kept intentionally lean — the rooms list moved into the office
// overlay (triggered from the room header). This sidebar is for
// utility surfaces, not navigation.
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
        <TasksWidget dark={dark} />
      </div>
    </aside>
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
          ClickUp integration lands next — link a task to your active session and surface it across surfaces.
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
