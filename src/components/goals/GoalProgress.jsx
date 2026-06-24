import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import {
  addKeyResult, updateKeyResult, deleteKeyResult, updateGoal,
  goalProgress, krFraction, GOAL_HEALTH,
} from "../../lib/goals";

// Per-goal progress: a measurable set of key results (current/target) plus a
// manual health signal. Collapsed it shows a thin progress bar + health dot;
// expanded, managers edit KR values, add/remove KRs, and set health.
export default function GoalProgress({ goal, krs = [], manage = false, onChange, dark }) {
  const [open, setOpen] = useState(false);
  const [krBody, setKrBody] = useState("");
  const [krTarget, setKrTarget] = useState("");
  const [krUnit, setKrUnit] = useState("");

  const { pct, total } = goalProgress(krs);
  const health = goal.health && goal.health !== "none" ? GOAL_HEALTH[goal.health] : null;
  if (!manage && total === 0 && !health) return null;

  const barBg = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
  const muted = dark ? "text-slate-500" : "text-slate-400";
  const inputCls = `text-[11px] px-1.5 py-1 rounded-md border outline-none ${
    dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500" : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
  }`;

  const setHealth = async (h) => { await updateGoal({ id: goal.id, health: goal.health === h ? "none" : h }); onChange?.(); };
  const addKr = async () => {
    const body = krBody.trim();
    if (!body) return;
    setKrBody(""); setKrTarget(""); setKrUnit("");
    await addKeyResult({ goalId: goal.id, body, target: krTarget === "" ? null : Number(krTarget), unit: krUnit.trim() });
    setOpen(true);
    onChange?.();
  };
  const setCurrent = async (kr, v) => { await updateKeyResult({ id: kr.id, current: v === "" ? 0 : Number(v) }); onChange?.(); };
  const removeKr = async (kr) => { await deleteKeyResult(kr.id); onChange?.(); };

  const Bar = ({ frac, h = "h-1.5" }) => (
    <span className={`${h} rounded-full block overflow-hidden`} style={{ background: barBg }}>
      <span className="block h-full rounded-full" style={{ width: `${Math.round(frac * 100)}%`, background: "var(--color-accent)" }} />
    </span>
  );

  return (
    <div className="ml-6 mt-1">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 w-full text-left">
        {open ? <ChevronDown className={`w-3 h-3 shrink-0 ${muted}`} /> : <ChevronRight className={`w-3 h-3 shrink-0 ${muted}`} />}
        {total > 0 ? (
          <span className="flex items-center gap-2 flex-1 min-w-0">
            <span className="flex-1 min-w-0"><Bar frac={pct / 100} /></span>
            <span className={`text-[10px] tabular-nums shrink-0 ${dark ? "text-slate-400" : "text-slate-500"}`}>{pct}%</span>
          </span>
        ) : (
          <span className={`text-[11px] flex-1 ${muted}`}>{manage ? "Add progress" : ""}</span>
        )}
        {health && (
          <span className="flex items-center gap-1 text-[10px] shrink-0" style={{ color: health.color }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: health.color }} />
            {health.label}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {manage && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-[10px] uppercase tracking-wide ${muted}`}>Status</span>
              {Object.entries(GOAL_HEALTH).map(([k, v]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setHealth(k)}
                  className="text-[10px] px-1.5 py-0.5 rounded-full border transition-colors"
                  style={goal.health === k ? { background: v.color, borderColor: v.color, color: "#fff" } : { borderColor: barBg, color: "var(--tw-prose)" }}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}

          {krs.map((kr) => (
            <div key={kr.id} className="flex items-center gap-2 group">
              <span className="flex-1 min-w-0">
                <span className={`text-xs block truncate ${dark ? "text-slate-300" : "text-slate-600"}`}>{kr.body}</span>
                <span className="block mt-0.5"><Bar frac={krFraction(kr)} h="h-1" /></span>
              </span>
              {manage ? (
                <input
                  type="number"
                  defaultValue={kr.current}
                  onBlur={(e) => setCurrent(kr, e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                  className={`w-12 text-right shrink-0 ${inputCls}`}
                />
              ) : (
                <span className={`text-[11px] shrink-0 tabular-nums ${dark ? "text-slate-300" : "text-slate-600"}`}>{kr.current}</span>
              )}
              <span className={`text-[10px] shrink-0 tabular-nums ${muted}`}>/ {kr.target ?? "—"}{kr.unit ? ` ${kr.unit}` : ""}</span>
              {manage && (
                <button type="button" onClick={() => removeKr(kr)} aria-label="Delete key result" className={`opacity-0 group-hover:opacity-100 shrink-0 ${dark ? "text-slate-500 hover:text-red-300" : "text-slate-400 hover:text-red-500"}`}>
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}

          {manage && (
            <div className="flex items-center gap-1.5">
              <input value={krBody} onChange={(e) => setKrBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addKr(); }} placeholder="Key result…" className={`flex-1 ${inputCls}`} />
              <input value={krTarget} onChange={(e) => setKrTarget(e.target.value)} type="number" placeholder="target" className={`w-16 ${inputCls}`} />
              <input value={krUnit} onChange={(e) => setKrUnit(e.target.value)} placeholder="unit" className={`w-12 ${inputCls}`} />
              <button type="button" onClick={addKr} disabled={!krBody.trim()} aria-label="Add key result" className="shrink-0 w-7 h-7 rounded-md bg-[var(--color-accent)] text-white flex items-center justify-center disabled:opacity-40">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
