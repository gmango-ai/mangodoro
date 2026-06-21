import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTheme } from "../../context/ThemeContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { useVideoCall } from "../../context/VideoCallContext";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import WidgetsSidebar from "./WidgetsSidebar";
import RoomView from "./RoomView";
import HallwayView from "./HallwayView";
import OfficeOverlay from "./OfficeOverlay";

const LAST_ROOM_KEY = "ql_office_last_room";
const SIDEBAR_OPEN_KEY = "ql_office_widgets_open";

function lastRoomFor(teamId) {
  if (!teamId) return null;
  try {
    const raw = localStorage.getItem(LAST_ROOM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.[teamId] || null;
  } catch { return null; }
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

function loadSidebarOpen() {
  try {
    const stored = localStorage.getItem(SIDEBAR_OPEN_KEY);
    if (stored === null) return true;
    return stored !== "false";
  } catch { return true; }
}
function saveSidebarOpen(v) {
  try { localStorage.setItem(SIDEBAR_OPEN_KEY, v ? "true" : "false"); } catch { /* */ }
}

// Top-level office layout.
//
//   Left rail   — widgets sidebar (tasks, etc.). Toggleable.
//   Main pane   — Hallway when URL is /office (no roomId), RoomView
//                 when /office/r/:roomId. No more "auto-redirect to
//                 last room"; the hallway is a real destination, not
//                 a brief in-between state.
//   Overlay     — modal triggered from the room name in RoomView's
//                 header. Switch rooms or leave to hallway.
//
// The earlier office-shell shape had the rooms list as the persistent
// left sidebar and a 3-state Map/List/Hide toggle for it. The user
// pushed back: rooms aren't something you stare at constantly, and
// the segmented control was more chrome than the decision deserved.
// Now rooms live in the on-demand overlay; the left rail is for
// utility widgets that DO need to be glance-able.
export default function OfficeShell({
  activeTeam, rooms, lockedRooms, sessionByRoomId, orgTeams,
  onlineCount, canEdit, busy, onJoin, onStart, onEditOffice,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();
  const { roomId } = useParams();
  const [sidebarOpen, setSidebarOpenRaw] = useState(loadSidebarOpen);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);

  const setSidebarOpen = (next) => {
    setSidebarOpenRaw(next);
    saveSidebarOpen(next);
  };

  // Resolve the active room from URL. We deliberately do NOT auto-
  // redirect when the URL is bare /office — that path now lands the
  // user in the hallway. /office/r/:id stays in that room.
  const resolvedRoomId = (roomId && (rooms || []).some((r) => r.id === roomId)) ? roomId : null;
  const selectedRoom = resolvedRoomId ? rooms.find((r) => r.id === resolvedRoomId) : null;
  const activeSession = selectedRoom ? (sessionByRoomId?.get(selectedRoom.id) || null) : null;

  // Auto-open into the room the user is already in.
  // When the user lands on bare /office and they have an active sync
  // session bound to a visible room, jump straight into that room —
  // they're "in" it from the system's POV, so showing the hallway is
  // misleading. Fires once per mount via a ref so the user can still
  // click "Hallway" to leave intentionally without being yanked back.
  const { syncSession, leaveSession } = useSyncSession();
  const { call, endCall } = useVideoCall();
  const autoOpenedRef = useRef(false);

  // Explicit leave. Connection-aware model: incidental navigation never
  // leaves a room (you keep heartbeating, so you stay "in" it until your
  // last tab closes and the sweeper reaps you). Leaving is a deliberate
  // act — the room header's Leave button and the overlay's "Leave to
  // hallway" both route here, which removes the user from the session
  // (across all their tabs) and drops them in the hallway.
  const handleLeaveRoom = async () => {
    // Leaving is deliberate — tear the room's video call down too so the
    // PiP doesn't linger after you've left. (The session-bound teardown
    // in PersistentVideoCall only fires when a session was tracking the
    // room; ending here covers the call regardless.)
    if (call) endCall();
    await leaveSession();
    navigate("/office");
  };
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (resolvedRoomId) {
      // Either we're already in a room URL, or the URL has a roomId
      // we don't recognize; either way, don't auto-redirect.
      autoOpenedRef.current = true;
      return;
    }
    const activeRoomId = syncSession?.room_id;
    if (!activeRoomId) return; // No session, or session not bound to a room
    const visible = (rooms || []).some((r) => r.id === activeRoomId);
    if (!visible) return; // Session for a room they can't see — leave them in the hallway
    autoOpenedRef.current = true;
    navigate(`/office/r/${activeRoomId}`, { replace: true });
  }, [resolvedRoomId, syncSession?.room_id, rooms, navigate]);

  // Persist last-visited room so we can highlight it in the hallway
  // ("you were here recently"). Doesn't change navigation behavior.
  useEffect(() => {
    if (resolvedRoomId && activeTeam?.id) rememberRoomFor(activeTeam.id, resolvedRoomId);
  }, [resolvedRoomId, activeTeam?.id]);

  // Auto-bind the user's sync session to the room they ENTER.
  //
  //   Enter a room  → if an active session exists for it, join. If not,
  //                   start one (private rooms still go through the
  //                   code prompt via onStart).
  //   Leave a room  → NOT handled here. Connection-aware model: leaving
  //                   is explicit (handleLeaveRoom) or implicit via
  //                   staleness — navigating away keeps you heartbeating,
  //                   so you stay in the room until your last tab closes
  //                   and the sweeper reaps the empty room. Switching to
  //                   another room just rebinds the session; the old
  //                   room's last_seen goes stale and drops off on its
  //                   own (read-time liveness + sweep).
  //
  // boundRoomRef de-dupes the effect across re-renders triggered by
  // sessionByRoomId / syncSession updates — we only want to act on
  // actual URL transitions, not whenever the realtime list refreshes.
  // Private rooms with an active invite_code are skipped on auto-start:
  // onStart would pop the code prompt, and we don't want that prompt
  // appearing just because the user typed a URL.
  const boundRoomRef = useRef(null);
  const inFlightRef = useRef(false);
  useEffect(() => {
    const target = resolvedRoomId || null;
    const bound = boundRoomRef.current;
    if (target === bound) return;
    if (inFlightRef.current) return;

    const currentSessionRoom = syncSession?.room_id || null;

    inFlightRef.current = true;
    (async () => {
      try {
        if (target) {
          // If we're already in this room's session (cross-device
          // rehydrate landed us here), do nothing — we're aligned.
          if (currentSessionRoom !== target) {
            const active = sessionByRoomId?.get(target) || null;
            const room = (rooms || []).find((r) => r.id === target);
            if (room?.kind === "private" && room.invite_code && !active) {
              // Locked private rooms still need explicit code entry.
              // The user can hit "Start a session" to surface the
              // prompt manually.
            } else if (active) {
              await onJoin?.(room);
            } else if (room) {
              await onStart?.(room);
            }
          }
        }
        boundRoomRef.current = target;
      } finally {
        inFlightRef.current = false;
      }
    })();
    // We intentionally depend ONLY on the URL room id. sessionByRoomId
    // and syncSession changes are captured at fire-time via closure;
    // re-running on every realtime tick would re-trigger join cycles
    // when nothing actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedRoomId]);

  const sidebar = <WidgetsSidebar />;

  // ── HALLWAY ── contained, native app page. No widgets rail and no
  // full-bleed shell: the hallway sits in the same centered column on
  // the app's global gradient background as every other page. The rail
  // + two-pane workspace only appear once you step into a room (below).
  if (!selectedRoom) {
    return (
      <main className="max-w-[1100px] mx-auto px-4 sm:px-6 pt-6 pb-24">
        <HallwayView
          activeTeam={activeTeam}
          rooms={rooms}
          lockedRooms={lockedRooms}
          sessionByRoomId={sessionByRoomId}
          onlineCount={onlineCount}
          canEdit={canEdit}
          busy={busy}
          onEnterRoom={(id) => navigate(`/office/r/${id}`)}
          onEditOffice={onEditOffice}
        />
      </main>
    );
  }

  // ── IN A ROOM ── two-pane workspace: the widgets rail (pomodoro,
  // tasks, …) earns its place here, alongside the room's chat / video /
  // timer. This is the one surface in the app with a side rail, by design.
  //
  // Root height fills exactly below the global nav: subtract the nav bar
  // (3.5rem mobile / 4rem desktop, matching Nav's h-14 sm:h-16) and the top
  // safe-area inset. The old flat `100vh - 64px` was ~50px too tall on Dynamic
  // Island phones, which pushed the room's bottom "add panels" dock off screen.
  // env() is 0 on desktop.
  return (
    <div className={`flex h-[calc(100dvh-3.5rem-var(--top-inset)-var(--bottom-inset))] sm:h-[calc(100dvh-4rem-var(--top-inset)-var(--bottom-inset))] w-full ${
      dark ? "bg-[var(--color-bg)]" : "bg-slate-50"
    }`}>
      {/* Desktop widgets sidebar.
          Width: 18rem (288px) open, 0 closed. min-width pins the open
          state so flex doesn't squeeze it when the room contents
          push for more space — keeps the right edge flush with the
          room view's left edge across viewports. */}
      <div
        className={`hidden md:flex shrink-0 h-full overflow-hidden transition-[width] duration-200 ${
          sidebarOpen ? "w-72 min-w-[18rem]" : "w-0 min-w-0"
        }`}
      >
        {sidebarOpen && sidebar}
      </div>

      {/* Mobile drawer */}
      {mobileSidebarOpen && (
        <div
          className="md:hidden fixed inset-0 z-[150] bg-black/50"
          onClick={() => setMobileSidebarOpen(false)}
        >
          <div
            className="absolute inset-y-0 left-0 w-72 max-w-[80vw] h-full"
            onClick={(e) => e.stopPropagation()}
          >
            {sidebar}
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile header (sidebar drawer toggle + room name) */}
        <div className={`md:hidden flex items-center gap-2 px-3 py-2 border-b ${
          dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
        }`}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileSidebarOpen(true)}
            className="h-8 w-8"
            aria-label="Open widgets"
          >
            <Menu className="w-4 h-4" />
          </Button>
          <p className={`text-sm font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
            {selectedRoom?.name || "Hallway"}
          </p>
        </div>

        <RoomView
          room={selectedRoom}
          activeSession={activeSession}
          orgTeams={orgTeams}
          busy={busy}
          onJoin={() => onJoin?.(selectedRoom)}
          onStart={() => onStart?.(selectedRoom)}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
          onOpenRoomSwitcher={() => setOverlayOpen(true)}
          onLeaveRoom={handleLeaveRoom}
        />
      </div>

      <OfficeOverlay
        open={overlayOpen}
        onClose={() => setOverlayOpen(false)}
        rooms={rooms}
        lockedRooms={lockedRooms}
        sessionByRoomId={sessionByRoomId}
        selectedRoomId={resolvedRoomId}
        onLeaveToHallway={handleLeaveRoom}
      />
    </div>
  );
}
