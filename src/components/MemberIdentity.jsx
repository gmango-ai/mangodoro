import { useTeam } from "../context/TeamContext";
import { useTheme } from "../context/ThemeContext";
import UserAvatar from "./UserAvatar";

// Shared "this user appeared here" primitive. Renders avatar + name +
// team chips off TeamContext's teamsByUserId map so we never re-fetch
// per surface. Used in sync sessions, retros, rooms, and live cards —
// anywhere outside the /team People page.
//
// Why a leader-ring instead of an extra "Lead" badge: keeping row
// height stable matters in dense lists like SyncParticipantList;
// the violet ring is a strong visual signal in a small footprint.
export default function MemberIdentity({
  userId,
  fallbackName = "",
  fallbackAvatarUrl = null,
  size = 28,
  showTeams = true,
  showName = true,
  nameSuffix = null,
  className = "",
}) {
  const { teamsByUserId, teamMembers } = useTeam();
  const { theme } = useTheme();
  const dark = theme === "dark";

  // teamMembers carries the authoritative name + avatar for org
  // members. Fallbacks let us still render guests / anon participants
  // who aren't in teamMembers but whose row payload has display_name.
  const member = userId ? (teamMembers || []).find((m) => m.user_id === userId) : null;
  const name = member?.name || fallbackName || "Someone";
  const avatarUrl = member?.avatar_url || fallbackAvatarUrl;

  const userTeams = (userId && teamsByUserId?.get(userId)) || [];
  const isLead = userTeams.some((t) => t.role === "lead");

  // Subtle violet ring marks leads — visible against both light and
  // dark themes. Padding (ring-offset) keeps it from touching the
  // avatar edges so it reads as a halo, not a stroke.
  const ringWrapper = isLead
    ? `relative rounded-full ring-2 ring-offset-1 ${
        dark ? "ring-violet-400 ring-offset-slate-900" : "ring-violet-500 ring-offset-white"
      }`
    : "";

  return (
    <span className={`inline-flex items-center gap-2 min-w-0 ${className}`}>
      <span className={`${ringWrapper} shrink-0`}>
        <UserAvatar url={avatarUrl} name={name} size={size} />
      </span>
      {showName && (
        <span className="inline-flex items-center gap-1.5 min-w-0 flex-wrap">
          <span className={`text-sm font-semibold truncate ${
            dark ? "text-slate-200" : "text-slate-800"
          }`}>
            {name}{nameSuffix}
          </span>
          {showTeams && userTeams.length > 0 && (
            <span className="inline-flex flex-wrap gap-1">
              {userTeams.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{
                    background: `${t.color}22`,
                    color: dark ? "#fff" : t.color,
                    border: `1px solid ${t.color}55`,
                  }}
                  title={t.role === "lead" ? `${t.name} (lead)` : t.name}
                >
                  <span className="w-1 h-1 rounded-full" style={{ background: t.color }} />
                  {t.name}
                </span>
              ))}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
