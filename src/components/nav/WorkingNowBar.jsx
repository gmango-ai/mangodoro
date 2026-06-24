import { useEffect, useRef, useState } from "react";
import { Briefcase, Coffee } from "lucide-react";
import { supabase } from "../../supabase";
import { useApp } from "../../context/AppContext";
import { useTeam } from "../../context/TeamContext";
import { listClockedIn } from "../../lib/workStatus";
import UserAvatar from "../UserAvatar";
import Popover from "../goals/Popover";

function elapsedSince(iso) {
  if (!iso) return "";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff <= 0) return "just now";
  return diff >= 60 ? `${Math.floor(diff / 60)}h ${diff % 60}m` : `${diff}m`;
}

// Compact "who's working now" pill for the top bar — a count that opens a
// roster of clocked-in teammates (task + elapsed). Hidden when nobody's working.
export default function WorkingNowBar({ dark }) {
  const { session, settings } = useApp();
  const { teamMembers = [] } = useTeam();
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const userId = session?.user?.id;

  useEffect(() => {
    let alive = true;
    const load = () => listClockedIn().then((d) => { if (alive) setRows(d); });
    load();
    const ch = supabase
      .channel("work_status:bar")
      .on("postgres_changes", { event: "*", schema: "public", table: "work_status" }, load)
      .subscribe();
    const poll = setInterval(load, 60000);
    return () => { alive = false; supabase.removeChannel(ch); clearInterval(poll); };
  }, []);

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
                    <>{r.task?.trim() ? r.task : "working"} · {elapsedSince(r.clocked_in_at)}</>
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
