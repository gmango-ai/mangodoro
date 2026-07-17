import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Target, ChevronDown, ChevronRight, CalendarClock } from "lucide-react";
import MarkdownText from "./MarkdownText";
import { GOAL_HEALTH } from "../lib/goals";

// Renders normalized goal items from useWeekGoals — each
// { id, body, label, color, href, progress, health }. "This week" goals get a
// dedicated section on top; the rest group by owner (Company → Teams → Personal)
// under collapsible headers. Each goal is an owner-colour-railed row with a
// progress bar + health chip. Items with an href link to the source whiteboard.
//
// `goals` is the normalized list. `compact` only slightly tightens spacing for
// sidebar/popover embedding — the type stays readable in both.

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

  // A goal's progress bar + health chip. Thicker + more legible than before.
  const progressRow = (g) => {
    const health = g.health && GOAL_HEALTH[g.health];
    if (g.progress == null && !health) return null;
    return (
      <div className="flex items-center gap-2 mt-1.5">
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

  // One goal — an owner-colour rail + the body (linked when it has a source),
  // with the progress row beneath. `showLabel` captions the owner (used only in
  // the mixed "This week" section; grouped goals sit under their owner header).
  const goalRow = (g, color, showLabel = false) => {
    const body = <MarkdownText dark={dark} compact>{g.body}</MarkdownText>;
    return (
      <li key={g.id} className="flex gap-2.5">
        <span className="mt-0.5 w-1 self-stretch rounded-full shrink-0" style={{ background: color || "var(--color-accent)" }} aria-hidden />
        <div className="min-w-0 flex-1">
          {showLabel && g.label && (
            <span className="block text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: color || "var(--color-accent)" }}>{g.label}</span>
          )}
          {g.href ? (
            <Link to={g.href} className={`block ${bodyCls} ${dark ? "hover:text-white" : "hover:text-slate-950"}`}>{body}</Link>
          ) : (
            <div className={bodyCls}>{body}</div>
          )}
          {progressRow(g)}
        </div>
      </li>
    );
  };

  const sectionHead = (key, color, Icon, label, count) => {
    const isCollapsed = collapsed.has(key);
    const Chevron = isCollapsed ? ChevronRight : ChevronDown;
    return (
      <button
        type="button"
        onClick={() => toggle(key)}
        title={isCollapsed ? `Show ${label}` : `Hide ${label}`}
        className="flex items-center gap-1.5 w-full text-left text-[11px] font-bold uppercase tracking-wide mb-1.5"
        style={{ color: color || "var(--color-accent)" }}
      >
        <Chevron className="w-3.5 h-3.5 shrink-0 opacity-80" />
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{label}</span>
        <span className="ml-auto text-[10px] font-semibold opacity-60 tabular-nums">{count}</span>
      </button>
    );
  };

  let prevTier = null;
  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {weekItems.length > 0 && (
        <section>
          {sectionHead("week:this", "var(--color-accent)", CalendarClock, "This week", weekItems.length)}
          {!collapsed.has("week:this") && (
            <ul className="space-y-2.5">
              {weekItems.map((g) => goalRow(g, g.color, true))}
            </ul>
          )}
        </section>
      )}
      {groups.map((grp) => {
        const showTier = grp.tier !== prevTier;
        prevTier = grp.tier;
        return (
          <section key={grp.gkey} className={showTier && grp !== groups[0] ? `pt-3 border-t ${dark ? "border-[var(--color-border)]" : "border-slate-100"}` : ""}>
            {showTier && (
              <p className={`text-[10px] uppercase tracking-[0.12em] font-bold mb-1.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>
                {tierLabel[grp.tier] || "Goals"}
              </p>
            )}
            {sectionHead(grp.gkey, grp.color, Target, grp.label, grp.items.length)}
            {!collapsed.has(grp.gkey) && (
              <ul className="space-y-2.5">{grp.items.map((g) => goalRow(g, grp.color))}</ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
