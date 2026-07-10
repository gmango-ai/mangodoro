import { useMemo } from "react";
import { useTheme } from "../context/ThemeContext";
import { useTeam } from "../context/TeamContext";
import UserAvatar from "./UserAvatar";
import { availabilityDot, availabilityRing, shownAvailability } from "../lib/presence";
import { usePresenceById } from "../hooks/usePresenceById";
import { Briefcase, MessageSquare, Lock, LockOpen, Crown, Hash, Star } from "lucide-react";

const KIND_ICON = {
  department: Briefcase,
  meeting: MessageSquare,
  private: Lock,
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
function OccupantAvatar({ occupant, isLeader, userTeams, size = 28, presenceById }) {
  const ring = availabilityRing(shownAvailability(occupant.user_id, presenceById));
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

export default function RoomTile({ room, activeSession, vibe, busy, onJoin, size: sizeOverride, onOpen, locked = false, lockedReason }) {
  const { theme } = useTheme();
  const { teamsByUserId, restrictedRoomIds } = useTeam();
  const dark = theme === "dark";
  const presenceById = usePresenceById();

  const size = sizeOverride || pickSize(room.layout_w || 4, room.layout_h || 2);

  const isOccupied = !!activeSession;
  const isPulsing = vibe === "active" && isOccupied && activeSession?.is_running;

  // Per-room identity, dialed way down: a faint wash of the room's color
  // over the neutral surface so each room reads as "its own" — without the
  // saturated stripes/borders that made the floor feel off-brand. Mixed
  // into --color-surface so it adapts to light/dark automatically.
  const accent = room.color || "#14b8a6";
  const tintStyle = { background: `color-mix(in srgb, ${accent} 10%, var(--color-surface))` };

  // Sort occupants so the leader shows first in the stack.
  const occupants = useMemo(() => {
    const leaderId = activeSession?.leader_id;
    return (activeSession?.occupants || []).slice().sort((a, b) => {
      const al = a.user_id === leaderId ? -1 : 0;
      const bl = b.user_id === leaderId ? -1 : 0;
      return al - bl;
    });
  }, [activeSession?.occupants, activeSession?.leader_id]);

  // Private rooms get a DYNAMIC lock: open (unlocked) while empty, locked once
  // someone is inside. Other kinds keep their static kind icon.
  const someoneInside = occupants.length > 0;
  const Icon = room.kind === "private"
    ? (someoneInside ? Lock : LockOpen)
    : (KIND_ICON[room.kind] || Hash);

  const tone = isOccupied
    ? dark
      ? "bg-[var(--color-surface)] border-[var(--color-accent)] shadow-md"
      : "bg-white border-[var(--color-accent)] shadow-md"
    : dark
      ? "bg-[var(--color-surface)] border-[var(--color-border)]"
      : "bg-white border-slate-200";
  const pulse = isPulsing
    ? "animate-[pulse_3s_ease-in-out_infinite] border-[var(--color-accent)]"
    : "";

  // `handlePrimary` is the single click action for the whole tile.
  // Prefer onOpen (which routes to the popover) when provided, falling
  // back to onJoin (legacy single-action behavior). Locked (department-
  // gated) tiles still click through — they land on the knock gate, where
  // the viewer can ask to be let in rather than being a dead end.
  function handlePrimary() {
    if (busy) return;
    if (onOpen) onOpen(room);
    else if (onJoin) onJoin(room);
  }

  // Common visual treatment for any locked tile size: dim the body and a
  // lock badge in the top-right, with a tooltip inviting a knock.
  // A department-gated room the viewer isn't a member of. Non-admins get the
  // dimmed+badged treatment (via `locked`) but can still click to knock. Admins
  // aren't in `locked` (they can enter for management), but we badge the tile as
  // restricted so the gating stays visible — an admin shouldn't read a
  // department room as open to all just because they personally can walk in.
  const isRestricted = restrictedRoomIds?.has?.(room.id) || false;
  const showLock = locked || isRestricted;
  const lockedClass = locked ? "opacity-75" : "";
  const lockTooltip = locked
    ? (lockedReason
        ? `${lockedReason} — knock to ask to be let in`
        : "Locked — knock to ask to be let in")
    : isRestricted
      ? "Restricted to a department — you can enter as an admin"
      : "";
  const LockBadge = showLock ? (
    <span
      className={`absolute top-1.5 right-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] z-10 ${
        dark ? "bg-[var(--color-surface-raised)] text-slate-400 border border-[var(--color-border)]" : "bg-slate-100 text-slate-500 border border-slate-200"
      }`}
      aria-hidden
    >
      <Lock className="w-2.5 h-2.5" />
    </span>
  ) : null;

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
        title={showLock ? lockTooltip : `${room.name} — ${dotTitle}`}
        className={`relative flex flex-col items-center justify-center rounded-2xl border p-2 transition-all h-full w-full text-center overflow-hidden ${tone} ${pulse} ${lockedClass} hover:border-[var(--color-accent)]`}
        style={tintStyle}
      >
        {LockBadge}
        <div className="p-1.5 rounded-lg mb-1 bg-[var(--color-accent-light)] text-[var(--color-accent)]">
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
                className={`w-1.5 h-1.5 rounded-full ${availabilityDot(shownAvailability(o.user_id, presenceById))}`}
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

  // Shared layout choices for md + lg. Huly-inspired: name at top-left,
  // status icon at top-right, avatars centered. No bottom CTA — the
  // entire tile is the click target.
  const isLg = size === "lg";
  const padding = isLg ? "p-4" : "p-3";
  const nameSize = isLg ? "text-base" : "text-sm";
  const avatarSize = isLg ? 32 : 26;
  const maxAvatars = isLg ? 8 : 6;

  const visible = occupants.slice(0, maxAvatars);
  const overflow = Math.max(0, occupants.length - maxAvatars);

  return (
    <button
      type="button"
      onClick={handlePrimary}
      disabled={busy}
      title={showLock ? lockTooltip : undefined}
      className={`relative flex flex-col text-left rounded-2xl border ${padding} transition-colors h-full w-full overflow-hidden ${tone} ${pulse} ${lockedClass} hover:border-[var(--color-accent)]`}
      style={tintStyle}
    >
      {LockBadge}
      {/* Top row — name + small status indicator. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p
            className={`${nameSize} font-semibold truncate ${
              dark ? "text-slate-100" : "text-slate-800"
            }`}
          >
            {room.name}
          </p>
          {/* Soft secondary line — kind + (private badge). Icon tinted
              with the room's accent so each room reads at a glance. */}
          <p className={`text-[10px] mt-0.5 inline-flex items-center gap-1 ${
            dark ? "text-slate-500" : "text-slate-400"
          }`}>
            <Icon className="w-2.5 h-2.5 opacity-90 text-[var(--color-accent)]" />
            {KIND_LABEL[room.kind]}
            {room.kind === "private" && (
              <span className={`uppercase tracking-wider font-bold ${
                someoneInside
                  ? (dark ? "text-amber-300" : "text-amber-700")
                  : (dark ? "text-emerald-300" : "text-emerald-700")
              }`}>
                · {someoneInside ? "Locked" : "Open"}
              </span>
            )}
          </p>
        </div>
        {/* Top-right status. Mirror Huly's video-icon-when-in-session
            convention; here it's the pomodoro timer icon. */}
        {isOccupied && (
          <span
            className={`shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold ${
              "text-[var(--color-accent)]"
            }`}
            title={`${modeLabel(activeSession.mode)} · ${timeLeft(activeSession)}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
            {timeLeft(activeSession)}
          </span>
        )}
      </div>

      {/* Body — avatars centered. Empty rooms stay visually quiet
          (no "Nobody here" text); the whitespace itself communicates
          emptiness, matching Huly's restraint. */}
      <div className="flex-1 flex items-center justify-center min-h-0 my-2">
        {isOccupied && (
          <div className="flex items-center flex-wrap justify-center">
            {visible.map((o) => (
              <OccupantAvatar
                key={o.user_id}
                occupant={o}
                isLeader={o.user_id === activeSession.leader_id}
                userTeams={teamsByUserId?.get(o.user_id)}
                size={avatarSize}
                presenceById={presenceById}
              />
            ))}
            {overflow > 0 && (
              <span
                className={`-ml-1 inline-flex items-center justify-center rounded-full text-[10px] font-semibold ${
                  isLg ? "w-8 h-8" : "w-7 h-7"
                } ring-2 ring-transparent ${
                  dark ? "bg-[var(--color-surface-raised)] text-slate-300" : "bg-slate-200 text-slate-700"
                }`}
                title={`${overflow} more`}
              >
                +{overflow}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
