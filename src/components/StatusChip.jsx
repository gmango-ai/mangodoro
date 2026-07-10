import { useRef, useState } from "react";
import { Pin, EyeOff } from "lucide-react";
import { useResolvedSelf } from "../hooks/useResolvedSelf";
import { useTheme } from "../context/ThemeContext";
import { useApp } from "../context/AppContext";
import { availabilityDot, availabilityLabel } from "../lib/presence";
import { formatSince } from "../lib/utils";
import { applyStatusOverride, clearStatusOverride, setStatusPin, setStatusInvisible } from "../lib/statusActions";
import EmojiTextField from "./EmojiTextField";
import Popover from "./goals/Popover";

// The always-visible self status chip + setter. Label/light/duration come from
// the live resolved status (no DB). Auto (the resolver) is ALWAYS the baseline;
// clicking a status writes a temporary manual OVERRIDE on top — stored in
// localStorage so it takes effect instantly and mirrored to user_presence for
// teammates. Clicking the currently-active status again drops back to auto.
// "Keep through idle" pins it (24h); "Appear offline" hides you from teammates.

// Every coarse state is manually settable — including Away and Offline (distinct
// from "Appear offline", which keeps your real state but shows teammates offline).
const PRESETS = ["online", "focusing", "meeting", "lunch", "commuting", "away", "offline"];
const EMOJIS = ["🎯", "💻", "☕", "🍽️", "📞", "🚗", "🧠", "🌙"];

export default function StatusChip() {
  const { resolved, userId } = useResolvedSelf();
  const { theme } = useTheme();
  const { updateStatus } = useApp();
  const dark = theme === "dark";
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [emoji, setEmoji] = useState(null);

  if (!resolved) return null;
  const { availability, activity } = resolved;
  const overridden = !!resolved.override; // exists even when Away/Offline overrides it
  const pinned = !!resolved.pinnedUntil;
  const invisible = !!resolved.invisible;
  const ovEmoji = resolved.override?.emoji || null;
  const detail = overridden && resolved.override?.message
    ? resolved.override.message
    : activity && !activity.private ? activity.label : null;
  const dur = formatSince(activity?.since ?? resolved.since);
  const title = [availabilityLabel(availability), detail, invisible ? "hidden from teammates" : null, dur].filter(Boolean).join(" · ");

  const openMenu = () => {
    setMsg(resolved.override?.message || "");
    setEmoji(resolved.override?.emoji || null);
    setOpen(true);
  };

  const commit = (avail) => {
    // No manual "clear after" — applyStatusOverride auto-expires it overnight.
    applyStatusOverride({ availability: avail, message: msg.trim() || null, emoji, userId, updateStatus });
    setOpen(false);
  };

  // Clicking the currently-active status returns to auto — no separate button:
  // auto is always the baseline, a manual pick is just a temporary override.
  const pick = (avail) => {
    if (overridden && availability === avail) {
      clearStatusOverride({ userId, updateStatus });
      setMsg(""); setEmoji(null);
      setOpen(false);
    } else {
      commit(avail);
    }
  };

  const toggleCls = (on) => `flex w-full items-center gap-2 rounded-md px-2 py-2.5 sm:py-1.5 text-sm sm:text-xs ${
    on
      ? "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
      : dark ? "text-slate-300 hover:bg-[var(--color-bg)]" : "text-slate-600 hover:bg-slate-100"
  }`;

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
        {invisible && <EyeOff className="h-3 w-3 shrink-0 text-slate-400" />}
        {(ovEmoji || detail) && (
          <span className="max-w-[10rem] truncate text-slate-400">· {ovEmoji ? `${ovEmoji} ` : ""}{detail}</span>
        )}
        {dur && <span className="text-slate-400">· {dur}</span>}
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={264} maxHeight={440} dark={dark}>
        <p className={`px-2 pt-1 pb-1 text-[10px] uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-400"}`}>
          Set your status
        </p>

        {/* Emoji quick-pick */}
        <div className="flex items-center gap-0.5 px-1 pb-1">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEmoji(emoji === e ? null : e)}
              className={`h-7 w-7 rounded-md text-base leading-none ${
                emoji === e ? "bg-[var(--color-accent-light)]" : dark ? "hover:bg-[var(--color-bg)]" : "hover:bg-slate-100"
              }`}
            >
              {e}
            </button>
          ))}
        </div>

        {/* Message — Enter sets it against the current/derived state. */}
        <div className="px-1 pb-1.5">
          <EmojiTextField
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commit(overridden ? availability : "online"); }}
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
                onClick={() => pick(a)}
                title={sel ? "Click to return to auto" : ""}
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
        <p className={`px-2 pt-1 text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
          {overridden ? "Manual — tap the ✓ status to return to auto." : "Auto — following your activity."}
        </p>

        {/* Immediate toggles — apply on click, independent of the presets. */}
        <div className={`mt-1 border-t px-1 pt-1 ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
          <button type="button" onClick={() => setStatusPin({ userId, on: !pinned })} className={toggleCls(pinned)}>
            <Pin className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 text-left">Keep through idle</span>
            <span className="text-[10px] opacity-70">{pinned ? "On · 24h" : "Off"}</span>
          </button>
          <button type="button" onClick={() => setStatusInvisible({ userId, on: !invisible })} className={toggleCls(invisible)}>
            <EyeOff className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1 text-left">Appear offline</span>
            <span className="text-[10px] opacity-70">{invisible ? "On" : "Off"}</span>
          </button>
        </div>
      </Popover>
    </>
  );
}
