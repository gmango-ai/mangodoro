import { useRef, useState } from "react";
import { Briefcase, Coffee } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useTeam } from "../../context/TeamContext";
import { useClockedIn } from "../../hooks/useClockedIn";
import { formatSince } from "../../lib/utils";
import UserAvatar from "../UserAvatar";
import Popover from "../goals/Popover";

// Compact "who's working now" pill for the top bar — a count that opens a
// roster of clocked-in teammates (task + elapsed). Hidden when nobody's working.
export default function WorkingNowBar({ dark }) {
  const { session, settings } = useApp();
  const { teamMembers = [] } = useTeam();
  const rows = useClockedIn();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const userId = session?.user?.id;

  const memberById = new Map((teamMembers || []).map((m) => [m.user_id, m]));
  const people = rows
    .filter((r) => r.clocked_in_at && (memberById.has(r.user_id) || r.user_id === userId))
    .map((r) => ({ ...r, m: memberById.get(r.user_id) }))
    .sort((a, b) => new Date(a.clocked_in_at) - new Date(b.clocked_in_at));

  if (people.length === 0) return null;

  const nameFor = (r) => r.m?.name || (r.user_id === userId ? settings?.name : "") || "Member";
  const avatarFor = (r) => r.m?.avatar_url || (r.user_id === userId ? settings?.avatarUrl : "") || "";

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Who's working now"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
          dark ? "bg-[var(--color-surface-raised)] text-slate-300 hover:text-slate-100" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
        }`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        <Briefcase className="w-3.5 h-3.5" />
        <span className="tabular-nums">{people.length}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={244} dark={dark}>
        <p className={`px-2 py-1 text-[10px] uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-400"}`}>Working now</p>
        <ul className="space-y-0.5">
          {people.map((r) => (
            <li key={r.user_id} className="flex items-center gap-2 px-2 py-1.5">
              <span className="relative shrink-0">
                <UserAvatar url={avatarFor(r)} name={nameFor(r)} size={24} />
                <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-1 ${r.on_break ? "bg-orange-500" : "bg-emerald-500"} ${dark ? "ring-[var(--color-surface-raised)]" : "ring-white"}`} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[11px] font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
                  {nameFor(r)}
                  {r.user_id === userId && <span className={`ml-1 text-[9px] font-bold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>you</span>}
                </span>
                <span className={`block text-[10px] truncate ${dark ? "text-slate-500" : "text-slate-400"}`}>
                  {r.on_break ? (
                    <span className="inline-flex items-center gap-1 text-orange-400"><Coffee className="w-2.5 h-2.5" /> on lunch</span>
                  ) : (
                    <>{r.task?.trim() ? r.task : "working"} · {formatSince(r.clocked_in_at)}</>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Popover>
    </>
  );
}
