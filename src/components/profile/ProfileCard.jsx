import { useEffect, useState } from "react";
import { useTeam } from "../../context/TeamContext";
import { useTheme } from "../../context/ThemeContext";
import UserAvatar from "../UserAvatar";
import FollowButton from "../FollowButton";
import { presenceDot, presenceLabel } from "../../lib/presence";
import { getProfile } from "../../lib/profiles";

// Shared identity block — used by the click popover and the full profile page.
// Identity (name/avatar/handle/bio) comes from `profiles`; presence/status/teams
// come from the already-loaded team data (TeamContext) when the person is a
// teammate.
export default function ProfileCard({ userId, onOpenFull }) {
  const { teamMembers, teamsByUserId } = useTeam();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    let on = true;
    getProfile(userId).then((p) => { if (on) setProfile(p); });
    return () => { on = false; };
  }, [userId]);

  const member = (teamMembers || []).find((m) => m.user_id === userId);
  const name = profile?.display_name || member?.name || "Member";
  const avatar = profile?.avatar_url || member?.avatar_url || "";
  const presence = member?.presence_state;
  const status = member?.status;
  const teams = teamsByUserId?.get(userId) || [];

  return (
    <div className="p-3.5" style={{ width: 256 }}>
      <div className="flex items-start gap-3">
        <UserAvatar url={avatar} name={name} size={48} />
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-bold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>{name}</div>
          {presence && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-2 h-2 rounded-full ${presenceDot(presence)}`} />
              <span className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>{presenceLabel(presence)}</span>
            </div>
          )}
          {profile?.handle && <div className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>@{profile.handle}</div>}
        </div>
        <FollowButton userId={userId} />
      </div>

      {status && <div className={`text-[13px] mt-2.5 ${dark ? "text-slate-300" : "text-slate-600"}`}>{status}</div>}
      {profile?.bio && <div className={`text-xs mt-1.5 leading-snug ${dark ? "text-slate-400" : "text-slate-500"}`}>{profile.bio}</div>}

      {teams.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2.5">
          {teams.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: `${t.color}22`, color: dark ? "#fff" : t.color, border: `1px solid ${t.color}55` }}
            >
              <span className="w-1 h-1 rounded-full" style={{ background: t.color }} /> {t.name}
            </span>
          ))}
        </div>
      )}

      {onOpenFull && (
        <button
          type="button"
          onClick={onOpenFull}
          className={`mt-3 w-full text-center text-xs font-semibold py-1.5 rounded-lg transition-colors ${dark ? "bg-white/10 text-slate-200 hover:bg-white/15" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
        >
          Open full profile
        </button>
      )}
    </div>
  );
}
