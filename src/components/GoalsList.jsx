import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Target, ChevronDown, ChevronRight, CalendarClock } from "lucide-react";
import MarkdownText from "./MarkdownText";
import { GOAL_HEALTH } from "../lib/goals";

// Renders normalized goal items from useWeekGoals — each
// { id, body, label, color, href, progress, health }. Goals are GROUPED by
// owner (PM, SWE, You, …) under a collapsible header — click a header to
// show/hide that group. A per-goal progress bar + health dot show when set.
// Items with an href link out (the source whiteboard).
//
// `goals` is the normalized list. `compact` tightens spacing + font sizes
// for sidebar embedding.

const COLLAPSE_KEY = "mango:goalsCollapsedGroups";
function loadCollapsed() {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]")); } catch { return new Set(); }
}

const tierRank = { company: 0, department: 1, user: 2 };
const tierLabel = { company: "Company", department: "Teams", user: "Personal" };

export default function GoalsList({ goals, dark, compact = false }) {
  const allItems = goals ?? [];
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  // "This week" goals get their own dedicated section at the top (rolls over
  // automatically — see useWeekGoals); everything else groups by owner below.
  // Group by a STABLE owner key (tier:ownerId), not the display name — two
  // owners can share a name. Preserve first-seen order; capture color + tier.
  const { weekItems, groups } = useMemo(() => {
    const all = goals ?? [];
    const weekItems = all.filter((g) => g.week === "this");
    const items = all.filter((g) => g.week !== "this");
    const groups = [];
    const byKey = new Map();
    for (const g of items) {
      const tier = g.tier || "user";
      const gkey = `${tier}:${g.ownerId ?? g.label ?? "?"}`;
      if (!byKey.has(gkey)) { const grp = { gkey, label: g.label || "Goals", color: g.color || null, tier, items: [] }; byKey.set(gkey, grp); groups.push(grp); }
      byKey.get(gkey).items.push(g);
    }
    groups.sort((a, b) => (tierRank[a.tier] ?? 3) - (tierRank[b.tier] ?? 3));
    return { weekItems, groups };
  }, [goals]);

  if (!allItems.length) return null;
  const barBg = dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";

  const toggle = (label) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  const itemCls = `${compact ? "text-[11px]" : "text-xs"} ${dark ? "text-slate-200" : "text-slate-700"}`;

  const renderItem = (g) => {
    const health = g.health && GOAL_HEALTH[g.health];
    const inner = (
      <>
        <MarkdownText dark={dark} compact>{g.body}</MarkdownText>
        {(g.progress != null || health) && (
          <span className="flex items-center gap-2 mt-1">
            {g.progress != null && (
              <span className="flex items-center gap-1.5 flex-1 min-w-0">
                <span className="h-1 rounded-full flex-1 overflow-hidden block" style={{ background: barBg }}>
                  <span className="block h-full rounded-full" style={{ width: `${g.progress}%`, background: "var(--color-accent)" }} />
                </span>
                <span className={`text-[9px] tabular-nums shrink-0 ${dark ? "text-slate-400" : "text-slate-500"}`}>{g.progress}%</span>
              </span>
            )}
            {health && (
              <span className="inline-flex items-center gap-1 text-[9px] font-semibold shrink-0" style={{ color: health.color }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: health.color }} />
                {health.label}
              </span>
            )}
          </span>
        )}
      </>
    );
    return (
      <li key={g.id} className={itemCls}>
        {g.href ? (
          <Link to={g.href} className={`block ${dark ? "hover:text-slate-50" : "hover:text-slate-900"}`}>{inner}</Link>
        ) : (
          <div>{inner}</div>
        )}
      </li>
    );
  };

  const weekCollapsed = collapsed.has("week:this");
  let prevTier = null;
  return (
    <div className={compact ? "space-y-2.5" : "space-y-3"}>
      {weekItems.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => toggle("week:this")}
            title={weekCollapsed ? "Show this week's goals" : "Hide this week's goals"}
            className="flex items-center gap-1 w-full text-left uppercase tracking-wider font-bold text-[9px] mb-1"
            style={{ color: "var(--color-accent)" }}
          >
            {weekCollapsed ? <ChevronRight className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
            <CalendarClock className="w-3 h-3 shrink-0" />
            <span className="truncate">This week</span>
            <span className="opacity-50 font-semibold">{weekItems.length}</span>
          </button>
          {!weekCollapsed && (
            <ul className={`ml-1 ${compact ? "space-y-2" : "space-y-2.5"}`}>
              {weekItems.map((g) => (
                <li key={g.id} className={itemCls}>
                  {g.label && (
                    <span className="flex items-center gap-1 mb-0.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: g.color || "var(--color-accent)" }} />
                      <span className={`text-[9px] uppercase tracking-wider font-bold ${dark ? "text-slate-500" : "text-slate-400"}`}>{g.label}</span>
                    </span>
                  )}
                  {g.href ? (
                    <Link to={g.href} className={`block ${dark ? "hover:text-slate-50" : "hover:text-slate-900"}`}><MarkdownText dark={dark} compact>{g.body}</MarkdownText></Link>
                  ) : (
                    <MarkdownText dark={dark} compact>{g.body}</MarkdownText>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {groups.map((grp) => {
        const isCollapsed = collapsed.has(grp.gkey);
        const showTier = grp.tier !== prevTier;
        prevTier = grp.tier;
        return (
          <div key={grp.gkey} className={showTier && grp !== groups[0] ? `pt-2.5 border-t ${dark ? "border-[var(--color-border)]" : "border-slate-100"}` : ""}>
            {showTier && (
              <p className={`text-[8px] uppercase tracking-[0.12em] font-bold mb-1 ${dark ? "text-slate-500" : "text-slate-400"}`}>
                {tierLabel[grp.tier] || "Goals"}
              </p>
            )}
            <button
              type="button"
              onClick={() => toggle(grp.gkey)}
              title={isCollapsed ? "Show goals" : "Hide goals"}
              className="flex items-center gap-1 w-full text-left uppercase tracking-wider font-bold text-[9px] mb-1"
              style={{ color: grp.color || "var(--color-accent)" }}
            >
              {isCollapsed ? <ChevronRight className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
              <Target className="w-3 h-3 shrink-0" />
              <span className="truncate">{grp.label}</span>
              <span className="opacity-50 font-semibold">{grp.items.length}</span>
            </button>
            {!isCollapsed && <ul className={`ml-1 ${compact ? "space-y-2" : "space-y-2.5"}`}>{grp.items.map(renderItem)}</ul>}
          </div>
        );
      })}
    </div>
  );
}
