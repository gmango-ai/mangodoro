import { useNavigate } from "react-router-dom";
import { Play, Timer, Square } from "lucide-react";
import { subtaskProgress } from "../../lib/subtasks";

// The active-focus strip at the top of the timeline. Shows the task the user has
// marked in_progress (their pomodoro focus), its subtask progress, and quick
// actions — open the timer to actually run a session, open the task, or clear
// focus. When nothing is focused it shows a gentle prompt. The live pomodoro
// clock lives on the /pomodoro page; here the ring reflects subtask completion.
export default function FocusBanner({ focusTask, subs = [], onOpen, onClearFocus }) {
  const navigate = useNavigate();

  if (!focusTask) {
    return (
      <div className="tl-noFocus">
        <div style={{ width: 44, height: 44, borderRadius: 999, background: "var(--o-sand-100)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          <Timer style={{ width: 20, height: 20, color: "var(--o-ink-400)" }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--o-ink-800)" }}>No focus set</div>
          <div style={{ fontSize: 12.5, color: "var(--o-ink-500)" }}>Pick a task and hit focus to start a session — your crew will see it light up.</div>
        </div>
      </div>
    );
  }

  const prog = subtaskProgress(subs);
  const pct = prog.total ? prog.pct : 0;

  return (
    <div className="tl-banner">
      <div className="tl-ring" style={{ background: `conic-gradient(var(--o-mango-500) ${pct}%, rgba(255,159,28,.18) 0)` }}>
        <div className="inner">{prog.total ? `${prog.done}/${prog.total}` : <Timer style={{ width: 18, height: 18 }} />}</div>
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 3 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--o-mango-700)" }}>Focusing on</span>
          {focusTask.focusSessions > 0 && (
            <span style={{ fontFamily: "var(--o-mono)", fontSize: 11, fontWeight: 700, color: "var(--o-mango-700)", background: "rgba(255,159,28,.18)", padding: "1px 8px", borderRadius: 999 }}>
              Session {focusTask.focusSessions + 1}
            </span>
          )}
        </div>
        <button onClick={() => onOpen(focusTask)} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", textAlign: "left", maxWidth: "100%", display: "block" }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: "var(--o-ink-900)", letterSpacing: "-.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{focusTask.title}</div>
        </button>
        {prog.total > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 7, maxWidth: 440 }}>
            <div style={{ flex: 1, height: 6, borderRadius: 999, background: "rgba(255,159,28,.2)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: "var(--o-mango-500)", borderRadius: 999 }} />
            </div>
            <span style={{ fontFamily: "var(--o-mono)", fontSize: 11, color: "var(--o-ink-500)", flex: "none" }}>{prog.done} of {prog.total} subtasks</span>
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
        <button onClick={() => navigate("/pomodoro")} className="tl-fbtn" title="Open the pomodoro timer"><Play style={{ width: 20, height: 20 }} /></button>
        <button onClick={() => onClearFocus(focusTask)} className="tl-ibtn" title="Clear focus"><Square style={{ width: 16, height: 16 }} /></button>
      </div>
    </div>
  );
}
