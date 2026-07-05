import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Car, Lock, Mic, MicOff, PhoneOff, Users, X } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { useVideoCall } from "../context/VideoCallContext";
import { joinSyncSession } from "../lib/syncSession";
import { driveCallState, subscribeDriveCall, driveToggleMic } from "../components/video/driveBridge";
import { useWakeLock } from "../hooks/useWakeLock";

// Drive mode — a glanceable, giant-touch-target surface for joining and
// controlling a meeting while driving. Audio-only by design: the camera is
// never published, the call's video stays hidden behind this overlay, and
// every action is one oversized tap (join / mute / leave). Renders as a
// fixed full-screen takeover above the nav (and the z-120 call PiP) so a
// stray tap can't land on regular UI.

const CHOICE_DEFAULTS = { videoEnabled: false, videoDeviceId: null, audioDeviceId: null, inRoom: false };

export default function DriveModePage() {
  const navigate = useNavigate();
  const { session, settings } = useApp();
  const { activeTeamSessions, visibleRooms, lockedRooms, teamMembers } = useTeam();
  const { syncSession, joinSession, leaveSession } = useSyncSession();
  const { call, startCall, endCall } = useVideoCall();

  const [callState, setCallState] = useState(driveCallState);
  useEffect(() => subscribeDriveCall(setCallState), []);
  useWakeLock(true);

  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const userId = session?.user?.id;
  const myName = () => {
    const m = (teamMembers || []).find((tm) => tm.user_id === userId);
    return m?.name || settings?.name || session?.user?.email || "Guest";
  };

  const roomsById = useMemo(() => {
    const map = new Map();
    for (const r of visibleRooms || []) map.set(r.id, r);
    for (const r of lockedRooms || []) if (!map.has(r.id)) map.set(r.id, r);
    return map;
  }, [visibleRooms, lockedRooms]);

  const lockedIds = useMemo(() => new Set((lockedRooms || []).map((r) => r.id)), [lockedRooms]);

  // Joinable "meetings right now" = active room-bound sessions with live
  // occupants, in rooms I can at least see. Mirrors QuickActionsPopover's
  // lock rule: an occupied code room I don't own needs its code, and drive
  // mode has no code entry — show it locked instead.
  const meetings = useMemo(() => {
    return (activeTeamSessions || [])
      .filter((s) => s.room_id && (s.occupants?.length || 0) > 0)
      .map((s) => {
        const room = roomsById.get(s.room_id);
        if (!room) return null;
        const inThisRoom = syncSession?.room_id === room.id;
        const locked = !inThisRoom && (
          lockedIds.has(room.id)
          || (room.entry_policy === "code" && room.created_by !== userId)
        );
        return { session: s, room, locked, inThisRoom };
      })
      .filter(Boolean)
      .sort((a, b) => (b.session.occupants?.length || 0) - (a.session.occupants?.length || 0));
  }, [activeTeamSessions, roomsById, lockedIds, syncSession?.room_id, userId]);

  const startDriveCall = (roomId) => {
    const name = myName();
    startCall(roomId, name, {
      mode: "join",
      choices: { username: name, audioEnabled: true, ...CHOICE_DEFAULTS },
    });
  };

  const joinMeeting = async (entry) => {
    if (entry.locked || busyId) return;
    setError("");
    if (entry.inThisRoom) { startDriveCall(entry.room.id); return; }
    setBusyId(entry.session.id);
    try {
      const { data, error: e } = await joinSyncSession(entry.session.join_code, myName());
      if (e || !data?.session) {
        setError(e?.message || "Couldn't join — try again.");
        return;
      }
      joinSession(data.session);
      startDriveCall(entry.room.id);
    } finally {
      setBusyId(null);
    }
  };

  const leaveMeeting = async () => {
    endCall("drive-mode-leave");
    await leaveSession();
  };

  const inCallRoom = call ? roomsById.get(call.roomId) : null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-black text-white select-none"
      style={{ paddingTop: "var(--top-inset)", paddingBottom: "var(--bottom-inset)" }}
    >
      {/* Header — the only small text on screen lives here. */}
      <div className="flex items-center gap-3 px-5 py-4">
        <Car className="w-7 h-7 text-emerald-400 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold leading-tight">Drive mode</h1>
          <p className="text-xs text-slate-400">Audio only. Keep your eyes on the road.</p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/office")}
          aria-label="Exit drive mode"
          className="flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-900 border border-slate-700 active:bg-slate-800"
        >
          <X className="w-7 h-7" />
        </button>
      </div>

      {error && (
        <p className="mx-5 mb-2 rounded-2xl bg-red-500/15 text-red-300 text-lg font-semibold px-4 py-3">
          {error}
        </p>
      )}

      {call ? (
        /* ── In-call: who's talking + two giant controls ─────────────── */
        <div className="flex-1 flex flex-col px-5 pb-5 gap-4 min-h-0">
          <div className="text-center">
            <p className="text-2xl font-bold truncate">{inCallRoom?.name || "Meeting"}</p>
            <p className="text-base text-slate-400 flex items-center justify-center gap-2">
              <Users className="w-4 h-4" aria-hidden />
              {callState.connected
                ? `${callState.participantCount} in call`
                : "Connecting…"}
            </p>
          </div>

          <div className="flex-1 flex items-center justify-center min-h-0" aria-live="polite">
            {callState.speakerName ? (
              <p className="text-5xl font-bold text-center leading-tight break-words max-w-full">
                <span className="inline-block w-4 h-4 rounded-full bg-emerald-400 animate-pulse align-middle mr-3" aria-hidden />
                {callState.speakerName}
              </p>
            ) : (
              <p className="text-3xl font-semibold text-slate-600">
                {callState.connected ? "Nobody speaking" : " "}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={driveToggleMic}
            aria-pressed={callState.micMuted}
            aria-label={callState.micMuted ? "Unmute microphone" : "Mute microphone"}
            className={`w-full rounded-[2.5rem] flex flex-col items-center justify-center gap-3 h-[38vh] transition-colors ${
              callState.micMuted
                ? "bg-red-600 active:bg-red-500"
                : "bg-emerald-600 active:bg-emerald-500"
            }`}
          >
            {callState.micMuted
              ? <MicOff className="w-16 h-16" aria-hidden />
              : <Mic className="w-16 h-16" aria-hidden />}
            <span className="text-4xl font-extrabold tracking-wide">
              {callState.micMuted ? "MUTED" : "MIC ON"}
            </span>
            <span className="text-lg text-white/80">
              {callState.micMuted ? "Tap to talk" : "Tap to mute"}
            </span>
          </button>

          <button
            type="button"
            onClick={leaveMeeting}
            className="w-full h-24 rounded-3xl bg-slate-900 border-2 border-red-500/70 text-red-400 flex items-center justify-center gap-3 text-3xl font-bold active:bg-slate-800"
          >
            <PhoneOff className="w-9 h-9" aria-hidden />
            Leave
          </button>
        </div>
      ) : (
        /* ── Not in a call: giant one-tap meeting list ────────────────── */
        <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-4">
          {syncSession?.room_id && roomsById.get(syncSession.room_id) && (
            <button
              type="button"
              onClick={() => startDriveCall(syncSession.room_id)}
              className="w-full min-h-28 rounded-3xl bg-emerald-600 active:bg-emerald-500 px-6 py-5 text-left"
            >
              <span className="block text-3xl font-bold truncate">
                {roomsById.get(syncSession.room_id)?.name}
              </span>
              <span className="block text-lg text-white/85 mt-1">
                You're in this room — tap to join the call
              </span>
            </button>
          )}

          {meetings.filter((m) => !m.inThisRoom).map((m) => (
            <button
              key={m.session.id}
              type="button"
              disabled={m.locked || !!busyId}
              onClick={() => joinMeeting(m)}
              className={`w-full min-h-28 rounded-3xl px-6 py-5 text-left border ${
                m.locked
                  ? "bg-slate-950 border-slate-800 opacity-45"
                  : "bg-slate-900 border-slate-700 active:bg-slate-800"
              }`}
            >
              <span className="flex items-center gap-3 text-3xl font-bold">
                {m.locked && <Lock className="w-7 h-7 shrink-0 text-slate-500" aria-label="Locked room" />}
                <span className="truncate">{m.room.name}</span>
              </span>
              <span className="block text-lg text-slate-400 mt-1 truncate">
                {busyId === m.session.id
                  ? "Joining…"
                  : m.locked
                    ? "Locked — needs a code"
                    : `${m.session.occupants.length} in call — ${m.session.occupants.map((o) => o.name).filter(Boolean).slice(0, 3).join(", ")}`}
              </span>
            </button>
          ))}

          {meetings.filter((m) => !m.inThisRoom).length === 0 && !syncSession?.room_id && (
            <div className="pt-16 text-center space-y-2">
              <p className="text-3xl font-bold text-slate-500">No meetings right now</p>
              <p className="text-lg text-slate-600">This updates by itself — leave it open.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
