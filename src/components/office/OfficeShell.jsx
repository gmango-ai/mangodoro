import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTheme } from "../../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Menu, ChevronRight } from "lucide-react";
import OfficeSidebar from "./OfficeSidebar";
import RoomView from "./RoomView";

const LAST_ROOM_KEY = "ql_office_last_room";
const SIDEBAR_MODE_KEY = "ql_office_sidebar_mode";
const VALID_MODES = ["full", "list", "hidden"];

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

function loadSidebarMode() {
  try {
    const stored = localStorage.getItem(SIDEBAR_MODE_KEY);
    if (stored && VALID_MODES.includes(stored)) return stored;
  } catch { /* */ }
  return "full";
}

function saveSidebarMode(mode) {
  try { localStorage.setItem(SIDEBAR_MODE_KEY, mode); } catch { /* */ }
}

// Width per sidebar mode. "full" got bumped from w-72 to w-96 (384px)
// so the floor-plan minimap renders cells big enough to actually read.
// "list" drops the minimap and shrinks to a room-list rail.
const WIDTH_CLS = {
  full: "w-96",
  list: "w-56",
  hidden: "w-0",
};

// Top-level office layout: sidebar (room minimap + list) on the left,
// RoomView in the main pane. URL drives the selected room — `/office`
// auto-redirects to the last visited room (or the first available),
// `/office/r/:roomId` selects directly. localStorage persists both
// the "last visited" hint per team and the sidebar mode preference.
//
// Sidebar mode is a 3-state segmented control:
//   full   — header + minimap + room list (default; widest)
//   list   — header + room list only (narrower; minimap hidden)
//   hidden — collapsed; a small chevron at the left edge expands it
export default function OfficeShell({
  activeTeam, rooms, sessionByRoomId, orgTeams,
  onlineCount, canEdit, busy, onJoin, onStart, onEditOffice,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();
  const { roomId } = useParams();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarMode, setSidebarModeRaw] = useState(loadSidebarMode);

  const setSidebarMode = (next) => {
    setSidebarModeRaw(next);
    saveSidebarMode(next);
  };

  // Resolve which room is selected. URL wins; otherwise fall back to
  // last-visited; otherwise the first room in the team's office.
  const resolvedId = (() => {
    if (roomId && (rooms || []).some((r) => r.id === roomId)) return roomId;
    const last = lastRoomFor(activeTeam?.id);
    if (last && (rooms || []).some((r) => r.id === last)) return last;
    return rooms?.[0]?.id || null;
  })();

  useEffect(() => {
    if (resolvedId && roomId !== resolvedId) {
      navigate(`/office/r/${resolvedId}`, { replace: true });
    }
  }, [resolvedId, roomId, navigate]);

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
      mode={sidebarMode}
      onChangeMode={setSidebarMode}
    />
  );

  const desktopSidebarVisible = sidebarMode !== "hidden";

  return (
    <div className={`flex h-[calc(100vh-64px)] w-full ${
      dark ? "bg-[var(--color-bg)]" : "bg-slate-50"
    }`}>
      {/* Desktop sidebar — width animates between modes, hidden state
          collapses to 0 width with a separate floating expand button. */}
      <div
        className={`hidden md:flex shrink-0 h-full overflow-hidden transition-[width] duration-200 ${
          desktopSidebarVisible ? WIDTH_CLS[sidebarMode] : "w-0"
        }`}
      >
        {desktopSidebarVisible && sidebar}
      </div>

      {/* Expand-from-edge button shown only when sidebar is hidden. */}
      {!desktopSidebarVisible && (
        <button
          type="button"
          onClick={() => setSidebarMode("full")}
          title="Show office sidebar"
          className={`hidden md:flex items-center justify-center h-12 self-center -ml-px rounded-r-md border border-l-0 transition-colors ${
            dark
              ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-400 hover:text-slate-100"
              : "bg-white border-slate-200 text-slate-500 hover:text-slate-800"
          }`}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

      {/* Mobile drawer — overlays from the left. */}
      {drawerOpen && (
        <div
          className="md:hidden fixed inset-0 z-[150] bg-black/50"
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="absolute inset-y-0 left-0 w-80 max-w-[80vw] h-full"
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
