import { useTheme } from "../context/ThemeContext";
import { useTeam } from "../context/TeamContext";
import UserAvatar from "./UserAvatar";
import { Briefcase, MessageSquare, Lock, Crown, Hash, Star, Users } from "lucide-react";

// Map a participant's presence_state to the dot fill used in the
// compact tile. Falls back to neutral for unknown values.
const PRESENCE_DOT = {
  active: "bg-emerald-500",
  available: "bg-sky-500",
  heads_down: "bg-violet-500",
  in_meeting: "bg-rose-500",
  away: "bg-amber-500",
};

const KIND_ICON = {
  department: Briefcase,
  meeting: MessageSquare,
  private: Lock,
};

const PRESENCE_RING = {
  active: "ring-emerald-500",
  available: "ring-sky-500",
  heads_down: "ring-violet-500",
  in_meeting: "ring-rose-500",
  away: "ring-amber-500",
};

const KIND_LABEL = {
  department: "Department",
  meeting: "Meeting",
  private: "Private",
};

function modeLabel(m) {
  return m === "shortBreak" ? "Short break" : m === "longBreak" ? "Long break" : "Focus";
}

function timeLeft(s) {
  if (!s) return "";
  if (!s.is_running || !s.ends_at) return `${Math.ceil((s.remaining_seconds || 0) / 60)}m`;
  return `${Math.max(0, Math.ceil((new Date(s.ends_at).getTime() - Date.now()) / 60000))}m left`;
}

// Pick a visual density tier from the tile's grid footprint. The tile
// content adapts so a small room reads as a tidy shortcut while a big
// room shows its full chrome. The thresholds were tuned against the
// 12-column ROW_HEIGHT=96 grid where 4×2 is "the default" feel:
//   compact  (area ≤ 4 OR very thin)   → centered icon + name, no chrome
//   standard (default)                  → full chrome
//   showcase (≥ 5 wide AND ≥ 3 tall)    → larger fonts + bigger avatars
function pickSize(w, h) {
  const area = w * h;
  if (area <= 4 || w <= 2 || h === 1) return "sm";
  if (w >= 5 && h >= 3) return "lg";
  return "md";
}

// One avatar in the stack — overlapping ring + optional leader crown.
// Lead users (in any org_team) get a small violet star marker; team
// names are surfaced in the tooltip for quick "who is this?" scans.
function OccupantAvatar({ occupant, isLeader, userTeams, size = 28 }) {
  const ring = PRESENCE_RING[occupant.presence_state] || PRESENCE_RING.active;
  const isLead = (userTeams || []).some((t) => t.role === "lead");
  const teamNames = (userTeams || []).map((t) => t.name).join(" · ");
  const title = teamNames ? `${occupant.name} — ${teamNames}` : occupant.name;
  return (
    <div
      className={`relative shrink-0 rounded-full ring-2 ${ring} -ml-2 first:ml-0`}
      title={title}
    >
      <UserAvatar url={occupant.avatar_url} name={occupant.name} size={size} />
      {isLeader && (
        <Crown
          className="absolute -top-1.5 -right-1.5 w-3 h-3 text-amber-400 drop-shadow"
          fill="currentColor"
        />
      )}
      {isLead && !isLeader && (
        <Star
          className="absolute -top-1.5 -right-1.5 w-3 h-3 text-violet-400 drop-shadow"
          fill="currentColor"
        />
      )}
    </div>
  );
}

