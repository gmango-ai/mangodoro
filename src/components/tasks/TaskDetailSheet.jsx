import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, Flag, Calendar, Tag, ListChecks, AlignLeft, Trash2, Archive, ArchiveRestore,
  Play, Pause, Check, Sparkles, Plus, Feather, AlarmClock, Users, CalendarClock, Loader2,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import {
  PRIORITY_CHOICES, priorityMeta, TASK_LABELS, LABEL_KEYS, labelMeta, supportsField, TASK_STATUSES,
} from "../../lib/tasks/model";
import * as taskMutations from "../../lib/tasks/mutations";
import {
  fetchSubtasks, addSubtask, addSubtasks, setSubtaskDone, deleteSubtask, subtaskProgress,
} from "../../lib/subtasks";
import { syncPlannerProgressFromSubtasks } from "../../lib/plannerTasks";
import { todayStr, offsetDateStr } from "../../lib/utils";
import "./tasks-ocean.css";

// The shared, app-wide task editor ("Editing · syncs everywhere"). One
// component drives editing from the Tasks timeline, the calendar, the pomodoro
// focus panel and the sidebar widget. Every change writes through
// lib/tasks/mutations immediately and reports back via onChange/onDeleted so the
// host list stays in sync. Renders as a fixed portal wrapped in .tl-scope so its
// ocean styling resolves over any surface.
export default function TaskDetailSheet({ task, onClose, onChange, onDeleted, onSetFocus }) {
  const { session, flash, suggestSubtasks } = useApp();
  const userId = session?.user?.id;

  const [t, setT] = useState(task);
  const [subs, setSubs] = useState([]);
  const [newSub, setNewSub] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef(null);

  const isPlanner = t?.kind !== "personal";
  const has = (f) => supportsField(t?.kind || "planner", f);

  // Resync when a different task is opened.
  useEffect(() => { setT(task); }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    if (!task?.id) { setSubs([]); return; }
    const key = task.kind === "personal" ? { personalTaskId: task.id } : { plannerTaskId: task.id };
    fetchSubtasks(key).then(({ data }) => { if (live) setSubs(data || []); });
    return () => { live = false; };
  }, [task?.id, task?.kind]);

  // Escape closes; auto-grow the title textarea.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const growTitle = useCallback(() => {
    const el = titleRef.current;
    if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
  }, []);
  useEffect(() => { growTitle(); }, [t?.id, growTitle]);

  if (!t) return null;

  const flashErr = (r, msg) => { if (r?.error) { flash?.(`✗ ${msg}`); return true; } return false; };
  const applyLocal = (patch) => { const next = { ...t, ...patch }; setT(next); onChange?.(next); };

  // ── field writers (persist + optimistic) ─────────────────────────────────
  async function saveTitle() {
    const title = (t.title || "").trim();
    if (!title || title === (task.title || "").trim()) return;
    const r = await taskMutations.updateTaskFields({ task: t, fields: { title } });
    if (!flashErr(r, "Could not save title")) applyLocal({ title });
  }
  async function setDue(dueDate) {
    const r = await taskMutations.updateTaskFields({ task: t, fields: { dueDate } });
    if (!flashErr(r, "Could not set due date")) applyLocal({ dueDate: dueDate || null });
  }
  async function setDeadline(deadline) {
    const r = await taskMutations.updateTaskFields({ task: t, fields: { deadline } });
    if (!flashErr(r, "Could not set deadline")) applyLocal({ deadline });
  }
  async function toggleLabel(key) {
    const labels = t.labels.includes(key) ? t.labels.filter((l) => l !== key) : [...t.labels, key];
    const r = await taskMutations.updateTaskFields({ task: t, fields: { labels } });
    if (!flashErr(r, "Could not update labels")) applyLocal({ labels });
  }
  async function addCustomLabel() {
    const v = newLabel.trim();
    if (!v) return;
    setNewLabel("");
    if (t.labels.some((l) => l.toLowerCase() === v.toLowerCase())) return;
    const labels = [...t.labels, v];
    const r = await taskMutations.updateTaskFields({ task: t, fields: { labels } });
    if (!flashErr(r, "Could not add label")) applyLocal({ labels });
  }
  async function saveNotes(notes) {
    if (notes === t.notes) return;
    const r = await taskMutations.updateTaskFields({ task: t, fields: { notes } });
    if (!flashErr(r, "Could not save notes")) applyLocal({ notes });
  }
  async function setPriority(priority) {
    const r = await taskMutations.setTaskPriority({ userId, task: t, priority });
    if (!flashErr(r, "Could not set priority") && r.patch) applyLocal(r.patch);
  }
  async function setStatus(status) {
    const r = await taskMutations.setTaskStatus({ userId, task: t, status });
    if (!flashErr(r, "Could not update status") && r.patch) applyLocal(r.patch);
  }
  async function setFocus() {
    const next = !t.inProgress;
    applyLocal({ inProgress: next }); // optimistic so the footer flips immediately
    if (onSetFocus) { onSetFocus(t); return; }
    const r = next
      ? await taskMutations.setFocus({ userId, taskId: t.id })
      : await taskMutations.clearFocus({ userId, taskId: t.id });
    flashErr(r, "Could not update focus");
  }
  async function remove() {
    if (busy) return;
    setBusy(true);
    const r = await taskMutations.deleteTask({ task: t });
    setBusy(false);
    if (flashErr(r, "Could not delete")) return;
    onDeleted?.(t.id);
    onClose?.();
  }
  async function archive() {
    const next = !t.archived;
    const r = await taskMutations.setArchived({ task: t, archived: next });
    if (flashErr(r, "Could not archive")) return;
    applyLocal({ archived: next });
    if (next) onClose?.(); // archived → drops out of the active view
  }

  // ── subtasks ──────────────────────────────────────────────────────────────
  const parentKey = isPlanner ? { plannerTaskId: t.id } : { personalTaskId: t.id };
  const prog = subtaskProgress(subs);
  async function syncProgress(next) {
    if (isPlanner) {
      await syncPlannerProgressFromSubtasks({ userId, taskId: t.id });
      const { pct } = subtaskProgress(next);
      applyLocal({ progress: t.done ? 100 : Math.min(99, pct) });
    }
  }
  async function addSub() {
    const title = newSub.trim();
    if (!title) return;
    const sortOrder = subs.length ? Math.max(...subs.map((s) => s.sort_order)) + 1 : 0;
    const { data, error } = await addSubtask({ ...parentKey, title, sortOrder });
    if (error || !data) { flash?.("✗ Could not add subtask"); return; }
    const next = [...subs, data];
    setSubs(next); setNewSub("");
    await syncProgress(next);
  }
  async function toggleSub(s) {
    const next = subs.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x));
    setSubs(next);
    const { error } = await setSubtaskDone(s.id, !s.done);
    if (error) { setSubs(subs); return; }
    await syncProgress(next);
  }
  async function removeSub(s) {
    const next = subs.filter((x) => x.id !== s.id);
    setSubs(next);
    await deleteSubtask(s.id);
    await syncProgress(next);
  }
  async function aiSubtasks() {
    if (aiBusy || !suggestSubtasks) return;
    setAiBusy(true);
    const titles = await suggestSubtasks(t.title, t.notes);
    if (!titles?.length) { setAiBusy(false); flash?.("AI unavailable — add subtasks manually."); return; }
    const startOrder = subs.length ? Math.max(...subs.map((s) => s.sort_order)) + 1 : 0;
    const { data } = await addSubtasks({ ...parentKey, titles, startOrder });
    const next = [...subs, ...(data || [])].sort((a, b) => a.sort_order - b.sort_order);
    setSubs(next); setAiBusy(false);
    await syncProgress(next);
    flash?.(`✓ Added ${data?.length || 0} subtask${data?.length === 1 ? "" : "s"}`);
  }

  // ── derived ───────────────────────────────────────────────────────────────
  const today = todayStr();
  const overdue = t.dueDate && t.dueDate < today && !t.done;
  const dlHint = !t.dueDate
    ? "No due date — lives on your Someday shelf."
    : overdue
      ? "Past due — this is highlighted at the top of your line."
      : t.deadline === "hard"
        ? "Hard deadline — you'll be reminded and it can't slip quietly."
        : "Soft target — a gentle nudge, not a hard stop.";
  const focused = isPlanner && t.inProgress;

  const DUE_PRESETS = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: offsetDateStr(today, 1) },
    { label: "In a week", date: offsetDateStr(today, 7) },
  ];

  return createPortal(
    <div className="tl-scope">
      <div className="tl-backdrop" onClick={onClose} />
      <aside className="tl-sheet" role="dialog" aria-label="Edit task">
        {/* head */}
        <div className="tl-sheet-head">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            {isPlanner ? (
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <button onClick={setFocus} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 13px", borderRadius: 999, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 700, background: focused ? "rgba(255,159,28,.16)" : "var(--o-mango-500)", color: focused ? "var(--o-mango-700)" : "#fff", boxShadow: focused ? "none" : "var(--o-glow-mango)" }}>
                  {focused ? <><Pause style={{ width: 14, height: 14 }} /> Focusing now</> : <><Play style={{ width: 14, height: 14 }} /> Set as focus</>}
                </button>
                {t.focusSessions > 0 && <span style={{ fontFamily: "var(--o-mono)", fontSize: 11, color: "var(--o-ink-400)" }}>{t.focusSessions} session{t.focusSessions === 1 ? "" : "s"}</span>}
              </div>
            ) : <span />}
            <button onClick={onClose} className="tl-icobtn" style={{ width: 32, height: 32 }} aria-label="Close"><X style={{ width: 18, height: 18 }} /></button>
          </div>
          <textarea
            ref={titleRef}
            className="tl-sheet-title"
            rows={1}
            value={t.title}
            onChange={(e) => { setT({ ...t, title: e.target.value }); growTitle(); }}
            onBlur={saveTitle}
          />
        </div>

        {/* body */}
        <div className="tl-sheet-body">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* priority */}
            {has("priority") && (
              <div className="tl-fieldrow" style={{ alignItems: "center" }}>
                <div className="tl-fieldlabel" style={{ paddingTop: 0 }}><Flag style={{ width: 15, height: 15 }} /> Priority</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {PRIORITY_CHOICES.map((p) => {
                    const on = t.priority === p.value;
                    return (
                      <button key={p.value} className="tl-pill" onClick={() => setPriority(p.value)}
                        style={{ borderColor: on ? p.border : "var(--o-border-default)", background: on ? p.bg : "var(--o-glass)", color: on ? p.fg : "var(--o-ink-600)" }}>
                        <span style={{ width: 7, height: 7, borderRadius: 999, background: p.color }} />{p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* due date + deadline */}
            <div className="tl-fieldrow">
              <div className="tl-fieldlabel"><Calendar style={{ width: 15, height: 15 }} /> Due date</div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="date" className="tl-dateinput" style={{ flex: 1 }} value={t.dueDate || ""} onChange={(e) => setDue(e.target.value || null)} />
                  {t.dueDate && (
                    <button onClick={() => setDue(null)} className="tl-icobtn" title="Remove due date (move to Someday)" aria-label="Remove due date"
                      style={{ width: 34, height: 34, flex: "none", border: "1px solid var(--o-border-default)", color: "var(--o-ink-500)" }}>
                      <X style={{ width: 15, height: 15 }} />
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {DUE_PRESETS.map((d) => {
                    const on = t.dueDate === d.date;
                    return (
                      <button key={d.label} className="tl-preset" onClick={() => setDue(d.date)}
                        style={{ borderColor: on ? "var(--o-ocean-500)" : "var(--o-border-default)", background: on ? "rgba(45,127,249,.12)" : "var(--o-glass)", color: on ? "var(--o-ocean-700)" : "var(--o-ink-600)" }}>
                        {d.label}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {[{ k: "soft", label: "Soft deadline", Icon: Feather }, { k: "hard", label: "Hard deadline", Icon: AlarmClock }].map(({ k, label, Icon }) => {
                    const on = t.deadline === k;
                    const c = k === "hard" ? priorityMeta(3) : priorityMeta(1);
                    return (
                      <button key={k} className="tl-preset" onClick={() => setDeadline(k)}
                        style={{ borderColor: on ? c.border : "var(--o-border-default)", background: on ? c.bg : "var(--o-glass)", color: on ? c.fg : "var(--o-ink-600)" }}>
                        <Icon style={{ width: 13, height: 13 }} />{label}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11, color: "var(--o-ink-400)", lineHeight: 1.4 }}>{dlHint}</div>
              </div>
            </div>

            {/* labels */}
            <div className="tl-fieldrow">
              <div className="tl-fieldlabel"><Tag style={{ width: 15, height: 15 }} /> Labels</div>
              <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {t.labels.map((key) => {
                  const m = labelMeta(key);
                  return (
                    <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "3px 6px 3px 9px", borderRadius: 999, background: m.bg, color: m.fg }}>
                      {m.name}
                      <button onClick={() => toggleLabel(key)} style={{ border: "none", background: "none", cursor: "pointer", color: "inherit", opacity: 0.6, display: "inline-flex", padding: 0 }}><X style={{ width: 11, height: 11 }} /></button>
                    </span>
                  );
                })}
                {LABEL_KEYS.filter((k) => !t.labels.includes(k)).map((k) => (
                  <button key={k} onClick={() => toggleLabel(k)} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999, background: "none", border: "1px dashed var(--o-border-default)", color: "var(--o-ink-400)", cursor: "pointer" }}>
                    <Plus style={{ width: 11, height: 11 }} />{TASK_LABELS[k].name}
                  </button>
                ))}
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomLabel(); } }}
                  onBlur={addCustomLabel}
                  placeholder="+ Custom…"
                  aria-label="Add a custom label"
                  style={{ width: 78, fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999, background: "none", border: "1px dashed var(--o-border-default)", color: "var(--o-ink-600)" }}
                />
              </div>
            </div>

            {/* scaffolded ClickUp-future rows (read-only placeholders) */}
            <div className="tl-fieldrow" style={{ alignItems: "center" }}>
              <div className="tl-fieldlabel" style={{ paddingTop: 0 }}><Users style={{ width: 15, height: 15 }} /> Shared</div>
              <span style={{ fontSize: 12, color: "var(--o-ink-400)" }}>Just you · sharing arrives with ClickUp sync</span>
            </div>
            <div className="tl-fieldrow" style={{ alignItems: "center" }}>
              <div className="tl-fieldlabel" style={{ paddingTop: 0 }}><CalendarClock style={{ width: 15, height: 15 }} /> Calendar</div>
              <span style={{ fontSize: 12, color: "var(--o-ink-400)" }}>Set a due date to place it on your calendar</span>
            </div>
          </div>

          <div className="tl-divider" />

          {/* subtasks */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ListChecks style={{ width: 16, height: 16, color: "var(--o-ocean-600)" }} />
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--o-ink-900)" }}>Subtasks</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {suggestSubtasks && (
                  <button onClick={aiSubtasks} disabled={aiBusy} className="tl-icobtn" title="Suggest subtasks with AI"
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--o-mango-700)", padding: "3px 7px" }}>
                    {aiBusy ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : <Sparkles style={{ width: 12, height: 12 }} />} AI
                  </button>
                )}
                <span style={{ fontFamily: "var(--o-mono)", fontSize: 11, color: "var(--o-ink-400)" }}>{prog.done} of {prog.total}</span>
              </div>
            </div>
            {prog.total > 0 && (
              <div style={{ height: 6, borderRadius: 999, background: "var(--o-sand-200)", overflow: "hidden", marginBottom: 12 }}>
                <div style={{ height: "100%", width: `${prog.pct}%`, background: "var(--o-aqua-500)", borderRadius: 999, transition: "width .2s var(--o-ease-out)" }} />
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {subs.map((s) => (
                <div key={s.id} className="tl-subrow">
                  <button onClick={() => toggleSub(s)} className="tl-check" style={{ width: 18, height: 18, marginTop: 0, borderColor: s.done ? "var(--o-aqua-500)" : "var(--o-border-strong)", background: s.done ? "var(--o-aqua-500)" : "transparent" }}>
                    {s.done && <Check style={{ width: 12, height: 12, color: "#fff" }} />}
                  </button>
                  <div style={{ flex: 1, fontSize: 13, color: s.done ? "var(--o-ink-400)" : "var(--o-ink-800)", textDecoration: s.done ? "line-through" : "none" }}>{s.title}</div>
                  <button onClick={() => removeSub(s)} className="tl-icobtn" style={{ width: 24, height: 24, color: "var(--o-ink-300)" }} aria-label="Remove subtask"><X style={{ width: 13, height: 13 }} /></button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 8px 0" }}>
              <Plus style={{ width: 15, height: 15, color: "var(--o-ink-400)", flex: "none" }} />
              <input value={newSub} onChange={(e) => setNewSub(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addSub(); }}
                placeholder="Add a subtask…" style={{ border: "none", background: "none", fontSize: 13, color: "var(--o-ink-800)", width: "100%" }} />
            </div>
          </div>

          {/* notes (planner) */}
          {has("notes") && (
            <>
              <div className="tl-divider" />
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                  <AlignLeft style={{ width: 16, height: 16, color: "var(--o-ink-500)" }} />
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--o-ink-900)" }}>Notes</div>
                </div>
                <textarea className="tl-notes" defaultValue={t.notes} onBlur={(e) => saveNotes(e.target.value)} placeholder="Add context, links, acceptance criteria…" />
              </div>
            </>
          )}
        </div>

        {/* foot — status tracker (complete = set status to Done) + delete */}
        <div className="tl-sheet-foot" style={{ alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--o-ink-400)", flex: "none" }}>Status</span>
            <div style={{ display: "flex", gap: 5, flex: 1 }}>
              {TASK_STATUSES.map((s) => {
                const on = t.status === s.value;
                return (
                  <button key={s.value} onClick={() => setStatus(s.value)} className="tl-preset" style={{ borderColor: on ? s.border : "var(--o-border-default)", background: on ? s.bg : "var(--o-glass)", color: on ? s.fg : "var(--o-ink-600)" }}>
                    {s.value === "done" && on && <Check style={{ width: 12, height: 12 }} />}{s.label}
                  </button>
                );
              })}
            </div>
          </div>
          <button className="tl-icobtn" onClick={archive} title={t.archived ? "Unarchive" : "Archive"} aria-label={t.archived ? "Unarchive task" : "Archive task"} style={{ width: 38, height: 38, flex: "none", color: "var(--o-ink-500)" }}>
            {t.archived ? <ArchiveRestore style={{ width: 16, height: 16 }} /> : <Archive style={{ width: 16, height: 16 }} />}
          </button>
          <button className="tl-icobtn" onClick={remove} disabled={busy} title="Delete task" aria-label="Delete task" style={{ width: 38, height: 38, flex: "none", color: "var(--o-coral-600)" }}>
            <Trash2 style={{ width: 16, height: 16 }} />
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
