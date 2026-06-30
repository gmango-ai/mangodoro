import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { useTheme } from "../context/ThemeContext";
import OfficeShell from "../components/office/OfficeShell";
import RoomSettingsModal from "../components/RoomSettingsModal";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { createSyncSession, joinSyncSession } from "../lib/syncSession";
import { getSessionCreatePrefs } from "../pomodoro/storage";

// Turn the server's machine error into something a human can read. The
// access RPCs raise/return the marker `room_entry_denied`.
function friendlyEntryError(message) {
  if (message && /room_entry_denied/i.test(message)) {
    return "Incorrect or missing access code.";
  }
  return message || "Could not enter the room.";
}

// /office — sidebar (minimap + room list) on the left, the selected
// room's view on the right. Joining or starting a session keeps the
// user in the room view so chat / video / timer all live in one place.
// The previous popover-modal flow was replaced wholesale by OfficeShell.
export default function OfficePage() {
  const { session } = useApp();
  const {
    activeTeam, activeTeamId, activeTeamSessions, visibleRooms, lockedRooms, isAdmin,
    teamMembers, myOrgTeamLeadIds, orgTeams, loadRoomsForActiveTeam,
  } = useTeam();
  const { syncSession, joinSession: joinSyncCtx } = useSyncSession();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();

  const [roomBusy, setRoomBusy] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [roomToEdit, setRoomToEdit] = useState(null);

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

  async function joinSessionRow(s, accessCode) {
    setRoomBusy(true); setJoinError("");
    const { data, error } = await joinSyncSession(s.join_code, displayName(), accessCode);
    setRoomBusy(false);
    if (error) { setJoinError(friendlyEntryError(error.message)); return false; }
    if (data?.session) joinSyncCtx(data.session);
    return true;
  }

  async function startSessionInRoom(room, accessCode) {
    setRoomBusy(true); setJoinError("");
    const { data, error } = await createSyncSession(session.user.id, displayName(), {
      teamId: activeTeamId,
      roomId: room.id,
      visibility: "team",
      accessCode,
      ...getSessionCreatePrefs(),
    });
    setRoomBusy(false);
    if (error) { setJoinError(friendlyEntryError(error.message)); return false; }
    if (data) joinSyncCtx(data);
    return true;
  }

  // RoomView CTAs. "Join" → the room's live session; "Start" → spin one
  // up. No code prompt here: a code-gated room that's occupied by others is
  // blocked at the door by OfficeShell's lock gate (you never reach these
  // CTAs without already being allowed in), and an empty code room is open
  // to the first person in. The server is the backstop either way.
  async function handleJoin(room) {
    const active = sessionByRoomId.get(room.id);
    if (active) await joinSessionRow(active);
  }

  async function handleStart(room) {
    await startSessionInRoom(room);
  }

  // Entering a locked room from the shell's code gate: join the live
  // session (or be the first to start one) with the supplied code.
  // Returns whether entry succeeded so the gate can stay open on a bad code.
  async function enterRoomWithCode(room, code) {
    const active = sessionByRoomId.get(room.id);
    return active
      ? await joinSessionRow(active, code)
      : await startSessionInRoom(room, code);
  }

  const canEdit = isAdmin || (myOrgTeamLeadIds && myOrgTeamLeadIds.size > 0);
  // Count locked rooms too: rooms gated to a team you're not in still render as
  // locked tiles (so you can see what exists across the office). Without this,
  // a member whose only rooms are department-locked falls through to the "No
  // rooms" empty state and those rooms disappear entirely instead of showing
  // locked.
  const hasRooms = (visibleRooms || []).length > 0 || (lockedRooms || []).length > 0;

  // Can the current user edit THIS specific room? Mirrors the server-side
  // RPC checks (admin OR room creator OR lead of a team gating the room) so
  // the in-room settings gear only appears when an edit would actually
  // succeed. The RPCs still enforce this regardless.
  function canEditRoom(room) {
    if (!room) return false;
    if (isAdmin) return true;
    if (room.created_by && room.created_by === session.user.id) return true;
    const gatingTeamIds = (room.room_teams || []).map((rt) => rt.org_team_id);
    return gatingTeamIds.some((id) => myOrgTeamLeadIds?.has(id));
  }

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
        onEnterRoom={enterRoomWithCode}
        onEditOffice={() => navigate("/team#office")}
        onEditRoom={(room) => setRoomToEdit(room)}
        canEditRoom={canEditRoom}
      />

      <RoomSettingsModal
        open={!!roomToEdit}
        room={roomToEdit}
        orgTeams={orgTeams || []}
        isAdmin={isAdmin}
        myOrgTeamLeadIds={myOrgTeamLeadIds || new Set()}
        onClose={() => setRoomToEdit(null)}
        onSaved={() => {
          setRoomToEdit(null);
          loadRoomsForActiveTeam?.();
        }}
        onError={(msg) => setJoinError(msg)}
        onDeleted={() => {
          setRoomToEdit(null);
          loadRoomsForActiveTeam?.();
          // The room is gone — drop back to the hallway rather than
          // sitting on a now-dangling /office/r/:id URL.
          navigate("/office");
        }}
      />
    </>
  );
}