export default function RoomTile({ room, activeSession, vibe, busy, onJoin, size: sizeOverride, onOpen }) {
  const { theme } = useTheme();
  const { teamsByUserId } = useTeam();
  const dark = theme === "dark";
  const Icon = KIND_ICON[room.kind] || Hash;

  const size = sizeOverride || pickSize(room.layout_w || 4, room.layout_h || 2);

  const isOccupied = !!activeSession;
  const isPulsing = vibe === "active" && isOccupied && activeSession?.is_running;

  // Sort occupants so the leader shows first in the stack.
  const occupants = (activeSession?.occupants || []).slice().sort((a, b) => {
    const al = a.user_id === activeSession?.leader_id ? -1 : 0;
    const bl = b.user_id === activeSession?.leader_id ? -1 : 0;
    return al - bl;
  });

  const tone = isOccupied
    ? dark
      ? "bg-slate-900 border-cyan-500/30 shadow-[0_0_24px_rgba(6,182,212,0.08)]"
      : "bg-white border-teal-300/70 shadow-md"
    : dark
      ? "bg-slate-900/50 border-slate-700/60"
      : "bg-white border-slate-200";
  const pulse = isPulsing
    ? dark
      ? "animate-[pulse_3s_ease-in-out_infinite] border-cyan-400/50"
      : "animate-[pulse_3s_ease-in-out_infinite] border-teal-400"
    : "";

  // `handlePrimary` is the single click action for the whole tile.
  // Prefer onOpen (which routes to the popover) when provided, falling
  // back to onJoin (legacy single-action behavior).
  function handlePrimary() {
    if (busy) return;
    if (onOpen) onOpen(room);
    else if (onJoin) onJoin(room);
  }

  // ── COMPACT ─────────────────────────────────────────────────────
  // For ≤2 wide tiles. Renders the room icon + name + occupant dots
  // (one per person, colored by presence). Tooltip on hover shows
  // the full occupant list. The whole tile is the click target — it
  // opens the action popover, where Join / Start / Enter live.
  if (size === "sm") {
    const dotTitle = isOccupied
      ? occupants.map((o) => o.name).join(", ")
      : "Nobody here";
    return (
      <button
        type="button"
        onClick={handlePrimary}
        disabled={busy}
        title={`${room.name} — ${dotTitle}`}
        className={`relative flex flex-col items-center justify-center rounded-2xl border p-2 transition-all h-full w-full text-center ${tone} ${pulse} ${
          dark ? "hover:border-cyan-500/50" : "hover:border-teal-300"
        }`}
      >
        <div
          className={`p-1.5 rounded-lg mb-1 ${
            isOccupied
              ? dark ? "bg-cyan-500/15 text-cyan-300" : "bg-teal-100 text-teal-700"
              : dark ? "bg-slate-800/60 text-slate-300" : "bg-slate-100 text-slate-600"
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
        </div>
        <p
          className={`text-[11px] font-bold truncate w-full px-1 leading-tight ${
            dark ? "text-slate-100" : "text-slate-800"
          }`}
        >
          {room.name}
        </p>
        {/* Occupant dots — one per person up to 6, then +N. Colors
            map to presence so a glance reads the room's energy. */}
        {isOccupied && (
          <div className="flex items-center justify-center gap-0.5 mt-1 flex-wrap max-w-full">
            {occupants.slice(0, 6).map((o) => (
              <span
                key={o.user_id}
                className={`w-1.5 h-1.5 rounded-full ${PRESENCE_DOT[o.presence_state] || "bg-emerald-500"}`}
                title={o.name}
              />
            ))}
            {occupants.length > 6 && (
              <span className={`text-[9px] font-bold ml-0.5 ${dark ? "text-slate-400" : "text-slate-500"}`}>
                +{occupants.length - 6}
              </span>
            )}
          </div>
        )}
      </button>
    );
  }

  // Settings shared by md + lg.
  const isLg = size === "lg";
  const padding = isLg ? "p-5" : "p-4";
  const iconBoxPad = isLg ? "p-2" : "p-1.5";
  const iconSize = isLg ? "w-4 h-4" : "w-3.5 h-3.5";
  const nameSize = isLg ? "text-base" : "text-sm";
  const avatarSize = isLg ? 32 : 28;
  const maxAvatars = isLg ? 8 : 6;
  const minAvatarRow = isLg ? "min-h-[40px]" : "min-h-[36px]";

  const visible = occupants.slice(0, maxAvatars);
  const overflow = Math.max(0, occupants.length - maxAvatars);

  return (
    <button
      type="button"
      onClick={handlePrimary}
      disabled={busy}
      className={`relative flex flex-col text-left rounded-2xl border ${padding} transition-all h-full w-full ${tone} ${pulse} ${
        dark ? "hover:border-cyan-500/50" : "hover:border-teal-300"
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div
          className={`${iconBoxPad} rounded-md shrink-0 ${
            dark ? "bg-slate-800/60 text-slate-300" : "bg-slate-100 text-slate-600"
          }`}
        >
          <Icon className={iconSize} />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={`${nameSize} font-bold truncate flex items-center gap-1.5 ${
              dark ? "text-slate-100" : "text-slate-800"
            }`}
          >
            {room.name}
            {room.kind === "private" && (
              <span
                className={`text-[9px] uppercase tracking-wider font-bold px-1 py-px rounded ${
                  dark ? "bg-amber-500/15 text-amber-300" : "bg-amber-50 text-amber-700"
                }`}
              >
                Private
              </span>
            )}
          </p>
          <p
            className={`text-[10px] uppercase tracking-wider ${
              dark ? "text-slate-500" : "text-slate-400"
            }`}
          >
            {KIND_LABEL[room.kind]}
          </p>
        </div>
      </div>

      {/* Avatar strip */}
      <div className={`flex items-center ${minAvatarRow} mb-3`}>
        {isOccupied ? (
          <>
            <div className="flex items-center">
              {visible.map((o) => (
                <OccupantAvatar
                  key={o.user_id}
                  occupant={o}
                  isLeader={o.user_id === activeSession.leader_id}
                  userTeams={teamsByUserId?.get(o.user_id)}
                  size={avatarSize}
                />
              ))}
            </div>
            {overflow > 0 && (
              <span
                className={`-ml-1 inline-flex items-center justify-center rounded-full text-[10px] font-semibold ${
                  isLg ? "w-8 h-8" : "w-7 h-7"
                } ring-2 ring-transparent ${
                  dark ? "bg-slate-800 text-slate-300" : "bg-slate-200 text-slate-700"
                }`}
                title={`${overflow} more`}
              >
                +{overflow}
              </span>
            )}
          </>
        ) : (
          <span className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"} inline-flex items-center gap-1.5`}>
            <Users className="w-3 h-3 opacity-60" />
            Nobody here
          </span>
        )}
      </div>

      {/* Session line */}
      <div className="mb-3 min-h-[16px]">
        {isOccupied && (
          <p className={`text-xs truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
            <span className={dark ? "text-slate-300" : "text-slate-700"}>
              {modeLabel(activeSession.mode)}
            </span>
            {" · "}
            {timeLeft(activeSession)}
            {" · "}
            {activeSession.participant_count}/{activeSession.max_participants}
          </p>
        )}
      </div>

      {/* Status pill — the affordance that used to be a button. The
          tile itself is the click target now; this just communicates
          what the popover will offer. */}
      <div className="mt-auto">
        <span
          className={`inline-flex items-center justify-center w-full ${
            isLg ? "text-sm py-2" : "text-xs py-1.5"
          } font-semibold rounded-md ${
            isOccupied
              ? dark ? "bg-cyan-500/15 text-cyan-200" : "bg-teal-50 text-teal-700"
              : dark ? "bg-slate-800/60 text-slate-300" : "bg-slate-100 text-slate-600"
          }`}
        >
          {isOccupied ? "Join session →" : "Open →"}
        </span>
      </div>
    </button>
  );
}
