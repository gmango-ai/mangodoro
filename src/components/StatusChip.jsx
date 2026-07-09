import { useRef, useState } from "react";
import { useResolvedSelf } from "../hooks/useResolvedSelf";
import { useTheme } from "../context/ThemeContext";
import { useApp } from "../context/AppContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { availabilityDot, availabilityLabel } from "../lib/presence";
import { formatSince } from "../lib/utils";
import { applyStatusOverride, clearStatusOverride } from "../lib/statusActions";
import Popover from "./goals/Popover";

// The always-visible self status chip + setter (plan §5). The label/light/
// duration come from the live resolved status (no DB). Clicking opens a picker
// that writes a manual OVERRIDE — stored in localStorage so it takes effect
// instantly (and mirrored to user_presence best-effort for teammates once that
// table is live). "Back to auto" clears it and returns to derived status.

// User-choosable availabilities (pairing/offline are system-derived only).
const PRESETS = ["available", "focusing", "in_meeting", "away", "lunch", "commuting", "off"];
const EXPIRIES = [
  { key: "none", label: "No end", at: () => null },
  { key: "1h", label: "1 hour", at: () => Date.now() + 3600_000 },
  { key: "eod", label: "Today", at: () => { const d = new Date(); d.setHours(23, 59, 59, 0); return d.getTime(); } },
];

export default function StatusChip() {
  const { resolved, userId } = useResolvedSelf();
  const { theme } = useTheme();
  const { updateStatus } = useApp();
  const { syncSession, setStatus } = useSyncSession();
  const dark = theme === "dark";
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [exp, setExp] = useState("none");

  if (!resolved) return null;
  const { availability, activity } = resolved;
  // An override still *exists* even when Away/Offline currently overrides it,
  // so key the "back to auto" affordance off its presence, not the live source.
  const overridden = !!resolved.override;
  const detail = overridden && resolved.override?.message
    ? resolved.override.message
    : activity && !activity.private ? activity.label : null;
  const dur = formatSince(activity?.since ?? resolved.since);
  const title = [availabilityLabel(availability), detail, dur].filter(Boolean).join(" · ");

  const openMenu = () => {
    setMsg(resolved.override?.message || "");
    setExp("none");
    setOpen(true);
  };

  const apply = (avail) => {
    const expiresAt = EXPIRIES.find((e) => e.key === exp)?.at() ?? null;
    applyStatusOverride({ availability: avail, message: msg.trim() || null, expiresAt, userId, syncSession, updateStatus, setStatus });
    setOpen(false);
  };

  const backToAuto = () => {
    clearStatusOverride({ userId, syncSession, updateStatus, setStatus });
    setMsg("");
    setOpen(false);
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        title={title}
        className="flex items-center gap-1.5 min-h-11 sm:min-h-0 rounded-full px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${availabilityDot(availability)}`} />
        <span className="font-medium">{availabilityLabel(availability)}</span>
        {detail && <span className="max-w-[10rem] truncate text-slate-400">· {detail}</span>}
        {dur && <span className="text-slate-400">· {dur}</span>}
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={256} maxHeight={360} dark={dark}>
        <p className={`px-2 pt-1 pb-1 text-[10px] uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-400"}`}>
          Set your status
        </p>

        {/* Custom text — Enter to set it alone, or type then pick an availability. */}
        <div className="px-1 pb-1.5">
          <input
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") apply(overridden ? availability : "available"); }}
            maxLength={80}
            placeholder="What are you up to?"
            className={`w-full rounded-md border px-2 py-2.5 sm:py-1.5 text-sm sm:text-xs ${
              dark
                ? "bg-[var(--color-bg)] border-[var(--color-border)] text-slate-200 placeholder:text-slate-500"
                : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-400"
            }`}
          />
        </div>

        <div className="grid grid-cols-2 gap-0.5 px-1">
          {PRESETS.map((a) => {
            const sel = overridden && availability === a;
            return (
              <button
                key={a}
                type="button"
                onClick={() => apply(a)}
                className={`flex items-center gap-1.5 rounded-md px-2 py-2.5 sm:py-1.5 text-sm sm:text-xs ${
                  sel
                    ? dark ? "bg-[var(--color-bg)] text-slate-100" : "bg-slate-100 text-slate-800"
                    : dark ? "text-slate-200 hover:bg-[var(--color-bg)]" : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${availabilityDot(a)}`} />
                <span className="truncate">{availabilityLabel(a)}</span>
                {sel && <span className="ml-auto text-[10px] text-[var(--color-accent)]">✓</span>}
              </button>
            );
          })}
        </div>

        <div className={`mt-1.5 border-t px-2 pt-2 pb-1 ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
          <span className={`mb-1 block text-[10px] uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-400"}`}>Clear after</span>
          <div className="flex items-center gap-1">
            {EXPIRIES.map((e) => (
              <button
                key={e.key}
                type="button"
                onClick={() => setExp(e.key)}
                className={`flex-1 rounded-md px-1.5 py-2 sm:py-1 text-xs sm:text-[11px] ${
                  exp === e.key
                    ? "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
                    : dark ? "text-slate-400 hover:bg-[var(--color-bg)]" : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>

        {overridden && (
          <button
            type="button"
            onClick={backToAuto}
            className={`mt-1 w-full rounded-md px-2 py-2.5 sm:py-1.5 text-sm sm:text-xs font-medium ${
              dark ? "text-slate-300 hover:bg-[var(--color-bg)]" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            ↩ Back to auto
          </button>
        )}
      </Popover>
    </>
  );
}
