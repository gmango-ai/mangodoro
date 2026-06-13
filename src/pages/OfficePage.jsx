import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { useTheme } from "../context/ThemeContext";
import OfficeLayoutEditor from "../components/OfficeLayoutEditor";
import RoomActionPopover from "../components/RoomActionPopover";
import { Button } from "@/components/ui/button";
import { Pencil, Users, Timer } from "lucide-react";
import { createSyncSession, joinSyncSession } from "../lib/syncSession";
import { resolveRoomByInviteCode } from "../lib/rooms";
import { notifySessionJoined } from "../sync/joinSession";

// The "office" — a god's-eye view of every visible room with live
// occupants. Read-only by design; the editor lives on /team#office.
// Click any room to open the action popover (same flow as /pomodoro).
export default function OfficePage() {
  const { session } = useApp();
  const {
    activeTeam, activeTeamId, activeTeamSessions, visibleRooms, isAdmin,
    teamMembers, myOrgTeamLeadIds, orgTeams,
  } = useTeam();
  const { syncSession, joinSession: joinSyncCtx } = useSyncSession();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();

  const [popoverRoom, setPopoverRoom] = useState(null);
  const [codePromptRoom, setCodePromptRoom] = useState(null);
  const [roomBusy, setRoomBusy] = useState(false);
  const [joinError, setJoinError] = useState("");

  // Map active sessions by room_id for fast lookup in the floor plan.
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

  // Member's name lookup for the participant strip.
  function memberFor(userId) {
    return (teamMembers || []).find((m) => m.user_id === userId) || null;
  }

  async function joinSessionRow(s) {
    setRoomBusy(true); setJoinError("");
    const displayName =
      (memberFor(session.user.id)?.name) ||
      session.user.user_metadata?.name ||
      session.user.email ||
      "Guest";
    const { data, error } = await joinSyncSession(s.join_code, displayName);
    setRoomBusy(false);
    if (error) { setJoinError(error.message || "Could not join."); return; }
    if (data) { joinSyncCtx(data); notifySessionJoined(data); }
    navigate("/pomodoro");
  }

  async function startSessionInRoom(room) {
    setRoomBusy(true); setJoinError("");
    const displayName =
      (memberFor(session.user.id)?.name) ||
      session.user.user_metadata?.name ||
      session.user.email ||
      "Guest";
    const { data, error } = await createSyncSession(session.user.id, displayName, {
      teamId: activeTeamId,
      roomId: room.id,
      visibility: "team",
    });
    setRoomBusy(false);
    if (error) { setJoinError(error.message || "Could not start session."); return; }
    if (data) { joinSyncCtx(data); notifySessionJoined(data); }
    navigate("/pomodoro");
  }

  async function handleRoomClick(room) {
    const active = sessionByRoomId.get(room.id);
    if (active) return joinSessionRow(active);
    if (room.kind === "private") {
      setCodePromptRoom(room);
      return;
    }
    return startSessionInRoom(room);
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

  const canEdit = isAdmin || (myOrgTeamLeadIds && myOrgTeamLeadIds.size > 0);

  return (
    <main className="px-4 pt-6 pb-24 max-w-[1400px] mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>
            {activeTeam.name}
          </p>
          <h1 className={`text-2xl font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
            Office
          </h1>
          <p className={`text-xs mt-0.5 inline-flex items-center gap-3 ${dark ? "text-slate-400" : "text-slate-500"}`}>
            <span className="inline-flex items-center gap-1">
              <Users className="w-3 h-3" />
              <span className={`font-semibold ${onlineCount > 0 ? (dark ? "text-cyan-300" : "text-teal-700") : ""}`}>
                {onlineCount}
              </span>
              {onlineCount === 1 ? "person online" : "people online"}
            </span>
            <span className="inline-flex items-center gap-1">
              <Timer className="w-3 h-3" />
              <span className="font-semibold">
                {activeTeamSessions?.length || 0}
              </span>
              active {activeTeamSessions?.length === 1 ? "session" : "sessions"}
            </span>
          </p>
        </div>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/team#office")}
            className="h-8 text-xs"
          >
            <Pencil className="w-3.5 h-3.5 mr-1" /> Edit office
          </Button>
        )}
      </div>

      {joinError && (
        <p className={`text-xs ${dark ? "text-red-400" : "text-red-600"}`}>{joinError}</p>
      )}

      {(visibleRooms || []).length === 0 ? (
        <div className={`text-center py-10 rounded-2xl border border-dashed ${
          dark ? "border-slate-700/60 text-slate-400" : "border-slate-300 text-slate-500"
        }`}>
          <p className="text-sm">No rooms in this office yet.</p>
          {canEdit && (
            <Button onClick={() => navigate("/team#office")} className="mt-3" size="sm">
              <Pencil className="w-3.5 h-3.5 mr-1" /> Set up the office
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop / tablet: the floor plan. Mobile gets a stacked
              list for legibility — DnD isn't a concern (read-only) but
              the grid cells get too small to be useful on phones. */}
          <div className="hidden sm:block">
            <OfficeLayoutEditor
              rooms={visibleRooms}
              readOnly={true}
              vibe={activeTeam?.office_vibe || "quiet"}
              busy={roomBusy}
              onJoinRoom={handleRoomClick}
              onOpenRoom={setPopoverRoom}
              sessionByRoomId={sessionByRoomId}
            />
          </div>
          <div className="sm:hidden grid gap-3">
            {visibleRooms.map((room) => {
              const activeSession = sessionByRoomId.get(room.id) || null;
              const occupants = activeSession?.occupants || [];
              return (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => setPopoverRoom(room)}
                  className={`text-left rounded-2xl border p-3 transition-colors ${
                    dark ? "bg-slate-900 border-slate-700 hover:border-cyan-500/50" : "bg-white border-slate-200 hover:border-teal-300"
                  }`}
                  style={{ borderTopColor: room.color, borderTopWidth: 4 }}
                >
                  <p className={`text-sm font-semibold ${dark ? "text-slate-100" : "text-slate-800"}`}>
                    {room.name}
                  </p>
                  <p className={`text-[11px] mt-0.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>
                    {occupants.length === 0
                      ? "Nobody here"
                      : `${occupants.length} ${occupants.length === 1 ? "person" : "people"}`}
                  </p>
                </button>
              );
            })}
          </div>
        </>
      )}

      <RoomActionPopover
        open={!!popoverRoom}
        room={popoverRoom}
        activeSession={popoverRoom ? sessionByRoomId.get(popoverRoom.id) || null : null}
        orgTeams={orgTeams || []}
        busy={roomBusy}
        onClose={() => setPopoverRoom(null)}
        onJoin={async () => {
          const r = popoverRoom;
          setPopoverRoom(null);
          if (r) await handleRoomClick(r);
        }}
        onStart={async () => {
          const r = popoverRoom;
          setPopoverRoom(null);
          if (r) await handleRoomClick(r);
        }}
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
            setCodePromptRoom(null);
            const active = sessionByRoomId.get(resolvedRoomId);
            if (active) await joinSessionRow(active);
            else await startSessionInRoom(codePromptRoom);
          }}
          dark={dark}
        />
      )}
    </main>
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
          dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"
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
            dark ? "bg-slate-800/60 border-slate-700 text-slate-100" : "bg-white border-slate-200 text-slate-800"
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
