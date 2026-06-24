import { useEffect, useState } from "react";
import { Briefcase } from "lucide-react";
import { supabase } from "../../supabase";
import { useApp } from "../../context/AppContext";
import { useTeam } from "../../context/TeamContext";
import { listClockedIn } from "../../lib/workStatus";
import UserAvatar from "../UserAvatar";
import WidgetSection from "./WidgetSection";

function elapsedSince(iso) {
  if (!iso) return "";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff <= 0) return "just now";
  return diff >= 60 ? `${Math.floor(diff / 60)}h ${diff % 60}m` : `${diff}m`;
}

// Who on the team is clocked in right now — name, what they're on, and how long.
// Reads the team-visible work_status (RLS = own + teammates), kept live by a
// realtime subscription + a minute poll (so the elapsed label stays fresh).
export default function WorkingNowWidget({ dark }) {
  const { session, settings } = useApp();
  const { teamMembers = [] } = useTeam();
  const [rows, setRows] = useState([]);
  const userId = session?.user?.id;

  useEffect(() => {
    let alive = true;
    const load = () => listClockedIn().then((d) => { if (alive) setRows(d); });
    load();
    const ch = supabase
      .channel("work_status:list")
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

  const nameFor = (r) => r.m?.name || (r.user_id === userId ? settings?.name : "") || "Member";
  const avatarFor = (r) => r.m?.avatar_url || (r.user_id === userId ? settings?.avatarUrl : "") || "";

  return (
    <WidgetSection
      id="working-now"
      icon={Briefcase}
      title="Working now"
      dark={dark}
      action={people.length > 0 ? <span className="text-[10px] font-bold tabular-nums">{people.length}</span> : null}
    >
      {people.length === 0 ? (
        <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>No one's clocked in right now.</p>
      ) : (
        <ul className="space-y-1.5">
          {people.map((r) => (
            <li key={r.user_id} className="flex items-center gap-2">
              <span className="relative shrink-0">
                <UserAvatar url={avatarFor(r)} name={nameFor(r)} size={24} />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-1 ${r.on_break ? "bg-orange-500" : "bg-emerald-500"} ${dark ? "ring-[var(--color-surface)]" : "ring-white"}`}
                  aria-hidden
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[11px] font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
                  {nameFor(r)}
                  {r.user_id === userId && <span className={`ml-1 text-[9px] font-bold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>you</span>}
                </span>
                <span className={`block text-[10px] truncate ${dark ? "text-slate-500" : "text-slate-400"}`}>
                  {r.on_break ? (
                    <span className="text-orange-400">on break</span>
                  ) : (
                    <>{r.task?.trim() ? r.task : "working"} · {elapsedSince(r.clocked_in_at)}</>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </WidgetSection>
  );
}
