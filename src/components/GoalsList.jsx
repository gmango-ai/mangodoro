import { Link } from "react-router-dom";
import { Target, Plus } from "lucide-react";
import MarkdownText from "./MarkdownText";

// Renders this week's retros as a list of clickable cards. If a retro
// has a goal set, render it; otherwise show a muted "Set this week's
// goal" prompt that links into the retro so the team can fill it in.
//
// Accepts `goals` (back-compat) OR `retros` — both are the same shape.
// `compact` tightens spacing + font sizes for sidebar embedding.
export default function GoalsList({ goals, retros, dark, compact = false }) {
  const items = retros ?? goals ?? [];
  if (!items.length) return null;
  return (
    <ul className={compact ? "space-y-2" : "space-y-3"}>
      {items.map((g) => {
        const goalText = (g.goal || "").trim();
        return (
          <li
            key={g.id}
            className={`${compact ? "text-[11px]" : "text-xs"} ${
              dark ? "text-slate-200" : "text-slate-700"
            }`}
          >
            <Link
              to={`/retros/${g.id}`}
              className={`block group ${
                dark ? "hover:text-slate-50" : "hover:text-slate-900"
              }`}
            >
              <span className="inline-flex items-center gap-1.5 uppercase tracking-wider font-bold text-[9px] mb-1 text-[var(--color-accent)]">
                <Target className="w-3 h-3" />
                {g.org_team_name || g.department || "Team"}
              </span>
              {goalText ? (
                <MarkdownText dark={dark} compact>
                  {goalText}
                </MarkdownText>
              ) : (
                <span
                  className={`inline-flex items-center gap-1 italic ${
                    dark ? "text-slate-500" : "text-slate-400"
                  }`}
                >
                  <Plus className="w-3 h-3" />
                  Set this week's goal
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
