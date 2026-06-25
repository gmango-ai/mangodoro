import { useEffect, useMemo, useState } from "react";
import { Network, Crown, Building2 } from "lucide-react";
import { useTeam } from "../../context/TeamContext";
import { useProfileCard } from "../../context/ProfileContext";
import { getProfiles } from "../../lib/profiles";
import UserAvatar from "../UserAvatar";

// "Who's who" — the org grouped by department, with names + job titles. A
// lightweight org chart (no reporting lines yet; needs a manager field). Job
// titles come from profiles; click anyone to open their profile card.
export default function OrgChart({ dark }) {
  const { activeTeam, teamMembers = [], orgTeams = [], teamsByUserId } = useTeam();
  const { openProfile } = useProfileCard();
  const [profById, setProfById] = useState({});

  const ids = useMemo(() => (teamMembers || []).map((m) => m.user_id), [teamMembers]);
  useEffect(() => {
    if (!ids.length) { setProfById({}); return; }
    getProfiles(ids).then(setProfById);
  }, [ids.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!activeTeam) return null;
  const surface = dark ? "var(--color-surface)" : "#fff";
  const border = dark ? "var(--color-border)" : "rgb(226,232,240)";

  const deptsOf = (uid) => teamsByUserId?.get(uid) || [];
  const groups = orgTeams.map((d) => ({
    dept: d,
    members: (teamMembers || []).filter((m) => deptsOf(m.user_id).some((t) => String(t.id) === String(d.id))),
  }));
  const noDept = (teamMembers || []).filter((m) => deptsOf(m.user_id).length === 0);

  const member = (m, dept) => {
    const p = profById[m.user_id];
    const title = p?.job_title || "";
    const isLead = dept && deptsOf(m.user_id).some((t) => String(t.id) === String(dept.id) && t.role === "lead");
    return (
      <button
        key={m.user_id}
        type="button"
        onClick={(e) => openProfile?.(m.user_id, e.currentTarget.getBoundingClientRect())}
        className={`flex items-center gap-2 w-full text-left rounded-lg px-2 py-1.5 transition-colors ${dark ? "hover:bg-white/5" : "hover:bg-slate-50"}`}
      >
        <UserAvatar url={p?.avatar_url || m.avatar_url || ""} name={p?.display_name || m.name || "Member"} size={28} />
        <span className="min-w-0 flex-1">
          <span className={`block text-[13px] font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
            {p?.display_name || m.name || "Member"}
          </span>
          {title && <span className={`block text-[11px] truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>{title}</span>}
        </span>
        {isLead && <Crown className="w-3.5 h-3.5 text-[var(--color-accent)] shrink-0" fill="currentColor" />}
      </button>
    );
  };

  return (
    <div className="rounded-2xl border p-4" style={{ background: surface, borderColor: border }}>
      <div className="flex items-center gap-2 mb-3">
        <Network className="w-4 h-4 text-[var(--color-accent)]" />
        <span className={`text-sm font-bold ${dark ? "text-slate-200" : "text-slate-700"}`}>Org chart</span>
        <span className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>{teamMembers.length} {teamMembers.length === 1 ? "person" : "people"}</span>
      </div>

      <div className="flex items-center gap-1.5 mb-3">
        <Building2 className="w-3.5 h-3.5 text-[var(--color-accent)]" />
        <span className={`text-[13px] font-semibold ${dark ? "text-slate-100" : "text-slate-800"}`}>{activeTeam.name}</span>
      </div>

      <div className="flex flex-col gap-3">
        {groups.map(({ dept, members }) => (
          <div key={dept.id}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className="w-2 h-2 rounded-full" style={{ background: dept.color || "#64748b" }} />
              <span className={`text-[12px] font-semibold ${dark ? "text-slate-200" : "text-slate-700"}`}>{dept.name}</span>
              <span className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>{members.length}</span>
            </div>
            {members.length === 0 ? (
              <p className={`text-[11px] pl-3.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>No one yet.</p>
            ) : (
              <div className="pl-1">{members.map((m) => member(m, dept))}</div>
            )}
          </div>
        ))}

        {noDept.length > 0 && (
          <div>
            <div className={`text-[12px] font-semibold mb-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>
              {orgTeams.length ? "Not in a department" : "Everyone"}
            </div>
            <div className="pl-1">{noDept.map((m) => member(m, null))}</div>
          </div>
        )}
      </div>
    </div>
  );
}
