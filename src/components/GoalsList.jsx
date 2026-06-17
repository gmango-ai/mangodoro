import { Link } from "react-router-dom";
import { Target } from "lucide-react";
import MarkdownText from "./MarkdownText";

// Renders this week's retro goals as a list of clickable cards.
// Each card links to the retro for that goal.
//
// `compact` tightens spacing + font sizes for sidebar embedding.
export default function GoalsList({ goals, dark, compact = false }) {
  if (!goals?.length) return null;
  return (
    <ul className={compact ? "space-y-2" : "space-y-3"}>
      {goals.map((g) => (
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
            <MarkdownText dark={dark} compact>
              {g.goal}
            </MarkdownText>
          </Link>
        </li>
      ))}
    </ul>
  );
}
