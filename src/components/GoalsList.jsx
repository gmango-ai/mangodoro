import { Link } from "react-router-dom";
import { Target } from "lucide-react";
import MarkdownText from "./MarkdownText";

// Renders normalized goal items from useWeekGoals — each
// { id, body, label, color, href }. The label wears the owner's color
// (department/person) when one is set, else the accent. Items with an
// href link out (retro page, or the source whiteboard); others render
// inert.
//
// `goals` is the normalized list; `retros` is accepted as a back-compat
// alias. `compact` tightens spacing + font sizes for sidebar embedding.
export default function GoalsList({ goals, retros, dark, compact = false }) {
  const items = goals ?? retros ?? [];
  if (!items.length) return null;
  return (
    <ul className={compact ? "space-y-2" : "space-y-3"}>
      {items.map((g) => {
        const inner = (
          <>
            <span
              className="inline-flex items-center gap-1.5 uppercase tracking-wider font-bold text-[9px] mb-1"
              style={{ color: g.color || "var(--color-accent)" }}
            >
              <Target className="w-3 h-3" />
              {g.label}
            </span>
            <MarkdownText dark={dark} compact>
              {g.body}
            </MarkdownText>
          </>
        );
        const cls = `${compact ? "text-[11px]" : "text-xs"} ${
          dark ? "text-slate-200" : "text-slate-700"
        }`;
        return (
          <li key={g.id} className={cls}>
            {g.href ? (
              <Link
                to={g.href}
                className={`block ${dark ? "hover:text-slate-50" : "hover:text-slate-900"}`}
              >
                {inner}
              </Link>
            ) : (
              <div>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
