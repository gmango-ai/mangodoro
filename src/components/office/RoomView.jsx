import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { Button } from "@/components/ui/button";
import {
  Hash, Briefcase, MessageSquare, Lock, Video,
  LogIn, Play, Users, ClipboardList,
} from "lucide-react";
import RoomChatPanel from "../RoomChatPanel";
import UserAvatar from "../UserAvatar";

const KIND_ICON = {
  general: Hash,
  department: Briefcase,
  meeting: MessageSquare,
  private: Lock,
};
const KIND_LABEL = {
  general: "General",
  department: "Department",
  meeting: "Meeting",
  private: "Private",
};

// "Video coming soon" pane. Sized like a real video grid so the
// layout doesn't shift when Jitsi lands — sits in the same slot, same
// aspect ratio, so users get a feel for the future shape.
function VideoStage({ activeSession, dark }) {
  const occupants = activeSession?.occupants || [];
  return (
    <div className={`relative w-full h-full rounded-xl border overflow-hidden ${
      dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-slate-900"
    }`}>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
        <div className="p-3 rounded-full bg-white/10 backdrop-blur-sm">
          <Video className="w-6 h-6 text-white/80" />
        </div>
        <p className="mt-3 text-sm font-semibold text-white">
          Video drops in next
        </p>
        <p className="mt-1 text-xs text-white/60 max-w-[320px]">
          Drop into a live call with everyone in this room, with screen share and an AI summary on close.
        </p>
        {occupants.length > 0 && (
          <div className="mt-4 flex items-center justify-center gap-1.5">
            {occupants.slice(0, 6).map((o) => (
              <span key={o.user_id} className="ring-2 ring-white/30 rounded-full">
                <UserAvatar url={o.avatar_url} name={o.name} size={28} />
              </span>
            ))}
          </div>
        )}
        <span className="mt-3 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/10 text-white/70">
          Coming soon
        </span>
      </div>
    </div>
  );
}

// Right-rail pomodoro panel. If the signed-in user is currently in
// this room's session, render the inline timer; otherwise show the
// "join / start" CTA with a compact occupant preview.
// Header action button: Start / Join / In-session. Pomodoro UI was
// pulled out of the room rail because the global timer pill in the
// Nav already surfaces the running timer everywhere; the room view
// just needs the affordance to *enter* a session.
function RoomSessionAction({ room, activeSession, busy, onJoin, onStart, currentSyncSession, dark }) {
  const inThisRoomSession = !!currentSyncSession && currentSyncSession.room_id === room.id;
  if (inThisRoomSession) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[var(--color-accent-light)] text-[var(--color-accent)]">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
        You're focusing here
      </span>
    );
  }
  if (activeSession) {
    const n = activeSession.occupants?.length || 0;
    return (
      <Button onClick={onJoin} disabled={busy} size="sm" className="rounded-full">
        <LogIn className="w-3.5 h-3.5 mr-1.5" />
        Join {n > 0 ? `(${n})` : ""}
      </Button>
    );
  }
  return (
    <Button onClick={onStart} disabled={busy} size="sm" variant="outline" className="rounded-full">
      <Play className="w-3.5 h-3.5 mr-1.5" />
      Start a session
    </Button>
  );
}

// Reserved slot for the ClickUp / tasks integration. Inert chrome so
// the rail layout doesn't shift once the integration lands.
function TaskRail({ dark }) {
  return (
    <div className={`rounded-xl border ${
      dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
    }`}>
      <div className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-wider border-b ${
        dark ? "text-slate-500 border-[var(--color-border)]" : "text-slate-400 border-slate-200"
      }`}>
        Tasks
      </div>
      <div className="p-4 text-center">
        <div className={`mx-auto p-2 rounded-full w-fit mb-2 ${
          dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-100"
        }`}>
          <ClipboardList className={`w-4 h-4 ${dark ? "text-slate-400" : "text-slate-500"}`} />
        </div>
        <p className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-500"}`}>
          ClickUp tasks land here next — pin what you're focusing on.
        </p>
      </div>
    </div>
  );
}

export default function RoomView({
  room, activeSession, orgTeams, busy, onJoin, onStart,
}) {
  const { theme } = useTheme();
  const { session } = useApp();
  const dark = theme === "dark";

  if (!room) {
    return (
      <div className="flex-1 flex items-center justify-center p-10">
        <p className={`text-sm ${dark ? "text-slate-500" : "text-slate-400"}`}>
          Select a room from the sidebar to get started.
        </p>
      </div>
    );
  }

  const Icon = KIND_ICON[room.kind] || Hash;
  const accent = room.color || "#14b8a6";
  const gatingTeams = (room.room_teams || [])
    .map((rt) => (orgTeams || []).find((t) => t.id === rt.org_team_id))
    .filter(Boolean);
  const currentSyncSession = useSyncSession().syncSession;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <header
        className={`px-6 py-3 border-b shrink-0 ${
          dark ? "border-[var(--color-border)]" : "border-slate-200"
        }`}
        style={{ background: `linear-gradient(180deg, ${accent}12, transparent)` }}
      >
        <div className="flex items-center gap-3">
          <div
            className="p-2 rounded-xl shrink-0"
            style={{ background: `${accent}22`, color: accent }}
          >
            <Icon className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className={`text-lg font-bold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
              {room.name}
            </h1>
            <p className={`text-[10px] uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>
              {KIND_LABEL[room.kind] || room.kind}
              {room.kind === "private" && room.invite_code && (
                <span className={`ml-2 ${dark ? "text-amber-300" : "text-amber-600"}`}>
                  · Locked
                </span>
              )}
            </p>
          </div>
          {gatingTeams.length > 0 && (
            <div className="hidden sm:flex flex-wrap items-center gap-1.5">
              {gatingTeams.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{ background: `${t.color}22`, color: dark ? "#fff" : t.color, border: `1px solid ${t.color}55` }}
                >
                  <span className="w-1 h-1 rounded-full" style={{ background: t.color }} />
                  {t.name}
                </span>
              ))}
            </div>
          )}
          {/* Session entry action — Join / Start / "you're focusing
              here" indicator. The actual pomodoro UI lives in the Nav
              pill (always visible) so this is purely the affordance
              to enter / leave the room's session. */}
          <RoomSessionAction
            room={room}
            activeSession={activeSession}
            busy={busy}
            onJoin={onJoin}
            onStart={onStart}
            currentSyncSession={currentSyncSession}
            dark={dark}
          />
        </div>
      </header>

      {/* Main grid: video + chat stacked on the left, pomodoro + tasks
          rail on the right. Mobile collapses to a single column with
          video → pomodoro → tasks → chat. */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 p-4 overflow-hidden">
        {/* Left column: video on top, chat fills the rest. */}
        <div className="flex flex-col gap-4 min-h-0 order-1">
          <div className="h-[40vh] lg:h-[45%] shrink-0 min-h-[240px]">
            <VideoStage activeSession={activeSession} dark={dark} />
          </div>
          <div className="flex-1 min-h-0">
            <RoomChatPanel
              roomId={room.id}
              userId={session?.user?.id}
              fillHeight
            />
          </div>
        </div>

        {/* Right rail: tasks (placeholder for ClickUp). The pomodoro
            panel that used to live here was retired in favor of the
            global Nav pill — the timer is visible app-wide, no need
            to duplicate it per-room. */}
        <div className="flex flex-col gap-4 order-2 lg:order-2 min-h-0 overflow-y-auto lg:overflow-visible">
          <TaskRail dark={dark} />
        </div>
      </div>
    </div>
  );
}
