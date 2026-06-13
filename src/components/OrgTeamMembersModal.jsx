import { useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import UserAvatar from "./UserAvatar";
import {
  listOrgTeamMembers, addOrgTeamMember, removeOrgTeamMember,
} from "../lib/orgTeam";

// Admin modal for adding/removing org members in a single org_team.
// Shows the full org roster with a check next to each existing member.
// Toggling persists immediately so the admin sees the count update on
// the parent without waiting for a Save click.
export default function OrgTeamMembersModal({
  open, onClose, orgTeam, orgMembers, onChange,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [memberIds, setMemberIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState(null);

  useEffect(() => {
    if (!open || !orgTeam?.id) return;
    let cancelled = false;
    setLoading(true);
    listOrgTeamMembers(orgTeam.id).then(({ data }) => {
      if (cancelled) return;
      setMemberIds(new Set((data || []).map((r) => r.user_id)));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, orgTeam?.id]);

  if (!open || !orgTeam) return null;

  async function toggle(member) {
    if (!orgTeam?.id) return;
    const has = memberIds.has(member.user_id);
    setBusyUserId(member.user_id);
    if (has) {
      const { error } = await removeOrgTeamMember(orgTeam.id, member.user_id);
      if (!error) {
        const next = new Set(memberIds);
        next.delete(member.user_id);
        setMemberIds(next);
        onChange?.();
      }
    } else {
      const { error } = await addOrgTeamMember(orgTeam.id, member.user_id);
      if (!error) {
        const next = new Set(memberIds);
        next.add(member.user_id);
        setMemberIds(next);
        onChange?.();
      }
    }
    setBusyUserId(null);
  }

  const cardCls = `relative w-full max-w-md rounded-2xl border p-5 sm:p-6 max-h-[80vh] flex flex-col ${
    dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"
  }`;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4"
      onClick={onClose}
    >
      <div className={cardCls} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className={`absolute top-3 right-3 p-1.5 rounded-lg ${
            dark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-100 text-slate-500"
          }`}
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <span
            className="w-3 h-3 rounded-md border border-black/10"
            style={{ background: orgTeam.color || "#14b8a6" }}
          />
          <h2 className={`text-lg font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
            {orgTeam.name}
          </h2>
          <span className={`ml-auto text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>
            {memberIds.size} / {orgMembers.length}
          </span>
        </div>

        {loading ? (
          <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>Loading…</p>
        ) : orgMembers.length === 0 ? (
          <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
            No members in this org yet.
          </p>
        ) : (
          <ul className="flex-1 overflow-y-auto -mx-1 px-1 space-y-1.5">
            {orgMembers.map((m) => {
              const has = memberIds.has(m.user_id);
              const busy = busyUserId === m.user_id;
              return (
                <li
                  key={m.user_id}
                  className={`flex items-center gap-3 px-2.5 py-2 rounded-lg ${
                    dark ? "bg-slate-800/40" : "bg-slate-50"
                  }`}
                >
                  <UserAvatar url={m.avatar_url} name={m.name} size={28} className="shrink-0" />
                  <span className={`flex-1 min-w-0 text-sm truncate ${
                    dark ? "text-slate-100" : "text-slate-800"
                  }`}>
                    {m.name}
                  </span>
                  <Button
                    size="sm"
                    variant={has ? "default" : "outline"}
                    onClick={() => toggle(m)}
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
    </div>
  );
}
