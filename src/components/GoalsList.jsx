import { Link } from "react-router-dom";
import { Target } from "lucide-react";
import MarkdownText from "./MarkdownText";
import { GOAL_HEALTH } from "../lib/goals";

// Renders normalized goal items from useWeekGoals — each
// { id, body, label, color, href, progress, health }. The label wears the
// owner's color (department/person) when one is set, else the accent. A
// progress bar + health dot show when present. Items with an href link out
// (retro page, or the source whiteboard); others render inert.
//
// `goals` is the normalized list; `retros` is accepted as a back-compat
// alias. `compact` tightens spacing + font sizes for sidebar embedding.
export default function GoalsList({ goals, retros, dark, compact = false }) {
  const items = goals ?? retros ?? [];
  if (!items.length) return null;
  const barBg = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
  return (
    <ul className={compact ? "space-y-2" : "space-y-3"}>
      {items.map((g) => {
        const health = g.health && GOAL_HEALTH[g.health];
        const inner = (
          <>
            <span
              className="inline-flex items-center gap-1.5 uppercase tracking-wider font-bold text-[9px] mb-1"
              style={{ color: g.color || "var(--color-accent)" }}
            >
              <Target className="w-3 h-3" />
              {g.label}
              {health && (
                <span className="inline-flex items-center gap-1 normal-case tracking-normal font-semibold" style={{ color: health.color }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: health.color }} />
                  {health.label}
                </span>
              )}
            </span>
            <MarkdownText dark={dark} compact>
              {g.body}
            </MarkdownText>
            {g.progress != null && (
              <span className="flex items-center gap-1.5 mt-1">
                <span className="h-1 rounded-full flex-1 overflow-hidden block" style={{ background: barBg }}>
                  <span className="block h-full rounded-full" style={{ width: `${g.progress}%`, background: "var(--color-accent)" }} />
                </span>
                <span className={`text-[9px] tabular-nums shrink-0 ${dark ? "text-slate-400" : "text-slate-500"}`}>{g.progress}%</span>
              </span>
            )}
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
