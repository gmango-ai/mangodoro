import { Search, ArrowUpDown, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../context/ThemeContext";
import UserAvatar from "../UserAvatar";
import DailyBarSparkline from "./DailyBarSparkline";
import { formatDuration } from "../../lib/utils";

const SORT_OPTIONS = [
  { key: "hours", label: "Hours" },
  { key: "name", label: "Name" },
  { key: "entries", label: "Entries" },
];

function totalMinutes(member) {
  return (member.entries || []).reduce((a, e) => a + (e.minutes || 0), 0);
}

// Searchable + sortable left-rail list of members. Each row: avatar +
// name + hours + sparkline. Sort is tucked behind a small icon button
// next to the search input — it's rarely changed so it shouldn't take
// up a full row of header chrome.
export default function MembersList({
  members,
  selectedId,
  onSelect,
  monthStr,
  searchValue,
  onSearchChange,
  sortBy,
  onSortChange,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef(null);

  useEffect(() => {
    if (!sortOpen) return;
    const onClick = (e) => {
      if (!sortRef.current?.contains(e.target)) setSortOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [sortOpen]);

  return (
    <aside className={`flex flex-col h-full border-r ${
      dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
    }`}>
      {/* Search + sort */}
      <div className={`p-3 border-b ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${
              dark ? "text-slate-500" : "text-slate-400"
            }`} />
            <input
              type="text"
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Filter members…"
              className={`w-full pl-8 pr-2 py-1.5 rounded-md border text-xs ${
                dark
                  ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500"
                  : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-400"
              }`}
            />
          </div>
          <div ref={sortRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setSortOpen((v) => !v)}
              title={`Sort: ${SORT_OPTIONS.find((s) => s.key === sortBy)?.label}`}
              className={`inline-flex items-center justify-center w-8 h-8 rounded-md border transition-colors ${
                dark
                  ? "border-[var(--color-border)] bg-[var(--color-surface-raised)] text-slate-300 hover:text-slate-100"
                  : "border-slate-200 bg-white text-slate-500 hover:text-slate-700"
              }`}
              aria-label="Sort members"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
            </button>
            {sortOpen && (
              <div className={`absolute z-10 top-full mt-1 right-0 min-w-[140px] rounded-md border shadow-lg overflow-hidden ${
                dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-white"
              }`}>
                <div className={`px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider font-semibold ${
                  dark ? "text-slate-500" : "text-slate-400"
                }`}>
                  Sort by
                </div>
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => { onSortChange(opt.key); setSortOpen(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs ${
                      opt.key === sortBy
                        ? "bg-[var(--color-accent-light)] text-[var(--color-accent)] font-semibold"
                        : dark ? "text-slate-300 hover:bg-[var(--color-surface-raised)]" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <Check className={`w-3 h-3 ${opt.key === sortBy ? "" : "opacity-0"}`} />
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Member rows */}
      <div className="flex-1 overflow-y-auto py-1">
        {members.length === 0 ? (
          <p className={`px-3 py-4 text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>
            No members match.
          </p>
        ) : (
          members.map((m) => {
            const mins = totalMinutes(m);
            const isSelected = m.userId === selectedId;
            return (
              <button
                key={m.userId}
                type="button"
                onClick={() => onSelect(m.userId)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors relative ${
                  isSelected
                    ? "bg-[var(--color-accent-light)]"
                    : dark ? "hover:bg-[var(--color-surface-raised)]/60" : "hover:bg-slate-50"
                }`}
              >
                {isSelected && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-accent)]"
                  />
                )}
                <UserAvatar url={m.avatar_url} name={m.name} size={32} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold truncate ${
                    dark ? "text-slate-100" : "text-slate-800"
                  }`}>
                    {m.name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[11px] font-mono font-semibold ${
                      mins > 0 ? "text-[var(--color-accent)]" : dark ? "text-slate-500" : "text-slate-400"
                    }`}>
                      {formatDuration(mins)}
                    </span>
                    <span className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
                      · {m.entries.length}
                    </span>
                  </div>
                </div>
                <DailyBarSparkline entries={m.entries} monthStr={monthStr} width={64} height={18} />
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
