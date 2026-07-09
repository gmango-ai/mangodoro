import { useEffect, useMemo, useRef, useState } from "react";
import {
  Play, Pause, RotateCcw, Users, Clock, ChevronDown, Loader2,
  Square, LogOut as LogOutIcon, MessageSquare, Sun, Moon,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { usePomodoro } from "../pomodoro/PomodoroContext";
import { useTheme } from "../context/ThemeContext";
import { createSyncSession, joinSyncSession } from "../lib/syncSession";
import { getSessionCreatePrefs } from "../pomodoro/storage";
import { applyAccent } from "../lib/accent";
import { supabase } from "../supabase";
import PomodoroSurface from "../components/pomodoro/PomodoroSurface";
import { useVisibilityPausedInterval } from "../hooks/useVisibilityPausedInterval";
import { usePopoverAutoResize } from "./usePopoverAutoResize";
import { useResolvedSelf } from "../hooks/useResolvedSelf";
import { applyStatusOverride } from "../lib/statusActions";
import { availabilityDot } from "../lib/presence";

/**
 * Electron menu-bar popover. Three pages on a tab strip — Pomodoro,
 * Office, Time — plus an org switcher in the header. Designed to be a
 * focused "what am I doing right now" surface; org editing, retros,
 * timesheets and the like stay in the main window.
 *
 * Visual goals:
 *   • Single opaque background that matches the active theme (no
 *     accent bleed between cards like the previous v1)
 *   • Compact, content-first layout — each tab can fully express
 *     itself without scrolling for most users
 *   • Theme syncs from the main window via the shared localStorage
 *     `ql_theme` key (storage events propagate across BrowserWindows)
 */
export default function QuickActionsPopover() {
  const { theme, toggleTheme } = useTheme();
  const { settings } = useApp();
  const dark = theme === "dark";
  const [tab, setTab] = useState("pomodoro");
  const containerRef = useRef(null);

  // Apply the user's accent palette so the popover's --color-accent
  // matches whatever the main app shows. AppContext fetches settings
  // from Supabase and updates this when the user changes their accent
  // in Settings — this effect picks that up automatically.
  useEffect(() => {
    applyAccent(settings?.accentColor || "teal", dark);
  }, [settings?.accentColor, dark]);

  // Live-resize the BrowserWindow as the active tab's content reflows.
  usePopoverAutoResize(containerRef);

  return (
    <div
      ref={containerRef}
      className={`w-screen flex flex-col ${
        dark ? "bg-[#0f172a] text-slate-100" : "bg-white text-slate-800"
      }`}
      style={{ minHeight: "100%" }}
    >
      <Header dark={dark} onToggleTheme={toggleTheme} />
      <TabStrip dark={dark} active={tab} onChange={setTab} />
      <div className="px-3 pt-2 pb-3">
        {tab === "pomodoro" && <PomodoroPage dark={dark} />}
        {tab === "office" && <OfficePage dark={dark} />}
        {tab === "time" && <TimePage dark={dark} />}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Header — org switcher + theme toggle
// ────────────────────────────────────────────────────────────────────
function Header({ dark, onToggleTheme }) {
  const { teams, activeTeam, switchTeam } = useTeam();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div
      className={`flex items-center justify-between px-3 py-2 border-b ${
        dark ? "border-slate-800" : "border-slate-100"
      }`}
    >
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={(teams || []).length === 0}
          className={`flex items-center gap-1.5 text-sm font-semibold px-2 py-1 -mx-2 rounded-md transition-colors ${
            dark ? "hover:bg-slate-800" : "hover:bg-slate-100"
          } disabled:cursor-default disabled:hover:bg-transparent`}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: activeTeam?.color || "var(--color-accent)" }}
          />
          <span className="truncate max-w-[200px]">{activeTeam?.name ?? "No org"}</span>
          {(teams || []).length > 1 && (
            <ChevronDown className={`w-3 h-3 ${dark ? "text-slate-500" : "text-slate-400"}`} />
          )}
        </button>
        {open && (teams || []).length > 1 && (
          <div
            className={`absolute left-0 top-full mt-1 min-w-[200px] rounded-md shadow-lg z-20 overflow-hidden border ${
              dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"
            }`}
          >
            {teams.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { switchTeam(t.id); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors ${
                  t.id === activeTeam?.id
                    ? dark ? "bg-slate-800 text-slate-100" : "bg-slate-50 text-slate-900"
                    : dark ? "hover:bg-slate-800 text-slate-300" : "hover:bg-slate-50 text-slate-700"
                }`}
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.color || "var(--color-accent)" }} />
                <span className="truncate flex-1">{t.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onToggleTheme}
        className={`p-1.5 rounded-md transition-colors ${
          dark ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"
        }`}
        title={dark ? "Light mode" : "Dark mode"}
      >
        {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Tab strip
// ────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "pomodoro", label: "Pomodoro" },
  { id: "office", label: "Office" },
  { id: "time", label: "Time" },
];
function TabStrip({ dark, active, onChange }) {
  return (
    <div
      className={`flex px-3 pt-2 gap-1 border-b ${
        dark ? "border-slate-800" : "border-slate-100"
      }`}
    >
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={`flex-1 text-xs font-semibold pb-2 pt-1 rounded-t-md transition-colors relative ${
              isActive
                ? dark ? "text-slate-100" : "text-slate-900"
                : dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"
            }`}
          >
            {t.label}
            {isActive && (
              <span
                className="absolute -bottom-px left-2 right-2 h-0.5 rounded-full"
                style={{ backgroundColor: "var(--color-accent)" }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Pomodoro page — composes the popover variant of PomodoroSurface,
// which renders ModePicker + clock + controls + SyncPanel (with the
// participant list at popover density) + StatusSetter + SoundPicker
// in a single column. The popover-specific status block and ad-hoc
// timer chrome from the v1 layout were replaced by the shared
// composables.
// ────────────────────────────────────────────────────────────────────
function PomodoroPage() {
  return <PomodoroSurface variant="popover" />;
}

// ────────────────────────────────────────────────────────────────────
// Office page
// ────────────────────────────────────────────────────────────────────
function OfficePage({ dark }) {
  const { session } = useApp();
  const { activeTeam, visibleRooms, activeTeamSessions, teamMembers } = useTeam();
  const { syncSession, joinSession } = useSyncSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expandedRoomId, setExpandedRoomId] = useState(null);

  const sessionByRoomId = useMemo(() => {
    const m = new Map();
    for (const s of activeTeamSessions || []) if (s.room_id) m.set(s.room_id, s);
    return m;
  }, [activeTeamSessions]);

  const currentRoom = useMemo(
    () => syncSession?.room_id && (visibleRooms || []).find((r) => r.id === syncSession.room_id),
    [syncSession?.room_id, visibleRooms]
  );

  function displayName() {
    const m = (teamMembers || []).find((tm) => tm.user_id === session?.user?.id);
    return m?.name || session?.user?.user_metadata?.name || session?.user?.email || "Guest";
  }

  async function enterRoom(room) {
    const active = sessionByRoomId.get(room.id);
    // "Open until occupied": an EMPTY code room is enterable (first one in,
    // no code). Once occupied, it locks — and the popover has no code gate,
    // so route non-owners to the office where the lock gate lives.
    if (room.entry_policy === "code" && active && room.created_by !== session?.user?.id) {
      setError("This room is locked — open the office in the main window to enter its code.");
      return;
    }
    setBusy(true); setError("");
    if (active) {
      const { data, error: e } = await joinSyncSession(active.join_code, displayName());
      setBusy(false);
      if (e) { setError(e.message || "Could not join."); return; }
      if (data?.session) joinSession(data.session);
      return;
    }
    const { data, error: e } = await createSyncSession(session.user.id, displayName(), {
      teamId: activeTeam.id,
      roomId: room.id,
      visibility: "team",
      ...getSessionCreatePrefs(),
    });
    setBusy(false);
    if (e) { setError(e.message || "Could not start session."); return; }
    if (data) joinSession(data);
  }

  if (!activeTeam) {
    return (
      <p className={`text-sm py-3 px-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>
        Join or create an org in the main window first.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {currentRoom && (
        <div
          className={`flex items-center gap-2 rounded-md px-2.5 py-2 border ${
            dark ? "bg-slate-800/60 border-slate-700" : "bg-slate-50 border-slate-200"
          }`}
        >
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: currentRoom.color || "var(--color-accent)" }}
          />
          <span className={`text-sm font-semibold ${dark ? "text-slate-100" : "text-slate-800"}`}>
            {currentRoom.name}
          </span>
          <span className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>· you're here</span>
          {syncSession?.expires_at && (
            <MeetingCountdownChip
              expiresAt={syncSession.expires_at}
              sessionId={syncSession.id}
              dark={dark}
            />
          )}
        </div>
      )}

      <div
        className={`rounded-md overflow-hidden border divide-y ${
          dark ? "border-slate-800 divide-slate-800" : "border-slate-100 divide-slate-100"
        }`}
      >
        {(visibleRooms || []).map((room) => {
          const active = sessionByRoomId.get(room.id);
          const isCurrent = currentRoom?.id === room.id;
          const occupants = active?.occupants ?? [];
          const expanded = expandedRoomId === room.id;
          // Tappable header expands/collapses. The Join button is its
          // own surface so users can preview a room (see who's in it,
          // what they're working on) without committing to joining.
          return (
            <div key={room.id} className={dark ? "bg-slate-900/40" : "bg-white"}>
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => setExpandedRoomId(expanded ? null : room.id)}
                  className={`flex-1 flex items-center gap-2 text-left px-2.5 py-2 transition-colors ${
                    dark ? "hover:bg-slate-800/60" : "hover:bg-slate-50"
                  }`}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: room.color || "var(--color-accent)" }}
                  />
                  <span className={`text-sm font-medium flex-1 min-w-0 truncate ${
                    dark ? "text-slate-200" : "text-slate-700"
                  }`}>
                    {room.name}
                    {isCurrent && (
                      <span className={`ml-1.5 text-[10px] font-semibold uppercase tracking-wider ${
                        dark ? "text-emerald-400" : "text-emerald-600"
                      }`}>· here</span>
                    )}
                  </span>
                  {/* Always-visible avatar stack so users can see who's
                      in a room at a glance, no expanding needed. */}
                  {occupants.length > 0 && (
                    <AvatarStack occupants={occupants} dark={dark} max={3} />
                  )}
                  <ChevronDown
                    className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""} ${
                      dark ? "text-slate-500" : "text-slate-400"
                    }`}
                  />
                </button>
              </div>
              {expanded && (
                <div className={`px-2.5 pb-2.5 pt-1.5 space-y-2 ${
                  dark ? "bg-slate-900/60" : "bg-slate-50/60"
                }`}>
                  {occupants.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {occupants.map((o) => (
                        <OccupantPill key={o.user_id ?? o.id ?? o.name} occupant={o} dark={dark} />
                      ))}
                    </div>
                  ) : (
                    <p className={`text-[11px] italic ${dark ? "text-slate-500" : "text-slate-400"}`}>
                      Nobody here yet.
                    </p>
                  )}
                  {!isCurrent && (
                    <button
                      type="button"
                      onClick={() => !busy && enterRoom(room)}
                      disabled={busy}
                      className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold py-1.5 rounded-md text-white transition-opacity disabled:opacity-40"
                      style={{ backgroundColor: "var(--color-accent)" }}
                    >
                      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      {occupants.length > 0 ? "Join room" : "Start session here"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <p className={`text-[11px] ${dark ? "text-red-400" : "text-red-600"}`}>{error}</p>
      )}
    </div>
  );
}

function AvatarStack({ occupants, dark, max = 3 }) {
  const shown = occupants.slice(0, max);
  const overflow = occupants.length - shown.length;
  return (
    <div className="flex -space-x-1.5">
      {shown.map((o) => {
        const initial = (o.name || "?")[0].toUpperCase();
        return o.avatar_url ? (
          <img
            key={o.user_id ?? o.id ?? o.name}
            src={o.avatar_url}
            alt=""
            className={`w-5 h-5 rounded-full ring-2 ${dark ? "ring-slate-900" : "ring-white"}`}
          />
        ) : (
          <span
            key={o.user_id ?? o.id ?? o.name}
            className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[9px] font-bold text-white ring-2 ${
              dark ? "ring-slate-900" : "ring-white"
            }`}
            style={{ backgroundColor: "var(--color-accent)" }}
            title={o.name}
          >
            {initial}
          </span>
        );
      })}
      {overflow > 0 && (
        <span
          className={`w-5 h-5 rounded-full inline-flex items-center justify-center text-[9px] font-semibold ring-2 ${
            dark ? "bg-slate-800 text-slate-300 ring-slate-900" : "bg-slate-200 text-slate-600 ring-white"
          }`}
          title={`+${overflow} more`}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

function OccupantPill({ occupant, dark }) {
  const initial = (occupant.name || "?")[0].toUpperCase();
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full pl-0.5 pr-2 py-0.5 text-[11px] ${
        dark ? "bg-slate-800 text-slate-200" : "bg-white text-slate-700 border border-slate-200"
      }`}
      title={occupant.name}
    >
      {occupant.avatar_url ? (
        <img src={occupant.avatar_url} alt="" className="w-4 h-4 rounded-full" />
      ) : (
        <span
          className="w-4 h-4 rounded-full inline-flex items-center justify-center text-[8px] font-bold text-white"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          {initial}
        </span>
      )}
      <span className="truncate max-w-[120px]">{occupant.name || "—"}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Time tracking page
// ────────────────────────────────────────────────────────────────────
function TimePage({ dark }) {
  const {
    clockIn, clockedElapsed, currentTask, switchTask, handleClockIn, handleClockOut,
    projects, entries, updateClockIn,
  } = useApp();
  const [draft, setDraft] = useState(currentTask?.description || "");
  const [busy, setBusy] = useState(false);
  const lastTaskIdRef = useRef(currentTask?.id);

  useEffect(() => {
    if (currentTask?.id !== lastTaskIdRef.current) {
      setDraft(currentTask?.description || "");
      lastTaskIdRef.current = currentTask?.id;
    }
  }, [currentTask?.id, currentTask?.description]);

  // Today's logged total + the live elapsed on the active clock-in, so
  // users can answer "how much have I worked today" without leaving the
  // popover. todayMinutes sums the closed entries' (end-start) for the
  // current local date.
  const today = useMemo(() => new Date().toLocaleDateString("en-CA"), []);
  const todayMinutes = useMemo(() => {
    let total = 0;
    for (const e of entries || []) {
      if (e.date !== today || !e.start || !e.end) continue;
      const [sh, sm] = e.start.split(":").map(Number);
      const [eh, em] = e.end.split(":").map(Number);
      total += Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
    }
    return total;
  }, [entries, today]);
  function formatTodayTotal(mins) {
    const liveMins = clockIn ? minutesFromClockedElapsed(clockedElapsed()) : 0;
    const total = mins + liveMins;
    if (total === 0) return "0m";
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  // Recent task descriptions (dedup'd) from today's entries — quick
  // way to resume yesterday's "Fix the auth bug" type work without
  // retyping. Cap at 5 chips.
  const recentTasks = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const e of (entries || []).slice().reverse()) {
      const d = (e.description || "").trim();
      if (!d || seen.has(d.toLowerCase())) continue;
      seen.add(d.toLowerCase());
      out.push({ description: d, projectIds: e.projectIds || [] });
      if (out.length >= 5) break;
    }
    return out;
  }, [entries]);

  async function commitTask() {
    const trimmed = draft.trim();
    if (!clockIn || !trimmed || trimmed === (currentTask?.description || "")) return;
    setBusy(true);
    await switchTask(trimmed);
    setBusy(false);
  }
  async function onToggle() {
    setBusy(true);
    if (clockIn) handleClockOut();
    else handleClockIn(undefined, draft.trim() || undefined);
    setBusy(false);
  }
  function pickRecent(task) {
    setDraft(task.description);
    if (clockIn) {
      switchTask(task.description);
      if (task.projectIds?.length) updateClockIn?.({ projectIds: task.projectIds });
    }
  }
  function setProject(projectId) {
    if (!clockIn) return;
    updateClockIn?.({ projectIds: projectId ? [projectId] : [] });
  }
  const activeProjectId = clockIn?.projectIds?.[0] || "";

  return (
    <div className="space-y-3">
      {/* Top stats row: today's total + live elapsed when clocked in */}
      <div
        className={`grid grid-cols-2 gap-2 rounded-md border p-2.5 ${
          dark ? "border-slate-800 bg-slate-900/40" : "border-slate-100 bg-slate-50"
        }`}
      >
        <div>
          <div className={`text-[10px] font-semibold uppercase tracking-wider ${
            dark ? "text-slate-500" : "text-slate-400"
          }`}>Today</div>
          <div
            className="text-2xl font-display font-semibold tabular-nums leading-tight"
            style={{ color: dark ? "#f1f5f9" : "#0f172a" }}
          >
            {formatTodayTotal(todayMinutes)}
          </div>
        </div>
        <div>
          <div className={`text-[10px] font-semibold uppercase tracking-wider ${
            dark ? "text-slate-500" : "text-slate-400"
          }`}>
            <Clock className="inline w-3 h-3 mr-0.5 -mt-px" />
            {clockIn ? "Tracking" : "Idle"}
          </div>
          <div
            className="text-2xl font-display font-semibold tabular-nums leading-tight"
            style={{ color: clockIn ? "var(--color-accent)" : dark ? "#475569" : "#94a3b8" }}
          >
            {clockIn ? clockedElapsed() : "—"}
          </div>
        </div>
      </div>

      {/* Task input + project picker side-by-side */}
      <div className="flex items-stretch gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitTask}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.currentTarget.blur(); if (!clockIn) onToggle(); }
          }}
          placeholder={clockIn ? "What are you working on?" : "Task name (optional)"}
          className={`flex-1 min-w-0 text-sm px-3 py-2 rounded-md outline-none border transition-colors ${
            dark
              ? "bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-[var(--color-accent)]"
              : "bg-slate-50 border-slate-200 text-slate-800 placeholder:text-slate-400 focus:border-[var(--color-accent)] focus:bg-white"
          }`}
        />
        {(projects || []).length > 0 && (
          <select
            value={activeProjectId}
            onChange={(e) => setProject(e.target.value)}
            disabled={!clockIn}
            className={`text-xs font-medium rounded-md px-2 py-1 outline-none border transition-colors max-w-[110px] disabled:opacity-50 ${
              dark
                ? "bg-slate-800/60 border-slate-700 text-slate-200"
                : "bg-slate-50 border-slate-200 text-slate-700"
            }`}
            title={clockIn ? "Project" : "Start tracking to set a project"}
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Recent tasks (today) for quick resume */}
      {recentTasks.length > 0 && (
        <div className="space-y-1">
          <div className={`text-[10px] font-semibold uppercase tracking-wider ${
            dark ? "text-slate-500" : "text-slate-400"
          }`}>Recent</div>
          <div className="flex flex-wrap gap-1.5">
            {recentTasks.map((t) => (
              <button
                key={t.description}
                type="button"
                onClick={() => pickRecent(t)}
                className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                  dark
                    ? "border-slate-700 text-slate-300 hover:bg-slate-800/60"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
                title={t.description}
              >
                <span className="max-w-[180px] truncate inline-block align-bottom">{t.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        className={`w-full inline-flex items-center justify-center gap-1.5 text-sm font-semibold py-2 rounded-md transition-opacity disabled:opacity-40 ${
          clockIn
            ? dark ? "bg-red-500/15 text-red-300 hover:bg-red-500/25" : "bg-red-50 text-red-600 hover:bg-red-100"
            : "text-white"
        }`}
        style={!clockIn ? { backgroundColor: "var(--color-accent)" } : undefined}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : clockIn ? <LogOutIcon className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        {clockIn ? "Stop tracking" : "Start tracking"}
      </button>
    </div>
  );
}

// "1h 23m" → 83. Defensive — returns 0 if the format ever changes.
function minutesFromClockedElapsed(str) {
  if (!str) return 0;
  let m = 0;
  const h = /(\d+)h/.exec(str);
  const min = /(\d+)m/.exec(str);
  if (h) m += parseInt(h[1], 10) * 60;
  if (min) m += parseInt(min[1], 10);
  return m;
}

// ────────────────────────────────────────────────────────────────────
// Shared status block — also rendered on the Pomodoro tab
// ────────────────────────────────────────────────────────────────────
const PRESENCE_OPTIONS = [
  { value: "online", label: "Online" },
  { value: "focusing", label: "Focusing" },
  { value: "meeting", label: "In a meeting" },
  { value: "lunch", label: "On lunch" },
  { value: "commuting", label: "Commuting" },
];

// Unified with the nav StatusChip: writes the manual OVERRIDE (applyStatusOverride)
// so it propagates everywhere and the resolver's mirror can't overwrite it.
function StatusBlock({ dark }) {
  const { session, updateStatus } = useApp();
  const { syncSession, setStatus } = useSyncSession();
  const { resolved } = useResolvedSelf();
  const userId = session?.user?.id;

  const availability = resolved?.availability || "offline";
  const overridden = !!resolved?.override;
  const message = resolved?.override?.message || "";
  const [draft, setDraft] = useState(message);
  useEffect(() => setDraft(message), [message]);

  const write = (avail) =>
    applyStatusOverride({ availability: avail, message: draft.trim() || null, userId, syncSession, updateStatus, setStatus });
  function commitStatus() {
    if (draft.trim() === message.trim()) return;
    write(overridden ? availability : "online");
  }
  const pickPresence = (next) => write(next);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${
          dark ? "text-slate-500" : "text-slate-400"
        }`}>
          <MessageSquare className="inline w-3 h-3 mr-1 -mt-px" />
          Status
        </span>
        <div className="relative inline-flex items-center gap-1.5">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${availabilityDot(availability)}`} />
          <select
            value={PRESENCE_OPTIONS.some((o) => o.value === availability) ? availability : "online"}
            onChange={(e) => pickPresence(e.target.value)}
            className={`text-[11px] font-medium rounded-md px-1 py-0.5 outline-none border ${
              dark
                ? "bg-slate-800 border-slate-700 text-slate-200"
                : "bg-white border-slate-200 text-slate-700"
            }`}
          >
            {PRESENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitStatus}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        placeholder="What are you up to?"
        className={`w-full text-sm px-3 py-2 rounded-md outline-none border transition-colors ${
          dark
            ? "bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-[var(--color-accent)]"
            : "bg-slate-50 border-slate-200 text-slate-800 placeholder:text-slate-400 focus:border-[var(--color-accent)] focus:bg-white"
        }`}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
function modeLabel(mode) {
  if (mode === "work") return "Focus";
  if (mode === "shortBreak") return "Short break";
  if (mode === "longBreak") return "Long break";
  return "Pomodoro";
}
// Mirrors the chip in PomodoroTimer — ticks once a second off
// syncSession.expires_at; at zero each connected client races to call
// the server-side sweeper (idempotent) so the room cleans up the moment
// time runs out.
function MeetingCountdownChip({ expiresAt, sessionId, dark }) {
  const [now, setNow] = useState(() => Date.now());
  const sweptRef = useRef(false);

  useEffect(() => { sweptRef.current = false; }, [sessionId, expiresAt]);
  useVisibilityPausedInterval(() => setNow(Date.now()), 1000);

  const end = expiresAt ? new Date(expiresAt).getTime() : NaN;
  const remaining = Number.isFinite(end) ? Math.max(0, Math.ceil((end - now) / 1000)) : null;

  // Sweep in an effect; PostgrestBuilder is thenable, not a Promise,
  // so `.catch` chained on `supabase.rpc(...)` blows up.
  useEffect(() => {
    if (remaining !== 0 || sweptRef.current) return;
    sweptRef.current = true;
    (async () => {
      try { await supabase.rpc("sweep_expired_sync_sessions"); } catch { /* */ }
    })();
  }, [remaining]);

  if (remaining == null) return null;

  const hh = Math.floor(remaining / 3600);
  const mm = Math.floor((remaining % 3600) / 60);
  const ss = remaining % 60;
  const label = hh > 0
    ? `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
    : `${mm}:${String(ss).padStart(2, "0")}`;

  const urgent = remaining > 0 && remaining <= 60;
  const ended = remaining === 0;
  const cls = ended
    ? (dark ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-600")
    : urgent
      ? (dark ? "bg-amber-500/15 text-amber-300" : "bg-amber-50 text-amber-700")
      : (dark ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600");

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${cls}`}
      title={ended ? "Room closing…" : "Time left before the room closes"}
    >
      <Clock className="w-3 h-3 opacity-80" />
      {ended ? "Closing…" : label}
    </span>
  );
}

// Keep silenced lint for unused icons we still reference in future iterations.
void Square;
