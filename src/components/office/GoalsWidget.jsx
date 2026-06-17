import { Target } from "lucide-react";
import { useWeekGoals } from "../../hooks/useWeekGoals";
import GoalsList from "../GoalsList";

// Renders this week's retro goals as a sidebar widget so the team's
// stated focus stays visible while in a room. Hides itself entirely
// when there are no goals to show (no team, no retros for this week,
// or no goals filled in).
export default function GoalsWidget({ dark }) {
  const { retros } = useWeekGoals();
  if (!retros.length) return null;
  return (
    <section className={`rounded-xl border overflow-hidden ${
      dark ? "border-[var(--color-border)] bg-[var(--color-surface-raised)]/40" : "border-slate-200 bg-slate-50"
    }`}>
      <header className={`flex items-center gap-1.5 px-3 py-2 ${
        dark ? "text-slate-400" : "text-slate-500"
      }`}>
        <Target className="w-3 h-3" />
        <span className="text-[10px] font-bold uppercase tracking-wider">
          Goals this week
        </span>
      </header>
      <div className="px-3 pb-3">
        <GoalsList retros={retros} dark={dark} compact />
      </div>
    </section>
  );
}
