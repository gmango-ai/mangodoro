import { useState } from "react";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useTheme } from "../context/ThemeContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { Button } from "@/components/ui/button";
import { Users as UsersIcon, Timer, Sparkles, Briefcase, MessageSquare, Lock, Plus, Hash } from "lucide-react";
import PomodoroTimer from "../components/PomodoroTimer";
import UserAvatar from "../components/UserAvatar";
import CreateRoomModal from "../components/CreateRoomModal";
import { createSyncSession, joinSyncSession } from "../lib/syncSession";
import { resolveRoomByInviteCode } from "../lib/rooms";
import { notifySessionJoined } from "../sync/joinSession";

export default function PomodoroPage({ session, onOpenSync }) {
  const { settings, clockIn, projects } = useApp();
  const { activeTeamId, activeTeamSessions, rooms, isAdmin } = useTeam();
  const { theme } = useTheme();
  const { syncSession, joinSession: joinSyncCtx } = useSyncSession();
  const dark = theme === "dark";

  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [codePromptRoom, setCodePromptRoom] = useState(null); // private room awaiting code
  const [codeInput, setCodeInput] = useState("");
  const [roomBusy, setRoomBusy] = useState(false);

  const currentTaskHint = (() => {
    if (!clockIn) return "";
    const projId = clockIn.projectIds?.[0];
    const proj = projId ? projects?.find((p) => p.id === projId)?.name : null;
    const desc = (clockIn.description || "").trim();
    if (proj && desc) return `${proj} — ${desc}`;
    if (proj) return proj;
    if (desc) return desc;
    return "";
  })();

  const [soloMode, setSoloMode] = useState(false);
  const [joinError, setJoinError] = useState("");

  const presenceLabel =
    settings.presenceState === "in_meeting"
      ? "In meeting"
      : settings.presenceState === "heads_down"
        ? "Heads-down"
        : settings.presenceState === "away"
          ? "Away"
          : settings.presenceState === "available"
            ? "Available"
            : "Active";

  const inSession = !!syncSession;
  const showTimer = inSession || soloMode;

  function modeLabel(m) {
    return m === "shortBreak" ? "Short break" : m === "longBreak" ? "Long break" : "Focus";
  }
  function timeLeft(s) {
    if (!s) return "";
    if (!s.is_running || !s.ends_at) return `${Math.ceil((s.remaining_seconds || 0) / 60)}m`;
    return `${Math.max(0, Math.ceil((new Date(s.ends_at).getTime() - Date.now()) / 60000))}m left`;
  }

  // Map of room_id -> active session, for quick room-card lookup.
  const sessionByRoomId = new Map();
  for (const s of activeTeamSessions) {
    if (s.room_id) sessionByRoomId.set(s.room_id, s);
  }
  // Loose sessions (no room) keep working — surfaced separately for back-compat.
  const looseSessions = activeTeamSessions.filter((s) => !s.room_id);

  const cleanName = (settings?.name || "").trim();

  async function joinSessionRow(s) {
    if (!cleanName) {
      setJoinError("Set a display name in Settings before joining.");
      return;
    }
    setJoinError("");
    const { data, error } = await joinSyncSession(s.join_code, cleanName);
    if (error) {
      setJoinError(
        error.message?.includes("display_name_required")
          ? "A display name is required."
          : error.message || "Could not join.",
      );
      return;
    }
    if (data?.session) notifySessionJoined(data.session);
  }

  async function startSessionInRoom(room) {
    if (!cleanName) {
      setJoinError("Set a display name in Settings before starting a session.");
      return;
    }
    if (!session?.user?.id || !activeTeamId) return;
    setRoomBusy(true); setJoinError("");
    const { data, error } = await createSyncSession(session.user.id, cleanName, {
      teamId: activeTeamId,
      roomId: room.id,
      visibility: "team",
    });
    setRoomBusy(false);
    if (error) { setJoinError(error.message || "Could not start session."); return; }
    if (data) { joinSyncCtx(data); notifySessionJoined(data); }
  }

  async function handleRoomClick(room) {
    const active = sessionByRoomId.get(room.id);
    if (active) {
      await joinSessionRow(active);
      return;
    }
    if (room.kind === "private") {
      // Private rooms without an active session still require the code to
      // start one — proves the user has been invited.
      setCodePromptRoom(room);
      setCodeInput("");
      return;
    }
    await startSessionInRoom(room);
  }

  async function submitPrivateCode() {
    if (!codePromptRoom) return;
    if (!codeInput.trim()) return;
    setRoomBusy(true); setJoinError("");
    const { data: resolvedRoomId, error } = await resolveRoomByInviteCode(codeInput.trim().toUpperCase());
    setRoomBusy(false);
    if (error) { setJoinError(error.message || "Invalid code."); return; }
    if (resolvedRoomId !== codePromptRoom.id) {
      setJoinError("That code belongs to a different room.");
      return;
    }
    setCodePromptRoom(null);
    setCodeInput("");
    const active = sessionByRoomId.get(resolvedRoomId);
    if (active) await joinSessionRow(active);
    else await startSessionInRoom(codePromptRoom);
  }

  const roomKindIcon = {
    department: Briefcase,
    meeting: MessageSquare,
    private: Lock,
  };

  return (
    <div className={`max-w-4xl mx-auto px-4 py-6 ${dark ? "text-slate-100" : "text-slate-800"}`}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Pomodoro</h1>
      </div>

      {!showTimer && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2 space-y-4">
            {/* Rooms — the team's persistent pomodoro spaces */}
            {activeTeamId && (
              <div
                className={`rounded-2xl border p-4 ${dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <h2
                    className={`text-sm font-semibold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-500"}`}
                  >
                    Rooms
                  </h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowCreateRoom(true)}
                    className="h-7 text-xs"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> New room
                  </Button>
                </div>
                {joinError && (
                  <p className={`text-xs mb-2 ${dark ? "text-red-400" : "text-red-600"}`}>{joinError}</p>
                )}
                {rooms.length === 0 ? (
                  <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
                    No rooms yet. Create one to start gathering your team.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {rooms.map((room) => {
                      const active = sessionByRoomId.get(room.id);
                      const Icon = roomKindIcon[room.kind] || Hash;
                      return (
                        <li
                          key={room.id}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ${
                            dark ? "bg-slate-800/40" : "bg-slate-50"
                          }`}
                        >
                          <div className={`p-2 rounded-md shrink-0 ${
                            dark ? "bg-slate-700/40 text-slate-300" : "bg-white text-slate-500"
                          }`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p
                              className={`text-sm font-semibold truncate flex items-center gap-1.5 ${dark ? "text-slate-100" : "text-slate-800"}`}
                            >
                              {room.name}
                              {room.kind === "private" && (
                                <span className={`text-[9px] uppercase tracking-wider font-bold px-1 py-px rounded ${
                                  dark ? "bg-amber-500/15 text-amber-300" : "bg-amber-50 text-amber-700"
                                }`}>
                                  Private
                                </span>
                              )}
                            </p>
                            <p className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>
                              {active
                                ? `${active.leader_name} · ${modeLabel(active.mode)} · ${active.participant_count}/${active.max_participants} · ${timeLeft(active)}`
                                : `${room.kind === "department" ? "Department" : room.kind === "meeting" ? "Meeting" : "Private"} room · nobody here`}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleRoomClick(room)}
                            disabled={roomBusy}
                            variant={active ? "default" : "outline"}
                          >
                            {active ? "Join" : "Start"}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {/* Loose sessions (no room) — kept for back-compat */}
            {looseSessions.length > 0 && (
              <div
                className={`rounded-2xl border p-4 ${dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"}`}
              >
                <h2
                  className={`text-sm font-semibold uppercase tracking-wider mb-3 ${dark ? "text-slate-400" : "text-slate-500"}`}
                >
                  Other team sessions
                </h2>
                <ul className="space-y-2">
                  {looseSessions.map((s) => (
                    <li
                      key={s.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
                        dark ? "bg-slate-800/40" : "bg-slate-50"
                      }`}
                    >
                      <UserAvatar url={s.leader_avatar} name={s.leader_name} size={36} className="shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
                          {s.leader_name}
                        </p>
                        <p className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>
                          {modeLabel(s.mode)} · {s.participant_count}/{s.max_participants} · {timeLeft(s)}
                        </p>
                      </div>
                      <Button size="sm" onClick={() => joinSessionRow(s)}>
                        Join
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Quick session via the existing modal — useful when you're
                not in a team yet, or want a non-room session. */}
            {!activeTeamId && (
              <div
                className={`rounded-2xl border p-5 ${dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${dark ? "bg-cyan-500/10" : "bg-teal-50"}`}>
                    <UsersIcon className={`w-5 h-5 ${dark ? "text-cyan-400" : "text-teal-600"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-bold">Start a synced session</p>
                    <p className={`text-sm mt-0.5 ${dark ? "text-slate-400" : "text-slate-500"}`}>
                      Share an invite code with a coworker — no team required.
                    </p>
                    <Button onClick={onOpenSync} className="mt-3">
                      Start session
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setSoloMode(true)}
              className={`w-full text-left rounded-2xl border p-4 transition-colors ${
                dark
                  ? "bg-slate-900/50 border-slate-700 hover:border-slate-600 hover:bg-slate-900"
                  : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${dark ? "bg-slate-800" : "bg-slate-100"}`}>
                  <Sparkles className={`w-5 h-5 ${dark ? "text-slate-300" : "text-slate-600"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold">Custom pomodoro</p>
                  <p className={`text-sm mt-0.5 ${dark ? "text-slate-400" : "text-slate-500"}`}>
                    Just for you. Set your own durations and sound — no one else sees this one.
                  </p>
                </div>
              </div>
            </button>
          </div>

          <aside className="space-y-4">
            <div
              className={`rounded-2xl border p-4 ${dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"}`}
            >
              <h3
                className={`text-xs font-semibold uppercase tracking-wider mb-2 ${dark ? "text-slate-400" : "text-slate-500"}`}
              >
                Your status
              </h3>
              <p className={`text-sm font-semibold ${dark ? "text-slate-200" : "text-slate-800"}`}>
                {presenceLabel}
              </p>
              {settings.status && (
                <p className={`text-sm mt-1 truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
                  {settings.status}
                </p>
              )}
              <p className={`text-[11px] mt-2 ${dark ? "text-slate-500" : "text-slate-400"}`}>
                Edit your status in Settings.
              </p>
            </div>
          </aside>
        </div>
      )}

      {showTimer && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2 space-y-3">
            {soloMode && !inSession && (
              <button
                type="button"
                onClick={() => setSoloMode(false)}
                className={`text-xs ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}
              >
                ← Back to sessions
              </button>
            )}
            <PomodoroTimer
              open
              embedded
              onClose={() => {}}
              userId={session.user.id}
              onOpenSync={onOpenSync}
              currentTaskHint={currentTaskHint}
            />
          </div>

          <aside className="space-y-4">
            {inSession && activeTeamSessions.length > 0 && (
              <div
                className={`rounded-2xl border p-4 ${dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"}`}
              >
                <h3
                  className={`text-xs font-semibold uppercase tracking-wider mb-2 ${dark ? "text-slate-400" : "text-slate-500"}`}
                >
                  Other team sessions
                </h3>
                <ul className="space-y-1.5">
                  {activeTeamSessions
                    .filter((s) => s.id !== syncSession.id)
                    .map((s) => (
                      <li
                        key={s.id}
                        className={`flex items-center gap-2 text-xs ${dark ? "text-slate-300" : "text-slate-700"}`}
                      >
                        <Timer className="w-3 h-3 shrink-0" />
                        <span className="flex-1 truncate">{s.leader_name}</span>
                        <span className={dark ? "text-slate-500" : "text-slate-400"}>
                          {s.participant_count}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            )}

            <div
              className={`rounded-2xl border p-4 ${dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"}`}
            >
              <h3
                className={`text-xs font-semibold uppercase tracking-wider mb-2 ${dark ? "text-slate-400" : "text-slate-500"}`}
              >
                Your status
              </h3>
              <p className={`text-sm font-semibold ${dark ? "text-slate-200" : "text-slate-800"}`}>
                {presenceLabel}
              </p>
              {settings.status && (
                <p className={`text-sm mt-1 truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
                  {settings.status}
                </p>
              )}
            </div>
          </aside>
        </div>
      )}

      <CreateRoomModal
        open={showCreateRoom}
        onClose={() => setShowCreateRoom(false)}
        teamId={activeTeamId}
        userId={session.user.id}
        isAdmin={isAdmin}
      />

      {/* Private room → "Enter code" sheet */}
      {codePromptRoom && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4"
          onClick={() => { setCodePromptRoom(null); setCodeInput(""); }}
        >
          <div
            className={`relative w-full max-w-sm rounded-2xl border p-5 sm:p-6 ${
              dark ? "bg-slate-900 border-slate-700 shadow-2xl shadow-black/40" : "bg-white border-slate-200 shadow-xl"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={`text-lg font-bold mb-1 ${dark ? "text-slate-100" : "text-slate-800"}`}>
              Enter room code
            </h3>
            <p className={`text-xs mb-3 ${dark ? "text-slate-400" : "text-slate-500"}`}>
              "{codePromptRoom.name}" is private. Paste the code your teammate shared.
            </p>
            <input
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase().slice(0, 6))}
              maxLength={6}
              autoFocus
              placeholder="ABC123"
              className={`w-full h-10 px-3 rounded-md border text-center text-lg font-mono tracking-widest ${
                dark ? "bg-slate-800 border-slate-700 text-slate-100" : "bg-white border-slate-200 text-slate-800"
              }`}
              onKeyDown={(e) => { if (e.key === "Enter") submitPrivateCode(); }}
            />
            {joinError && (
              <p className={`text-xs mt-2 ${dark ? "text-red-400" : "text-red-600"}`}>{joinError}</p>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <Button
                variant="outline"
                onClick={() => { setCodePromptRoom(null); setCodeInput(""); setJoinError(""); }}
              >
                Cancel
              </Button>
              <Button onClick={submitPrivateCode} disabled={roomBusy || codeInput.length < 3}>
                {roomBusy ? "Joining…" : "Join"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
