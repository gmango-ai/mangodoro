import { useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { X, Briefcase, Star } from "lucide-react";
import UserAvatar from "./UserAvatar";
import Modal from "./Modal";
import { addOrgTeamMember, removeOrgTeamMember, setOrgTeamMemberRole } from "../lib/orgTeam";

// Per-member view of team membership: lists every org_team and lets
// the admin toggle the user in or out, plus promote/demote them as
// team lead for the teams they're already in. Mirror of
// OrgTeamMembersModal — that one is team-centric ("who's in SWE?"),
// this one is member-centric ("what teams is Jacob on?").
export default function MemberTeamsModal({
  open, onClose, member, orgTeams, currentTeamIds, currentLeadTeamIds, onChange,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [pending, setPending] = useState(null); // org_team_id currently saving

  // Re-derive the sets on every open so an external change (e.g. the
  // team-centric modal flipping the same user) shows up here too.
  const [memberTeamIds, setMemberTeamIds] = useState(new Set());
  const [leadTeamIds, setLeadTeamIds] = useState(new Set());
  useEffect(() => {
    if (!open) return;
    setMemberTeamIds(new Set(currentTeamIds || []));
    setLeadTeamIds(new Set(currentLeadTeamIds || []));
    setPending(null);
  }, [open, currentTeamIds, currentLeadTeamIds]);

  if (!open || !member) return null;

  async function toggleMembership(team) {
    const has = memberTeamIds.has(team.id);
    setPending(team.id);
    const { error } = has
      ? await removeOrgTeamMember(team.id, member.user_id)
      : await addOrgTeamMember(team.id, member.user_id);
    setPending(null);
    if (error) return;
    const next = new Set(memberTeamIds);
    if (has) {
      next.delete(team.id);
      // Removing the user also drops their lead status for that team.
      if (leadTeamIds.has(team.id)) {
        const nextLead = new Set(leadTeamIds);
        nextLead.delete(team.id);
        setLeadTeamIds(nextLead);
      }
    } else {
      next.add(team.id);
    }
    setMemberTeamIds(next);
    onChange?.();
  }

  async function toggleLead(team) {
    if (!memberTeamIds.has(team.id)) return; // safety
    const isLead = leadTeamIds.has(team.id);
    setPending(team.id);
    const { error } = await setOrgTeamMemberRole(
      team.id,
      member.user_id,
      isLead ? "member" : "lead",
    );
    setPending(null);
    if (error) return;
    const next = new Set(leadTeamIds);
    isLead ? next.delete(team.id) : next.add(team.id);
    setLeadTeamIds(next);
    onChange?.();
  }

  const cardCls = `relative w-full max-w-md rounded-2xl border p-5 sm:p-6 max-h-[80vh] flex flex-col ${
    dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
  }`;

  return (
    <Modal onClose={onClose}>
      <div className={cardCls} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className={`absolute top-3 right-3 p-1.5 rounded-lg ${
            dark ? "hover:bg-[var(--color-surface-raised)] text-slate-400" : "hover:bg-slate-100 text-slate-500"
          }`}
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <UserAvatar url={member.avatar_url} name={member.name} size={36} />
          <div className="min-w-0">
            <h2 className={`text-base font-bold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
              {member.name}
            </h2>
            <p className={`text-[11px] ${dark ? "text-slate-400" : "text-slate-500"}`}>
              {memberTeamIds.size} of {(orgTeams || []).length} teams
            </p>
          </div>
        </div>

        {(!orgTeams || orgTeams.length === 0) ? (
          <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
            No teams yet in this org. Create one in the Teams card above.
          </p>
        ) : (
          <ul className="flex-1 overflow-y-auto -mx-1 px-1 space-y-1.5">
            {orgTeams.map((t) => {
              const has = memberTeamIds.has(t.id);
              const isLead = leadTeamIds.has(t.id);
              const busy = pending === t.id;
              return (
                <li
                  key={t.id}
                  className={`flex items-center gap-3 px-2.5 py-2 rounded-lg ${
                    dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-50"
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-md border border-black/10 shrink-0"
                    style={{ background: t.color || "#14b8a6" }}
                  />
                  <Briefcase className={`w-3.5 h-3.5 shrink-0 ${dark ? "text-slate-500" : "text-slate-400"}`} />
                  <span className={`flex-1 min-w-0 text-sm font-medium truncate ${
                    dark ? "text-slate-100" : "text-slate-800"
                  }`}>
                    {t.name}
                  </span>
                  {/* Lead toggle — only meaningful when the user is in
                      the team. Tapping promotes/demotes via
                      setOrgTeamMemberRole. */}
                  {has && (
                    <button
                      type="button"
                      onClick={() => toggleLead(t)}
                      disabled={busy}
                      title={isLead ? "Demote to member" : "Promote to team lead"}
                      className={`h-7 px-2 inline-flex items-center gap-1 rounded-md text-[11px] font-semibold border transition-colors ${
                        isLead
                          ? dark
                            ? "bg-violet-500/15 border-violet-400/40 text-violet-200 hover:bg-violet-500/25"
                            : "bg-violet-100 border-violet-300 text-violet-700 hover:bg-violet-200"
                          : dark
                            ? "bg-transparent border-[var(--color-border)] text-slate-400 hover:text-violet-300 hover:border-violet-500/40"
                            : "bg-transparent border-slate-300 text-slate-500 hover:text-violet-600 hover:border-violet-400"
                      }`}
                    >
                      <Star className="w-3 h-3" fill={isLead ? "currentColor" : "none"} />
                      {isLead ? "Lead" : "Promote"}
                    </button>
                  )}
                  <Button
                    size="sm"
                    variant={has ? "default" : "outline"}
                    onClick={() => toggleMembership(t)}
                    disabled={busy}
                    className="h-7 text-xs"
                  >
                    {busy ? "…" : has ? "Member" : "Add"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex justify-end mt-4">
          <Button variant="outline" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}
