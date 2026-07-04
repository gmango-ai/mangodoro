import { useRef, useState } from "react";
import { useResolvedSelf } from "../hooks/useResolvedSelf";
import { useTheme } from "../context/ThemeContext";
import { useApp } from "../context/AppContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { availabilityDot, availabilityLabel } from "../lib/presence";
import { formatSince } from "../lib/utils";
import { writeOverride, clearOverride } from "../lib/statusOverride";
import { setPresenceOverride, clearPresenceOverride } from "../lib/userPresence";
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

// Map the new availability onto the legacy presence_state so the old surfaces
// (room participant list, hallway, avatars) reflect a status set from the chip.
const LEGACY = {
  available: "available",
  focusing: "heads_down",
  in_meeting: "in_meeting",
  away: "away",
  lunch: "out_to_lunch",
  commuting: "commuting",
  off: "away",
};

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
  const { availability, activity, source } = resolved;
  const detail = activity && !activity.private ? activity.label : null;
  const dur = formatSince(activity?.since ?? resolved.since);
  const title = [availabilityLabel(availability), detail, dur].filter(Boolean).join(" · ");
  const overridden = source === "override";

  const openMenu = () => {
    setMsg(resolved.override?.message || "");
    setExp("none");
    setOpen(true);
  };

  const apply = (avail) => {
    const expiresAt = EXPIRIES.find((e) => e.key === exp)?.at() ?? null;
    const message = msg.trim() || null;
    writeOverride({ availability: avail, message, expiresAt });
    if (userId) setPresenceOverride({ userId, availability: avail, message, expiresAt });
    // Bridge to the legacy surfaces so the room participant list + hallway
    // reflect it immediately (the resolver reads these back too).
    const legacy = LEGACY[avail] || "active";
    updateStatus?.({ presenceState: legacy, status: message || "" });
    if (syncSession) setStatus?.({ presenceState: legacy, status: message || "" });
    setOpen(false);
  };

  const backToAuto = () => {
    clearOverride();
    if (userId) clearPresenceOverride(userId);
    // Return the legacy surfaces to neutral so derivation/idle take back over.
    updateStatus?.({ presenceState: "active", status: "" });
    if (syncSession) setStatus?.({ presenceState: "active", status: "" });
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
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${availabilityDot(availability)}`} />
        <span className="font-medium">{availabilityLabel(availability)}</span>
        {detail && <span className="max-w-[10rem] truncate text-slate-400">· {detail}</span>}
        {dur && <span className="text-slate-400">· {dur}</span>}
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={252} dark={dark}>
        <p className={`px-2 pt-1 pb-1.5 text-[10px] uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-400"}`}>
          Set your status
        </p>

        <ul className="space-y-0.5">
          {PRESETS.map((a) => {
            const sel = overridden && availability === a;
            return (
              <li key={a}>
                <button
                  type="button"
                  onClick={() => apply(a)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs ${
                    sel
                      ? dark ? "bg-[var(--color-bg)] text-slate-100" : "bg-slate-100 text-slate-800"
                      : dark ? "text-slate-200 hover:bg-[var(--color-bg)]" : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${availabilityDot(a)}`} />
                  {availabilityLabel(a)}
                  {sel && <span className="ml-auto text-[10px] text-[var(--color-accent)]">set</span>}
                </button>
              </li>
            );
          })}
        </ul>

        <div className={`mt-1 space-y-2 border-t px-2 pt-2 pb-1 ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
          <input
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            maxLength={80}
            placeholder="What's up? (optional)"
            className={`w-full rounded-md border px-2 py-1 text-xs ${
              dark
                ? "bg-[var(--color-bg)] border-[var(--color-border)] text-slate-200 placeholder:text-slate-500"
                : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-400"
            }`}
          />
          <div className="flex items-center gap-1">
            {EXPIRIES.map((e) => (
              <button
                key={e.key}
                type="button"
                onClick={() => setExp(e.key)}
                className={`flex-1 rounded-md px-1.5 py-1 text-[11px] ${
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
            className={`mt-1 w-full rounded-md px-2 py-1.5 text-xs font-medium ${
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
