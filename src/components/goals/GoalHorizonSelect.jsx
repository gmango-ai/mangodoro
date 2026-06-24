import { GOAL_HORIZONS } from "../../lib/goals";

// Compact horizon picker (Ongoing / This week / month / quarter / year). Used
// in the goal add-rows and per-goal for editing.
export default function GoalHorizonSelect({ value, onChange, dark }) {
  return (
    <select
      value={value || "none"}
      onChange={(e) => onChange(e.target.value)}
      className={`shrink-0 text-[11px] rounded-md px-1.5 py-1 border outline-none cursor-pointer ${
        dark ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-300" : "bg-white border-slate-200 text-slate-600"
      }`}
    >
      {GOAL_HORIZONS.map((h) => (
        <option key={h.value} value={h.value}>{h.label}</option>
      ))}
    </select>
  );
}
