import { useEffect, useState } from "react";
import { Clock, Globe, Palmtree } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useTeam } from "../../context/TeamContext";
import { useTheme } from "../../context/ThemeContext";
import UserAvatar from "../UserAvatar";
import FollowButton from "../FollowButton";
import { presenceDot, presenceLabel } from "../../lib/presence";
import { getProfile } from "../../lib/profiles";
import { getUserWorkSummary } from "../../lib/workStatus";
import { useVisibilityPausedInterval } from "../../hooks/useVisibilityPausedInterval";
import { availability, isOutOfOfficeAny, tzAbbrev } from "../../lib/timezone";
import { formatDuration } from "../../lib/utils";

// Shared identity block — used by the click popover and the full profile page.
// Identity (name/avatar/handle/bio) comes from `profiles`; presence/status/teams
// come from the already-loaded team data (TeamContext) when the person is a
// teammate.
export default function ProfileCard({ userId, onOpenFull }) {
  const { session } = useApp();
  const { teamMembers, teamsByUserId } = useTeam();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [profile, setProfile] = useState(null);
  const [sum, setSum] = useState(null);
  const [, force] = useState(0); // re-render to keep the local clock fresh

  useEffect(() => {
    let on = true;
    setSum(null);
    getProfile(userId).then((p) => { if (on) setProfile(p); });
    getUserWorkSummary(userId).then((s) => { if (on) setSum(s); }); // null unless self/admin
    return () => { on = false; };
  }, [userId]);

  useVisibilityPausedInterval(() => force((n) => n + 1), 30000);

  const isMe = session?.user?.id === userId;
  const { label: localTime, badge: hoursBadge, loc } = availability(profile || {});
  const tzab = tzAbbrev(profile?.timezone);
  const oooRange = isOutOfOfficeAny(profile || {});
  const ooo = !!oooRange;
  const oooNote = oooRange?.note || "";
  const oooUntil = oooRange?.end
    ? new Date(`${oooRange.end}T00:00`).toLocaleDateString([], { month: "short", day: "numeric" })
    : null;

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
          {profile?.job_title && <div className={`text-[11px] truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>{profile.job_title}</div>}
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

      {ooo && (
        <div className={`flex items-center gap-1.5 mt-2.5 text-[11px] font-semibold ${dark ? "text-amber-300" : "text-amber-600"}`}>
          <Palmtree className="w-3.5 h-3.5 shrink-0" />
          <span>Out of office{oooNote ? ` · ${oooNote}` : ""}{oooUntil ? ` · until ${oooUntil}` : ""}</span>
        </div>
      )}

      {!isMe && localTime && (
        <div className={`flex items-center gap-1.5 mt-2.5 text-[11px] ${dark ? "text-slate-400" : "text-slate-500"}`}>
          <Globe className="w-3 h-3 shrink-0" />
          <span>
            <span className={`font-semibold ${dark ? "text-slate-200" : "text-slate-700"}`}>{localTime}</span>
            {tzab ? ` ${tzab}` : ""} their time
            {!ooo && loc && <span>{" · "}{loc === "home" ? "🏠 WFH" : "🏢 in office"}</span>}
            {!ooo && hoursBadge && (
              <span className={hoursBadge === "off hours" ? (dark ? " text-amber-300" : " text-amber-600") : (dark ? " text-slate-400" : " text-slate-500")}>
                {" · "}{hoursBadge}
              </span>
            )}
          </span>
        </div>
      )}

      {sum && (
        <div className={`flex items-center gap-1.5 mt-1.5 text-[11px] ${dark ? "text-slate-400" : "text-slate-500"}`}>
          <Clock className="w-3 h-3 shrink-0" />
          <span><span className={`font-semibold ${dark ? "text-slate-200" : "text-slate-700"}`}>{formatDuration(sum.today_minutes)}</span> today · {formatDuration(sum.week_minutes)} this week</span>
        </div>
      )}

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
