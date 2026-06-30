import { GOAL_TIMEFRAMES } from "../../lib/goals";

// Compact timeframe picker (Ongoing / This week / Next week / month / quarter
// / year). `value` is a timeframe KEY (see GOAL_TIMEFRAMES); onChange emits a
// key. Callers turn the key into { horizon, weekStart } via timeframeToParams.
export default function GoalHorizonSelect({ value, onChange, dark }) {
  return (
    <select
      value={value || "none"}
      onChange={(e) => onChange(e.target.value)}
      className={`shrink-0 text-[11px] rounded-md px-1.5 py-1 border outline-none cursor-pointer ${
        dark ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-300" : "bg-white border-slate-200 text-slate-600"
      }`}
    >
      {GOAL_TIMEFRAMES.map((t) => (
        <option key={t.key} value={t.key}>{t.label}</option>
      ))}
    </select>
  );
}
