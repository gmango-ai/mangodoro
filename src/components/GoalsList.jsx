import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, CalendarClock } from "lucide-react";
import MarkdownText from "./MarkdownText";
import { GOAL_HEALTH } from "../lib/goals";

// Renders normalized goal items from useWeekGoals — each
// { id, body, label, color, href, progress, health }. "This week" goals get a
// dedicated section on top; the rest group by owner (Company → Teams → Personal).
// Each owner is one compact header (color dot + name + count) with its goals
// railed beneath in the owner's colour. The tier label (COMPANY/TEAMS/PERSONAL)
// only shows when a tier holds MORE THAN ONE owner — otherwise it just repeats
// the owner (e.g. the single "GMANGO" company). Goals with an href link out.
//
// `compact` only slightly tightens spacing; the type stays readable in both.

const COLLAPSE_KEY = "mango:goalsCollapsedGroups";
function loadCollapsed() {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]")); } catch { return new Set(); }
}

const tierRank = { company: 0, department: 1, user: 2 };
const tierLabel = { company: "Company", department: "Teams", user: "Personal" };

export default function GoalsList({ goals, dark, compact = false }) {
  const allItems = goals ?? [];
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  // "This week" goals get their own section on top (rolls over automatically —
  // see useWeekGoals); the rest group by a STABLE owner key (tier:ownerId), not
  // the display name — two owners can share a name. Preserve first-seen order.
  const { weekItems, groups, tierCounts } = useMemo(() => {
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
    const tierCounts = {};
    for (const grp of groups) tierCounts[grp.tier] = (tierCounts[grp.tier] || 0) + 1;
    return { weekItems, groups, tierCounts };
  }, [goals]);

  if (!allItems.length) return null;
  const accent = "var(--color-accent)";
  const barBg = dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.07)";

  const toggle = (key) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  const bodyCls = `${compact ? "text-[12.5px]" : "text-sm"} leading-snug ${dark ? "text-slate-100" : "text-slate-800"}`;

  const progressRow = (g) => {
    const health = g.health && GOAL_HEALTH[g.health];
    if (g.progress == null && !health) return null;
    return (
      <div className="flex items-center gap-2 mt-1">
        {g.progress != null && (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <div className="h-1.5 rounded-full flex-1 overflow-hidden" style={{ background: barBg }}>
              <div className="h-full rounded-full" style={{ width: `${g.progress}%`, background: "var(--color-accent)" }} />
            </div>
            <span className={`text-[10px] font-semibold tabular-nums shrink-0 ${dark ? "text-slate-400" : "text-slate-500"}`}>{g.progress}%</span>
          </div>
        )}
        {health && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold shrink-0" style={{ color: health.color }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: health.color }} />
            {health.label}
          </span>
        )}
      </div>
    );
  };

  const goalBody = (g) => {
    const body = <MarkdownText dark={dark} compact>{g.body}</MarkdownText>;
    return (
      <>
        {g.href ? (
          <Link to={g.href} className={`block ${bodyCls} ${dark ? "hover:text-white" : "hover:text-slate-950"}`}>{body}</Link>
        ) : (
          <div className={bodyCls}>{body}</div>
        )}
        {progressRow(g)}
      </>
    );
  };

  let prevTier = null;
  return (
    <div className={compact ? "space-y-2.5" : "space-y-3"}>
      {weekItems.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => toggle("week:this")}
            className="flex items-center gap-1.5 w-full text-left text-[11px] font-bold uppercase tracking-wide mb-1.5"
            style={{ color: accent }}
          >
            {collapsed.has("week:this") ? <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-70" /> : <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-70" />}
            <CalendarClock className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">This week</span>
            <span className="ml-auto text-[10px] font-semibold opacity-55 tabular-nums">{weekItems.length}</span>
          </button>
          {!collapsed.has("week:this") && (
            <ul className="space-y-2">
              {/* mixed owners here → keep a per-goal dot + owner caption */}
              {weekItems.map((g) => (
                <li key={g.id} className="flex gap-2">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: g.color || accent }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    {g.label && <span className="block text-[10px] font-semibold mb-0.5 truncate" style={{ color: g.color || accent }}>{g.label}</span>}
                    {goalBody(g)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {groups.map((grp) => {
        const showTier = grp.tier !== prevTier;
        prevTier = grp.tier;
        const isCollapsed = collapsed.has(grp.gkey);
        const Chevron = isCollapsed ? ChevronRight : ChevronDown;
        return (
          <section key={grp.gkey} className={showTier && grp !== groups[0] ? `pt-2.5 border-t ${dark ? "border-[var(--color-border)]" : "border-slate-100"}` : ""}>
            {/* Tier label only when the tier has >1 owner — otherwise it just
                repeats the single owner below it. */}
            {showTier && tierCounts[grp.tier] > 1 && (
              <p className={`text-[10px] uppercase tracking-[0.1em] font-semibold mb-1.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>
                {tierLabel[grp.tier] || "Goals"}
              </p>
            )}
            <button
              type="button"
              onClick={() => toggle(grp.gkey)}
              title={isCollapsed ? `Show ${grp.label}` : `Hide ${grp.label}`}
              className="flex items-center gap-1.5 w-full text-left mb-1.5"
              style={{ color: grp.color || accent }}
            >
              <Chevron className="w-3.5 h-3.5 shrink-0 opacity-70" />
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: grp.color || accent }} aria-hidden />
              <span className="text-[12px] font-bold truncate">{grp.label}</span>
              <span className="ml-auto text-[10px] font-semibold opacity-55 tabular-nums">{grp.items.length}</span>
            </button>
            {!isCollapsed && (
              <ul className="ml-[3px] pl-3 border-l-2 space-y-2" style={{ borderColor: grp.color || accent }}>
                {grp.items.map((g) => <li key={g.id}>{goalBody(g)}</li>)}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
