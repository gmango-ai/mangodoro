import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { useTheme } from "../context/ThemeContext";
import OfficeShell from "../components/office/OfficeShell";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { createSyncSession, joinSyncSession } from "../lib/syncSession";
import { getSessionCreatePrefs } from "../pomodoro/storage";
import { resolveRoomByInviteCode } from "../lib/rooms";

// /office — sidebar (minimap + room list) on the left, the selected
// room's view on the right. Joining or starting a session keeps the
// user in the room view so chat / video / timer all live in one place.
// The previous popover-modal flow was replaced wholesale by OfficeShell.
export default function OfficePage() {
  const { session } = useApp();
  const {
    activeTeam, activeTeamId, activeTeamSessions, visibleRooms, lockedRooms, isAdmin,
    teamMembers, myOrgTeamLeadIds, orgTeams,
  } = useTeam();
  const { syncSession, joinSession: joinSyncCtx } = useSyncSession();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();

  const [codePromptRoom, setCodePromptRoom] = useState(null);
  const [roomBusy, setRoomBusy] = useState(false);
  const [joinError, setJoinError] = useState("");

  // Map active sessions by room_id for fast lookup.
  const sessionByRoomId = new Map();
  for (const s of activeTeamSessions || []) {
    if (s.room_id) sessionByRoomId.set(s.room_id, s);
  }

  // Distinct people across all active sessions in the org.
  const onlineCount = (() => {
    const ids = new Set();
    for (const s of activeTeamSessions || []) {
      for (const o of s.occupants || []) if (o.user_id) ids.add(o.user_id);
    }
    return ids.size;
  })();

  function memberFor(userId) {
    return (teamMembers || []).find((m) => m.user_id === userId) || null;
  }

  function displayName() {
    return (
      (memberFor(session.user.id)?.name)
      || session.user.user_metadata?.name
      || session.user.email
      || "Guest"
    );
  }

  async function joinSessionRow(s) {
    setRoomBusy(true); setJoinError("");
    const { data, error } = await joinSyncSession(s.join_code, displayName());
    setRoomBusy(false);
    if (error) { setJoinError(error.message || "Could not join."); return false; }
    if (data?.session) joinSyncCtx(data.session);
    return true;
  }

  async function startSessionInRoom(room) {
    setRoomBusy(true); setJoinError("");
    const { data, error } = await createSyncSession(session.user.id, displayName(), {
      teamId: activeTeamId,
      roomId: room.id,
      visibility: "team",
      ...getSessionCreatePrefs(),
    });
    setRoomBusy(false);
    if (error) { setJoinError(error.message || "Could not start session."); return false; }
    if (data) joinSyncCtx(data);
    return true;
  }

  // The two CTAs the RoomView surfaces. "Join" → existing session in
  // this room; "Start" → spin one up (with private-code gating if the
  // room has been locked by a prior visit).
  async function handleJoin(room) {
    const active = sessionByRoomId.get(room.id);
    if (active) await joinSessionRow(active);
  }

  async function handleStart(room) {
    if (room.kind === "private" && room.invite_code) {
      setCodePromptRoom(room);
      return;
    }
    await startSessionInRoom(room);
  }

  const canEdit = isAdmin || (myOrgTeamLeadIds && myOrgTeamLeadIds.size > 0);
  const hasRooms = (visibleRooms || []).length > 0;

  if (!activeTeam) {
    return (
      <main className="px-4 pt-8 pb-24 max-w-[920px] mx-auto">
        <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
          Join or create an org first to see the office.
        </p>
      </main>
    );
  }

  if (!hasRooms) {
    return (
      <main className="px-4 pt-8 pb-24 max-w-[920px] mx-auto">
        <h1 className={`text-2xl font-bold mb-3 ${dark ? "text-slate-100" : "text-slate-800"}`}>
          Office
        </h1>
        <div className={`text-center py-10 rounded-2xl border border-dashed ${
          dark ? "border-[var(--color-border)] text-slate-400" : "border-slate-300 text-slate-500"
        }`}>
          <p className="text-sm">No rooms in this office yet.</p>
          {canEdit && (
            <Button onClick={() => navigate("/team#office")} className="mt-3" size="sm">
              <Pencil className="w-3.5 h-3.5 mr-1" /> Set up the office
            </Button>
          )}
        </div>
      </main>
    );
  }

  return (
    <>
      {joinError && (
        <p className={`px-4 py-2 text-xs ${dark ? "text-red-400" : "text-red-600"}`}>{joinError}</p>
      )}
      <OfficeShell
        activeTeam={activeTeam}
        rooms={visibleRooms}
        lockedRooms={lockedRooms}
        sessionByRoomId={sessionByRoomId}
        orgTeams={orgTeams || []}
        onlineCount={onlineCount}
        canEdit={canEdit}
        busy={roomBusy}
        onJoin={handleJoin}
        onStart={handleStart}
        onEditOffice={() => navigate("/team#office")}
      />

      {/* Private room → "Enter code" sheet */}
      {codePromptRoom && (
        <PrivateRoomCodeSheet
          room={codePromptRoom}
          onClose={() => setCodePromptRoom(null)}
          onConfirm={async (code) => {
            setRoomBusy(true); setJoinError("");
            const { data: resolvedRoomId, error } = await resolveRoomByInviteCode(code.trim().toUpperCase());
            setRoomBusy(false);
            if (error) { setJoinError(error.message || "Invalid code."); return; }
            if (resolvedRoomId !== codePromptRoom.id) {
              setJoinError("That code belongs to a different room.");
              return;
            }
            const target = codePromptRoom;
            setCodePromptRoom(null);
            const active = sessionByRoomId.get(target.id);
            if (active) await joinSessionRow(active);
            else await startSessionInRoom(target);
          }}
          dark={dark}
        />
      )}
    </>
  );
}

// Tiny sheet for entering a private room's invite code. Mirrors the
// equivalent on PomodoroPage so muscle memory carries.
function PrivateRoomCodeSheet({ room, onClose, onConfirm, dark }) {
  const [code, setCode] = useState("");
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-sm rounded-2xl border p-5 ${
          dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
        }`}
      >
        <h2 className={`text-base font-bold mb-1 ${dark ? "text-slate-100" : "text-slate-800"}`}>
          Enter {room.name}
        </h2>
        <p className={`text-xs mb-3 ${dark ? "text-slate-400" : "text-slate-500"}`}>
          This room requires an invite code.
        </p>
        <input
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.slice(0, 12))}
          placeholder="ABCDEF"
          className={`w-full px-3 py-2 rounded-lg border text-sm font-mono uppercase tracking-widest ${
            dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100" : "bg-white border-slate-200 text-slate-800"
          }`}
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!code.trim()} onClick={() => onConfirm(code)}>
            Join
          </Button>
        </div>
      </div>
    </div>
  );
}
