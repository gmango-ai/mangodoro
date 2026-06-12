import { useTheme } from "../context/ThemeContext";
import UserAvatar from "./UserAvatar";
import { Button } from "@/components/ui/button";
import { Briefcase, MessageSquare, Lock, Crown, Hash, Star } from "lucide-react";

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

// One avatar in the stack — overlapping ring + optional leader crown.
function OccupantAvatar({ occupant, isLeader }) {
  const ring = PRESENCE_RING[occupant.presence_state] || PRESENCE_RING.active;
  return (
    <div
      className={`relative shrink-0 rounded-full ring-2 ${ring} -ml-2 first:ml-0`}
      title={occupant.name}
    >
      <UserAvatar url={occupant.avatar_url} name={occupant.name} size={28} />
      {isLeader && (
        <Crown
          className="absolute -top-1.5 -right-1.5 w-3 h-3 text-amber-400 drop-shadow"
          fill="currentColor"
        />
      )}
    </div>
  );
}

const MAX_VISIBLE_AVATARS = 6;

export default function RoomTile({ room, activeSession, vibe, suggested = false, busy, onJoin }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const Icon = KIND_ICON[room.kind] || Hash;

  const isOccupied = !!activeSession;
  const isPulsing = vibe === "active" && isOccupied && activeSession?.is_running;

  // Sort occupants so the leader shows first in the stack.
  const occupants = (activeSession?.occupants || []).slice().sort((a, b) => {
    const al = a.user_id === activeSession?.leader_id ? -1 : 0;
    const bl = b.user_id === activeSession?.leader_id ? -1 : 0;
    return al - bl;
  });
  const visible = occupants.slice(0, MAX_VISIBLE_AVATARS);
  const overflow = Math.max(0, occupants.length - MAX_VISIBLE_AVATARS);

  // Tile chrome — empty vs occupied vs pulsing.
  const base = `relative flex flex-col rounded-2xl border p-4 transition-all h-full`;
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

  return (
    <div className={`${base} ${tone} ${pulse}`}>
      {/* Header — kind icon, name, badge */}
      <div className="flex items-center gap-2 mb-3">
        <div
          className={`p-1.5 rounded-md shrink-0 ${
            dark ? "bg-slate-800/60 text-slate-300" : "bg-slate-100 text-slate-600"
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={`text-sm font-bold truncate flex items-center gap-1.5 ${
              dark ? "text-slate-100" : "text-slate-800"
            }`}
          >
            {room.name}
            {suggested && (
              <Star
                className={`w-3 h-3 shrink-0 ${dark ? "text-amber-300" : "text-amber-500"}`}
                fill="currentColor"
                aria-label="Suggested for you"
              />
            )}
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

      {/* Avatar stack — fills the middle. Even when empty, reserve the row
          so all tiles in the grid stay the same height. */}
      <div className="flex items-center min-h-[36px] mb-3">
        {isOccupied ? (
          <>
            <div className="flex items-center">
              {visible.map((o) => (
                <OccupantAvatar
                  key={o.user_id}
                  occupant={o}
                  isLeader={o.user_id === activeSession.leader_id}
                />
              ))}
            </div>
            {overflow > 0 && (
              <span
                className={`-ml-1 inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-semibold ring-2 ring-transparent ${
                  dark ? "bg-slate-800 text-slate-300" : "bg-slate-200 text-slate-700"
                }`}
                title={`${overflow} more`}
              >
                +{overflow}
              </span>
            )}
          </>
        ) : (
          <span
            className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}
          >
            Nobody here
          </span>
        )}
      </div>

      {/* Session line */}
      <div className="mb-3 min-h-[16px]">
        {isOccupied ? (
          <p className={`text-xs truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
            <span className={dark ? "text-slate-300" : "text-slate-700"}>
              {modeLabel(activeSession.mode)}
            </span>
            {" · "}
            {timeLeft(activeSession)}
            {" · "}
            {activeSession.participant_count}/{activeSession.max_participants}
          </p>
        ) : null}
      </div>

      {/* CTA */}
      <div className="mt-auto">
        <Button
          size="sm"
          className="w-full"
          variant={isOccupied ? "default" : "outline"}
          disabled={busy}
          onClick={() => onJoin(room)}
        >
          {isOccupied ? "Join" : "Start"}
        </Button>
      </div>
    </div>
  );
}
