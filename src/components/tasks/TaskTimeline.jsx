import { Check, Calendar, AlarmClock, CheckSquare, Timer, Anchor, Plus } from "lucide-react";
import { priorityMeta, labelMeta } from "../../lib/tasks/model";
import { todayStr } from "../../lib/utils";
import { FocusCheckbox, StatusControl } from "./TaskControls";

// The due-date timeline: overdue → today → future days on a vertical spine, then
// a "Someday" shelf for undated tasks. Pure presentation — all reads come from
// normalized tasks + a subtask-count map; all writes bubble through callbacks.

const parse = (iso) => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const dayDiff = (iso, today) => Math.round((parse(iso) - parse(today)) / 86400000);

function dueChip(iso, today) {
  const d = dayDiff(iso, today);
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  if (d === -1) return "Due yesterday";
  if (d < 0) return `${Math.abs(d)} days late`;
  if (d < 7) return `Due ${parse(iso).toLocaleDateString("en-US", { weekday: "short" })}`;
  return `Due ${parse(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}
function dayHeader(iso, today) {
  const d = dayDiff(iso, today);
  const wd = parse(iso).toLocaleDateString("en-US", { weekday: "long" });
  const small = parse(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  let big = wd;
  if (d === 0) big = "Today"; else if (d === 1) big = "Tomorrow"; else if (d === -1) big = "Yesterday";
  return { big, small: Math.abs(d) <= 1 ? `${wd} · ${small}` : small, isToday: d === 0, isOverdue: d < 0 };
}

function MetaChips({ t, sub, focused }) {
  const today = todayStr();
  const overdue = t.dueDate && dayDiff(t.dueDate, today) < 0 && !t.done;
  const hard = t.deadline === "hard";
  const dl = {
    label: t.done ? "Done" : dueChip(t.dueDate, today),
    Icon: hard ? AlarmClock : Calendar,
    bg: overdue ? "rgba(251,94,75,.14)" : hard ? "rgba(251,94,75,.1)" : "var(--o-sand-100)",
    fg: overdue || hard ? "var(--o-coral-700)" : "var(--o-ink-500)",
    border: overdue ? "1px solid rgba(251,94,75,.35)" : hard ? "1px solid rgba(251,94,75,.22)" : "1px solid transparent",
  };
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 9, paddingLeft: 15 }}>
      <span className="tl-metachip" style={{ background: dl.bg, color: dl.fg, border: dl.border }}>
        <dl.Icon style={{ width: 11, height: 11 }} />{dl.label}
      </span>
      {t.labels.map((key) => {
        const m = labelMeta(key);
        return <span key={key} className="tl-metachip" style={{ background: m.bg, color: m.fg }}>{m.name}</span>;
      })}
      {t.status === "doing" && !t.done && (
        <span className="tl-metachip" style={{ background: "rgba(45,127,249,.1)", color: "var(--o-ocean-700)" }}>In progress</span>
      )}
      {sub?.total > 0 && (
        <span className="tl-metachip" style={{ background: "var(--o-sand-100)", color: "var(--o-ink-500)" }}>
          <CheckSquare style={{ width: 11, height: 11 }} />{sub.done}/{sub.total}
        </span>
      )}
      {t.focusSessions > 0 && (
        <span className="tl-metachip" style={{ background: "rgba(255,159,28,.14)", color: "var(--o-mango-700)" }}>
          <Timer style={{ width: 11, height: 11 }} />{t.focusSessions} session{t.focusSessions === 1 ? "" : "s"}
        </span>
      )}
      {focused && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: "var(--o-mango-700)" }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--o-mango-500)", animation: "tl-pulse 1.6s infinite" }} />In focus now
        </span>
      )}
    </div>
  );
}

function TaskRow({ t, sub, focused, onOpen, onSetStatus, onSetFocus }) {
  const today = todayStr();
  const overdue = t.dueDate && dayDiff(t.dueDate, today) < 0 && !t.done;
  const P = priorityMeta(t.priority);
  const nodeColor = t.done ? "var(--o-aqua-500)" : focused ? "var(--o-mango-500)" : overdue ? "var(--o-coral-500)" : t.priority > 0 ? P.color : "var(--o-ink-300)";
  return (
    <div className="tl-taskgrid">
      <div className="tl-spinecol">
        <span className="tl-node" style={{ position: "absolute", left: "50%", top: 24, transform: "translate(-50%,-50%)", width: 11, height: 11, borderRadius: 999, background: nodeColor, border: "2.5px solid var(--o-white)", boxShadow: `0 0 0 1px ${focused ? "var(--o-mango-400)" : "transparent"}` }} />
      </div>
      <div className="tl-row" onClick={() => onOpen(t)}
        style={{ border: `1px solid ${focused ? "rgba(255,159,28,.4)" : "var(--o-glass-border)"}`, background: focused ? "var(--o-glass-mango)" : "var(--o-glass)" }}>
        <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
          <FocusCheckbox focused={focused} onToggle={() => onSetFocus(t)} size={20} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              {t.priority > 0 && <span style={{ width: 7, height: 7, borderRadius: 999, background: t.done ? "var(--o-ink-300)" : P.color, flex: "none", marginTop: 6 }} />}
              <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3, color: t.done ? "var(--o-ink-400)" : "var(--o-ink-800)", textDecoration: t.done ? "line-through" : "none", paddingRight: 118 }}>{t.title}</div>
            </div>
            <MetaChips t={t} sub={sub} focused={focused} />
          </div>
        </div>
        <div style={{ position: "absolute", top: 13, right: 13 }} onClick={(e) => e.stopPropagation()}>
          <StatusControl status={t.status} onChange={(s) => onSetStatus(t, s)} />
        </div>
      </div>
    </div>
  );
}

function ShelfCard({ t, focused, onOpen, onSetStatus, onSetFocus }) {
  const P = priorityMeta(t.priority);
  return (
    <div className="shelf-card" onClick={() => onOpen(t)}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <FocusCheckbox focused={focused} onToggle={() => onSetFocus(t)} size={19} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: t.done ? "var(--o-aqua-500)" : t.priority > 0 ? P.color : "var(--o-ink-300)", flex: "none", marginTop: 5 }} />
            <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3, color: t.done ? "var(--o-ink-400)" : "var(--o-ink-800)", textDecoration: t.done ? "line-through" : "none", paddingRight: 104 }}>{t.title}</div>
          </div>
          {t.labels.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8, paddingLeft: 14 }}>
              {t.labels.map((key) => { const m = labelMeta(key); return <span key={key} style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: m.bg, color: m.fg }}>{m.name}</span>; })}
            </div>
          )}
        </div>
      </div>
      <div style={{ position: "absolute", top: 11, right: 11 }} onClick={(e) => e.stopPropagation()}>
        <StatusControl status={t.status} onChange={(s) => onSetStatus(t, s)} />
      </div>
    </div>
  );
}

export default function TaskTimeline({ tasks, subCounts = {}, focusId, onOpen, onSetStatus, onSetFocus, showCapture = true, shelfQuick, onShelfChange, onShelfAdd }) {
  const today = todayStr();
  const dated = tasks.filter((t) => t.dueDate);
  const undated = tasks.filter((t) => !t.dueDate);

  const byDate = {};
  dated.forEach((t) => { (byDate[t.dueDate] = byDate[t.dueDate] || []).push(t); });
  const dates = Object.keys(byDate).sort();

  const shelf = [...undated].sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));

  return (
    <div className="tl-inner">
      {dates.map((iso, di) => {
        const h = dayHeader(iso, today);
        const list = [...byDate[iso]].sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
        const open = list.filter((t) => !t.done).length;
        const accent = h.isOverdue ? "var(--o-coral-500)" : h.isToday ? "var(--o-mango-500)" : "var(--o-ocean-500)";
        return (
          <div key={iso}>
            <div className={`tl-daygrid${di === 0 ? " tl-daygrid--first" : ""}`}>
              <div className="tl-spinecell" style={{ background: di === 0 ? "linear-gradient(transparent 50%,var(--o-spine) 50%) center/2px 100% no-repeat" : "linear-gradient(var(--o-spine),var(--o-spine)) center/2px 100% no-repeat" }}>
                <span className="tl-node" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 15, height: 15, borderRadius: 999, background: accent, border: "3px solid var(--o-white)", boxShadow: `0 0 0 1px ${accent}` }} />
              </div>
              <div className="tl-dayhd">
                <div className="big" style={{ color: h.isOverdue ? "var(--o-coral-700)" : "var(--o-ink-900)" }}>{h.big}</div>
                <div className="small">{h.small}</div>
                <div className="count">{open} {open === 1 ? "task" : "tasks"}</div>
                {h.isOverdue && <span className="tl-pastdue">past due</span>}
              </div>
            </div>
            {list.map((t) => (
              <TaskRow key={t.id} t={t} sub={subCounts[t.id]} focused={t.id === focusId} onOpen={onOpen} onSetStatus={onSetStatus} onSetFocus={onSetFocus} />
            ))}
          </div>
        );
      })}

      {/* spine tail */}
      <div className="tl-tail"><div className="c" /><div /></div>

      {/* someday shelf */}
      {(shelf.length > 0 || showCapture) && (
        <div className="tl-shelf">
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
            <Anchor style={{ width: 16, height: 16, color: "var(--o-aqua-600)" }} />
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--o-ink-900)" }}>Someday · no due date</div>
            <span style={{ fontFamily: "var(--o-mono)", fontSize: 11, color: "var(--o-ink-400)" }}>{shelf.length}</span>
            {showCapture && <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--o-ink-400)" }}>Give one a due date to drop it onto the line</span>}
          </div>
          <div className="tl-shelfgrid">
            {shelf.map((t) => (
              <ShelfCard key={t.id} t={t} focused={t.id === focusId} onOpen={onOpen} onSetStatus={onSetStatus} onSetFocus={onSetFocus} />
            ))}
            {showCapture && (
              <div className="tl-quick">
                <Plus style={{ width: 15, height: 15, color: "var(--o-ink-400)", flex: "none" }} />
                <input value={shelfQuick} onChange={(e) => onShelfChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onShelfAdd(); }} placeholder="Capture something for later…" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
