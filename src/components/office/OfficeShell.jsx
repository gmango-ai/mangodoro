import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTheme } from "../../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import OfficeSidebar from "./OfficeSidebar";
import RoomView from "./RoomView";

const LAST_ROOM_KEY = "ql_office_last_room";

function lastRoomFor(teamId) {
  if (!teamId) return null;
  try {
    const raw = localStorage.getItem(LAST_ROOM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.[teamId] || null;
  } catch {
    return null;
  }
}

function rememberRoomFor(teamId, roomId) {
  if (!teamId || !roomId) return;
  try {
    const raw = localStorage.getItem(LAST_ROOM_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed[teamId] = roomId;
    localStorage.setItem(LAST_ROOM_KEY, JSON.stringify(parsed));
  } catch { /* storage disabled */ }
}

// Top-level office layout: sidebar (room minimap + list) on the left,
// RoomView in the main pane. URL drives the selected room — `/office`
// auto-redirects to the last visited room (or the first available),
// `/office/r/:roomId` selects directly. localStorage persists the
// "last visited" hint per team.
export default function OfficeShell({
  activeTeam, rooms, sessionByRoomId, orgTeams,
  onlineCount, canEdit, busy, onJoin, onStart, onEditOffice,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();
  const { roomId } = useParams();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Resolve which room is selected. URL wins; otherwise fall back to
  // last-visited; otherwise the first room in the team's office.
  const resolvedId = (() => {
    if (roomId && (rooms || []).some((r) => r.id === roomId)) return roomId;
    const last = lastRoomFor(activeTeam?.id);
    if (last && (rooms || []).some((r) => r.id === last)) return last;
    return rooms?.[0]?.id || null;
  })();

  // Sync the URL whenever the resolved room differs from the URL (e.g.
  // on cold load of `/office`, after a team switch, or when the
  // currently-selected room disappears). Replace so the back button
  // doesn't pile up redirects.
  useEffect(() => {
    if (resolvedId && roomId !== resolvedId) {
      navigate(`/office/r/${resolvedId}`, { replace: true });
    }
  }, [resolvedId, roomId, navigate]);

  // Persist the visited room so the next cold load picks up here.
  useEffect(() => {
    if (resolvedId && activeTeam?.id) rememberRoomFor(activeTeam.id, resolvedId);
  }, [resolvedId, activeTeam?.id]);

  const selectedRoom = (rooms || []).find((r) => r.id === resolvedId) || null;
  const activeSession = selectedRoom ? (sessionByRoomId?.get(selectedRoom.id) || null) : null;

  const handleSelect = (id) => {
    setDrawerOpen(false);
    navigate(`/office/r/${id}`);
  };

  const sidebar = (
    <OfficeSidebar
      activeTeam={activeTeam}
      onlineCount={onlineCount}
      activeSessionsCount={[...(sessionByRoomId?.values() || [])].length}
      canEdit={canEdit}
      rooms={rooms}
      sessionByRoomId={sessionByRoomId}
      selectedRoomId={resolvedId}
      onSelectRoom={handleSelect}
      onEditOffice={onEditOffice}
    />
  );

  return (
    <div className={`flex h-[calc(100vh-64px)] w-full ${
      dark ? "bg-[var(--color-bg)]" : "bg-slate-50"
    }`}>
      {/* Desktop sidebar — fixed width, always visible. */}
      <div className="hidden md:flex w-72 shrink-0 h-full">
        {sidebar}
      </div>

      {/* Mobile drawer — overlays from the left. */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-[150] bg-black/50"
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="absolute inset-y-0 left-0 w-72 max-w-[80vw] h-full"
            onClick={(e) => e.stopPropagation()}
          >
            {sidebar}
          </div>
        </div>
      )}

      {/* Main pane */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile header (drawer toggle + room name) */}
        <div className={`md:hidden flex items-center gap-2 px-3 py-2 border-b ${
          dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
        }`}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDrawerOpen(true)}
            className="h-8 w-8"
            aria-label="Open office menu"
          >
            <Menu className="w-4 h-4" />
          </Button>
          <p className={`text-sm font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
            {selectedRoom?.name || "Office"}
          </p>
        </div>

        <RoomView
          room={selectedRoom}
          activeSession={activeSession}
          orgTeams={orgTeams}
          busy={busy}
          onJoin={() => selectedRoom && onJoin?.(selectedRoom)}
          onStart={() => selectedRoom && onStart?.(selectedRoom)}
        />
      </div>
    </div>
  );
}
