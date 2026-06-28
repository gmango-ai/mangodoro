import { useState, useEffect } from "react";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { Button } from "@/components/ui/button";
import {
  Hash, Briefcase, MessageSquare, Lock,
  LogIn, LogOut, Play, Pause, PanelLeftOpen, PanelLeftClose, ChevronDown, Settings,
  Copy, Check,
} from "lucide-react";
import { getRoomAccessCode } from "../../lib/rooms";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import { openPomodoroSurface } from "../../lib/pomodoroSurface";
import RoomLayout from "./roomLayout/RoomLayout";
import LayoutBar from "./roomLayout/LayoutBar";
import { useRoomLayout } from "./roomLayout/useRoomLayout";
import { PANEL_IDS, ROOM_PANELS } from "./roomLayout/panels";
import { panelsIn } from "./roomLayout/layoutTree";
import { useRoomPanelActivity } from "./roomLayout/useRoomPanelActivity";

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

// Glanceable pomodoro chip shown in the room header when the user
// is in this room's session. Click → opens the floating
// PomodoroSurface modal for full controls. Live mode + remaining
// seconds re-render from the pomodoro context, which is already
// session-synced so every participant sees the same value.
function PomodoroChip() {
  const { mode, secondsLeft, isRunning } = usePomodoro();
  const mins = String(Math.floor(Math.max(0, secondsLeft) / 60)).padStart(2, "0");
  const secs = String(Math.max(0, secondsLeft) % 60).padStart(2, "0");
  const onBreak = mode !== "work";
  return (
    <button
      type="button"
      onClick={openPomodoroSurface}
      title="Open pomodoro controls"
      aria-label="Open pomodoro controls"
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors hover:bg-[var(--color-accent-light-hover)]"
      style={{
        background: onBreak
          ? "color-mix(in srgb, var(--color-break) 14%, transparent)"
          : "var(--color-accent-light)",
        color: onBreak ? "var(--color-break)" : "var(--color-accent)",
      }}
    >
      {isRunning ? (
        <Pause className="w-3 h-3" fill="currentColor" />
      ) : (
        <Play className="w-3 h-3" fill="currentColor" />
      )}
      <span className="font-display tabular-nums">{mins}:{secs}</span>
      <span className="text-[10px] uppercase tracking-wider opacity-80">
        {onBreak ? "break" : "work"}
      </span>
    </button>
  );
}

