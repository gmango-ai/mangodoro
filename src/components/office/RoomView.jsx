import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { Button } from "@/components/ui/button";
import {
  Hash, Briefcase, MessageSquare, Lock, Video,
  LogIn, Play, PanelLeftOpen, PanelLeftClose, Rows2, Columns2,
  ChevronDown, Target,
} from "lucide-react";
import RoomChatPanel from "../RoomChatPanel";
import RoomVideoStage from "../video/RoomVideoStage";
import ResizableSplit from "./ResizableSplit";

// View modes:
//   chat    — just chat, full pane
//   stack   — video on top, chat on bottom  (vertical split / Rows2)
//   side    — video left, chat right        (horizontal split / Columns2)
//   video   — just video, full pane
//   retro   — embedded retro board (only available when one is linked)
const VIEW_MODE_KEY = "ql_room_view_mode";
const VALID_VIEW_MODES = ["chat", "stack", "side", "video", "retro"];

function loadViewMode() {
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    if (stored && VALID_VIEW_MODES.includes(stored)) return stored;
  } catch { /* */ }
  return "stack";
}
function saveViewMode(mode) {
  try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch { /* */ }
}

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

function ViewModeControl({ value, onChange, accent, dark, hasRetro }) {
  // 4-button segmented control. Two "both" options with icons that
  // hint at the split direction — Rows2 = stacked / Columns2 = side-
  // by-side — so the choice reads without the label.
  // Retro becomes a 5th option when a retro is linked to the session.
  const options = [
    { key: "chat",  Icon: MessageSquare, label: "Chat" },
    { key: "stack", Icon: Rows2,         label: "Stacked" },
    { key: "side",  Icon: Columns2,      label: "Side" },
    { key: "video", Icon: Video,         label: "Video" },
    ...(hasRetro ? [{ key: "retro", Icon: Target, label: "Retro" }] : []),
  ];
  return (
    <div
      className={`inline-flex p-0.5 rounded-full ${
        dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-100"
      }`}
      role="tablist"
      aria-label="Room view mode"
    >
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.key)}
            title={opt.label}
            className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[11px] font-semibold transition-colors ${
              active
                ? "text-white shadow-sm"
                : dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"
            }`}
            style={active ? { background: accent } : {}}
          >
            <opt.Icon className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function RoomSessionAction({ room, activeSession, busy, onJoin, onStart, currentSyncSession }) {
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

export default function RoomView({
  room, activeSession, orgTeams, busy, onJoin, onStart,
  sidebarOpen, onToggleSidebar, onOpenRoomSwitcher,
}) {
  const { theme } = useTheme();
  const { session } = useApp();
  const { syncSession: currentSyncSession } = useSyncSession();
  const dark = theme === "dark";

  const [viewMode, setViewModeRaw] = useState(loadViewMode);
  const setViewMode = (m) => { setViewModeRaw(m); saveViewMode(m); };
  useEffect(() => { saveViewMode(viewMode); }, [viewMode]);

  // Retro linkage flows through the sync session. The Link / Unlink
  // controls live in the WidgetsSidebar; here we just react to the
  // retro_id state.
  const inThisRoomSession = !!currentSyncSession && currentSyncSession.room_id === room.id;
  const linkedRetroId = inThisRoomSession ? (currentSyncSession.retro_id || null) : null;

  // If a retro was the active view but it just got unlinked
  // (another leader cleared it, retro deleted, we left the session),
  // fall back to stack so the body doesn't render an empty iframe.
  useEffect(() => {
    if (viewMode === "retro" && !linkedRetroId) setViewModeRaw("stack");
  }, [viewMode, linkedRetroId]);

  // Auto-switch everyone in the room to the retro view as soon as a
  // retro becomes linked. We only fire on the null → linked transition
  // (or a relink to a different retro) so a user who manually flips
  // back to "stack" / "chat" / "side" / "video" afterwards isn't
  // dragged back to retro every render. setViewMode (not Raw) writes
  // through to localStorage, so the choice persists too.
  const prevRetroRef = useRef(linkedRetroId);
  useEffect(() => {
    const prev = prevRetroRef.current;
    if (linkedRetroId && linkedRetroId !== prev) {
      setViewMode("retro");
    }
    prevRetroRef.current = linkedRetroId;
  }, [linkedRetroId]);

  if (!room) return null;

  const Icon = KIND_ICON[room.kind] || Hash;
  const accent = room.color || "#14b8a6";
  const gatingTeams = (room.room_teams || [])
    .map((rt) => (orgTeams || []).find((t) => t.id === rt.org_team_id))
    .filter(Boolean);

  const SidebarIcon = sidebarOpen ? PanelLeftClose : PanelLeftOpen;

  return (
    <div className="flex flex-col h-full min-h-0">
      <header
        className={`px-4 sm:px-6 py-3 border-b shrink-0 ${
          dark ? "border-[var(--color-border)]" : "border-slate-200"
        }`}
        style={{ background: `linear-gradient(180deg, ${accent}12, transparent)` }}
      >
        <div className="flex items-center gap-3">
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
                {room.kind === "private" && room.invite_code && (
                  <span className={`ml-2 ${dark ? "text-amber-300" : "text-amber-600"}`}>
                    · Locked
                  </span>
                )}
              </p>
            </div>
          </button>

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

          <RoomSessionAction
            room={room}
            activeSession={activeSession}
            busy={busy}
            onJoin={onJoin}
            onStart={onStart}
            currentSyncSession={currentSyncSession}
          />

          <ViewModeControl
            value={viewMode}
            onChange={setViewMode}
            accent={accent}
            dark={dark}
            hasRetro={!!linkedRetroId}
          />
        </div>
      </header>

      {/* Body. Layout follows viewMode. stack + side render the
          ResizableSplit between video and chat — drag the handle to
          adjust, drag past either pane's min by ~60px to snap-close
          that pane and bounce into a single-pane view mode. */}
      <div className="flex-1 min-h-0 p-4 overflow-hidden">
        {viewMode === "chat" && (
          <RoomChatPanel
            roomId={room.id}
            userId={session?.user?.id}
            fillHeight
          />
        )}
        {viewMode === "video" && (
          <RoomVideoStage
            roomId={room.id}
            displayName={session?.user?.user_metadata?.name || session?.user?.email || "Guest"}
          />
        )}
        {(viewMode === "stack" || viewMode === "side") && (
          <ResizableSplit
            direction={viewMode === "stack" ? "vertical" : "horizontal"}
            storageKey={viewMode === "stack" ? "ql_room_split_stack" : "ql_room_split_side"}
            defaultSplit={0.55}
            minFirstPx={240}
            minSecondPx={200}
            onCollapseFirst={() => setViewMode("chat")}
            onCollapseSecond={() => setViewMode("video")}
          >
            <RoomVideoStage
              roomId={room.id}
              displayName={session?.user?.user_metadata?.name || session?.user?.email || "Guest"}
            />
            <RoomChatPanel
              roomId={room.id}
              userId={session?.user?.id}
              fillHeight
            />
          </ResizableSplit>
        )}
        {viewMode === "retro" && linkedRetroId && (
          // 3-column layout: retro takes most of the screen so everyone
          // can see what's being typed; the room call shrinks into a
          // narrow right column (video on top, chat compressed at the
          // bottom). On narrow screens, the retro stacks above the call.
          //
          // MVP: iframe the existing retro page so editing + realtime
          // work as-is. Same origin → auth cookies pass through. The
          // proper inline replacement is a follow-up that extracts a
          // RetroBoard component out of RetroPage's 620-line render.
          <div className="flex flex-col lg:flex-row gap-3 h-full">
            <iframe
              key={linkedRetroId}
              src={`/retros/${linkedRetroId}?embed=1`}
              className={`flex-1 min-h-0 min-w-0 rounded-xl border ${
                dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-white"
              }`}
              title="Retro board"
              allow="clipboard-read; clipboard-write"
            />
            <aside className="flex flex-col gap-3 lg:w-72 xl:w-80 shrink-0 min-h-0">
              <div className="flex-1 min-h-[200px]">
                <RoomVideoStage
                  roomId={room.id}
                  displayName={session?.user?.user_metadata?.name || session?.user?.email || "Guest"}
                />
              </div>
              <div className="h-40 lg:h-48 shrink-0">
                <RoomChatPanel
                  roomId={room.id}
                  userId={session?.user?.id}
                  fillHeight
                />
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