function RoomSessionAction({ room, activeSession, busy, onJoin, onStart, currentSyncSession }) {
  const inThisRoomSession = !!currentSyncSession && currentSyncSession.room_id === room.id;
  if (inThisRoomSession) {
    return <PomodoroChip />;
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

export default function RoomView({
  room, activeSession, orgTeams, busy, onJoin, onStart,
  sidebarOpen, onToggleSidebar, onOpenRoomSwitcher, onLeaveRoom,
  onEditRoom, canEditRoom,
}) {
  const { theme } = useTheme();
  const { session } = useApp();
  const { syncSession: currentSyncSession } = useSyncSession();
  const dark = theme === "dark";

  // Modular panel layout (per-user, per-room). Replaces the old fixed
  // view modes — see ./roomLayout. Panels = video, chat, whiteboard.
  const { tree, presetId, applyPreset, reset, setRatio, movePanel, addPanelAt, closePanel, togglePanel } = useRoomLayout(room?.id, PANEL_IDS);
  const [arranging, setArranging] = useState(false);

  // Access code for a code-gated room — fetched only for managers (RLS on
  // room_secrets returns nothing to anyone else), so it can be grabbed and
  // shared straight from the header.
  const [accessCode, setAccessCode] = useState("");
  const [codeCopied, setCodeCopied] = useState(false);
  const isCodeRoom = room?.entry_policy === "code";
  useEffect(() => {
    if (!isCodeRoom || !canEditRoom || !room?.id) { setAccessCode(""); return; }
    let cancelled = false;
    getRoomAccessCode(room.id).then(({ data }) => { if (!cancelled) setAccessCode(data || ""); });
    return () => { cancelled = true; };
  }, [room?.id, isCodeRoom, canEditRoom]);
  async function copyAccessCode() {
    if (!accessCode) return;
    try {
      await navigator.clipboard.writeText(accessCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  }

  if (!room) return null;

  // Quick-toggle data for the header: which panels exist + their icon/title.
  const activePanels = panelsIn(tree);
  const quickPanels = PANEL_IDS.map((id) => ({
    id, title: ROOM_PANELS[id].title, Icon: ROOM_PANELS[id].icon,
  }));

  // Whiteboard link flows through the sync session (session.whiteboard_id),
  // mirroring the old retro link. Anyone in the room may attach/swap it — it's a
  // shared surface; the server gates on session participation, not leadership.
  const displayName = session?.user?.user_metadata?.name || session?.user?.email || "Guest";
  const inThisRoomSession = !!currentSyncSession && currentSyncSession.room_id === room.id;
  const linkedWhiteboardId = inThisRoomSession ? (currentSyncSession.whiteboard_id || null) : null;
  const canLinkWhiteboard = inThisRoomSession;

  // Activity on CLOSED panels → header-toggle badges (people in the call /
  // editing the board, unread chat) so you can tell what's live without opening
  // each panel.
  const activity = useRoomPanelActivity({
    roomId: room.id,
    userId: session?.user?.id,
    whiteboardId: linkedWhiteboardId,
    videoOpen: activePanels.includes("video"),
    chatOpen: activePanels.includes("chat"),
    whiteboardOpen: activePanels.includes("whiteboard"),
  });
  const panelBadges = {
    video: activity.video > 0 ? { count: activity.video, live: true } : null,
    chat: activity.chat > 0 ? { count: activity.chat } : null,
    whiteboard: activity.whiteboard > 0 ? { count: activity.whiteboard, live: true } : null,
  };
  const panelCtx = {
    room,
    userId: session?.user?.id,
    displayName,
    dark,
    whiteboardId: linkedWhiteboardId,
    canLink: canLinkWhiteboard,
  };

  const Icon = KIND_ICON[room.kind] || Hash;
  const accent = room.color || "#14b8a6";
  const gatingTeams = (room.room_teams || [])
    .map((rt) => (orgTeams || []).find((t) => t.id === rt.org_team_id))
    .filter(Boolean);

  const SidebarIcon = sidebarOpen ? PanelLeftClose : PanelLeftOpen;

  return (
    <div className="flex flex-col h-full min-h-0">
      <header
        className={`@container px-4 sm:px-6 py-3 border-b shrink-0 ${
          dark ? "border-[var(--color-border)]" : "border-slate-200"
        }`}
        style={{ background: `linear-gradient(180deg, ${accent}12, transparent)` }}
      >
        {/* Split into two groups that stack into two rows when the bar
            is narrow and collapse back to one row when it's wide. We key
            off a *container* query (the header's own width) rather than a
            viewport breakpoint because the room view loses ~288px to the
            inline widgets sidebar when it's open — so the same viewport
            can be one row (sidebar closed) or two (sidebar open). The
            single row only fits once the header is ~576px+ wide, which is
            roughly a 925px viewport with the sidebar open. */}
        <div className="flex flex-col gap-2 @xl:flex-row @xl:items-center @xl:gap-3">
          {/* Identity row — room name, switcher, leave. Grows to fill
              the bar in one-row mode; the first of two rows when narrow. */}
          <div className="flex items-center gap-3 min-w-0 @xl:flex-1">
            {onToggleSidebar && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleSidebar}
                title={sidebarOpen ? "Hide widgets" : "Show widgets"}
                aria-label={sidebarOpen ? "Hide widgets sidebar" : "Show widgets sidebar"}
                aria-pressed={sidebarOpen}
                className={`hidden md:inline-flex h-8 w-8 shrink-0 ${
                  dark ? "text-slate-400 hover:text-slate-100" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <SidebarIcon className="w-4 h-4" />
              </Button>
            )}

            {/* Room identity — clickable. Opens the office overlay so
                the user can switch rooms or leave to the hallway. */}
            <button
              type="button"
              onClick={onOpenRoomSwitcher}
              className={`flex items-center gap-3 min-w-0 flex-1 text-left rounded-lg -m-1 p-1 transition-colors ${
                dark ? "hover:bg-[var(--color-surface-raised)]/60" : "hover:bg-slate-100/60"
              }`}
              title="Switch room"
            >
              <div
                className="p-2 rounded-xl shrink-0"
                style={{ background: `${accent}22`, color: accent }}
              >
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className={`text-lg font-bold truncate inline-flex items-center gap-1.5 ${
                  dark ? "text-slate-100" : "text-slate-800"
                }`}>
                  {room.name}
                  <ChevronDown className={`w-3.5 h-3.5 shrink-0 opacity-60 ${dark ? "text-slate-400" : "text-slate-500"}`} />
                </h1>
                <p className={`text-[10px] uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>
                  {KIND_LABEL[room.kind] || room.kind}
                  {room.entry_policy === "code" && (
                    <span className={`ml-2 ${dark ? "text-amber-300" : "text-amber-600"}`}>
                      · Locked
                    </span>
                  )}
                </p>
              </div>
            </button>

            {/* Access code chip — managers can grab + share the room's
                code without opening settings. Click copies to clipboard.
                Only rendered when a code exists (RLS hides it from
                non-managers, so this never leaks). */}
            {isCodeRoom && canEditRoom && accessCode && (
              <button
                type="button"
                onClick={copyAccessCode}
                title="Copy access code — share it to let people in"
                aria-label={`Room access code ${accessCode}. Click to copy.`}
                className={`inline-flex items-center gap-1.5 shrink-0 h-8 px-2.5 rounded-lg border text-xs font-mono tracking-widest transition-colors ${
                  dark
                    ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-amber-200 hover:border-amber-400/50"
                    : "bg-amber-50 border-amber-200 text-amber-700 hover:border-amber-300"
                }`}
              >
                <Lock className="w-3 h-3 opacity-70" />
                <span>{accessCode}</span>
                {codeCopied
                  ? <Check className="w-3.5 h-3.5" />
                  : <Copy className="w-3.5 h-3.5 opacity-70" />}
              </button>
            )}

            {/* Room settings — opens the same RoomSettingsModal used on
                the team page (name, color, team gating, meeting duration,
                delete). Only shown to users who can actually edit this
                room; the RPCs enforce permission server-side regardless. */}
            {canEditRoom && onEditRoom && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onEditRoom(room)}
                title="Room settings"
                aria-label="Room settings"
                className={`h-8 w-8 shrink-0 ${
                  dark ? "text-slate-400 hover:text-slate-100" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                <Settings className="w-4 h-4" />
              </Button>
            )}

            {/* Leave room — navigates to the hallway, which trips the
                auto-leave effect in OfficeShell (same path as the
                overlay's "Leave to hallway"). Kept right next to the
                name so leaving is a one-click action, not buried in the
                switcher overlay. */}
            {onLeaveRoom && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onLeaveRoom}
                title="Leave room"
                aria-label="Leave room"
                className={`h-8 w-8 shrink-0 ${
                  dark
                    ? "text-slate-400 hover:text-rose-300 hover:bg-rose-500/10"
                    : "text-slate-500 hover:text-rose-600 hover:bg-rose-50"
                }`}
              >
                <LogOut className="w-4 h-4" />
              </Button>
            )}

            {gatingTeams.length > 0 && (
              <div className="hidden xl:flex flex-wrap items-center gap-1.5">
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
          </div>

          {/* Controls row — session status + layout tools. Drops to a
              second row when the bar is too narrow for one row. */}
          <div className="flex items-center gap-2 @xl:gap-3 justify-between @xl:justify-end shrink-0">
            <RoomSessionAction
              room={room}
              activeSession={activeSession}
              busy={busy}
              onJoin={onJoin}
              onStart={onStart}
              currentSyncSession={currentSyncSession}
            />

            <LayoutBar
              presetId={presetId}
              onApply={applyPreset}
              onReset={reset}
              accent={accent}
              dark={dark}
              arranging={arranging}
              onToggleArrange={() => setArranging((v) => !v)}
              panels={quickPanels}
              activePanels={activePanels}
              badges={panelBadges}
              onTogglePanel={togglePanel}
            />
          </div>
        </div>
      </header>

      {/* Body — a modular tiling layout. Pick a preset from the header,
          drag the dividers to resize. Tiles are absolutely positioned
          from the layout tree so panels (incl. the live video call) are
          repositioned, never remounted. */}
      <div className="flex-1 min-h-0 p-4 overflow-hidden">
        <RoomLayout
          tree={tree}
          ctx={panelCtx}
          onRatioChange={setRatio}
          arranging={arranging}
          onMove={movePanel}
          onAddAt={addPanelAt}
          onClose={closePanel}
        />
      </div>
    </div>
  );
}
