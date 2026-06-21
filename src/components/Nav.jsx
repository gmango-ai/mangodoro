import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useTheme } from "../context/ThemeContext";
import { supabase } from "../supabase";
import { formatDuration } from "../lib/utils";
import { Sun, Moon, LogOut, Loader2, Timer, Users, Building2, Settings as SettingsIcon, Menu, X, ChevronDown } from "lucide-react";
import UserAvatar from "./UserAvatar";
import LogoMark from "./LogoMark";
import OrgSwitcher from "./OrgSwitcher";
import RunningTimerPill from "./RunningTimerPill";

const PRESENCE_DOT_COLOR = {
  active: "bg-emerald-500",
  available: "bg-sky-500",
  heads_down: "bg-violet-500",
  in_meeting: "bg-rose-500",
  away: "bg-amber-500",
};

export default function Nav({ onOpenPomodoro }) {
  const { settings, todayMins, exportMsg, dataSyncing, session } = useApp();
  const { activeTeamSessions } = useTeam();
  const hasTeamSessions = (activeTeamSessions?.length || 0) > 0;
  const presenceDot = PRESENCE_DOT_COLOR[settings.presenceState] || PRESENCE_DOT_COLOR.active;
  const { theme, toggleTheme } = useTheme();
  const darkMode = theme === "dark";
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Close on Escape
  useEffect(() => {
    if (!sidebarOpen) return;
    function onKey(e) { if (e.key === "Escape") setSidebarOpen(false); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  // Lock body scroll while sidebar is open
  useEffect(() => {
    if (!sidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [sidebarOpen]);

  // Active nav state uses the user's accent color via CSS variables —
  // applies in both light and dark themes because applyAccent overrides
  // them per-theme on the document root.
  const desktopNavLink = ({ isActive }) =>
    `px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
      isActive
        ? "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
        : darkMode
          ? "text-slate-400 hover:text-slate-300 hover:bg-[var(--color-surface-raised)]"
          : "text-slate-600 hover:text-slate-800 hover:bg-slate-100"
    }`;

  const sidebarNavLink = ({ isActive }) =>
    `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${
      isActive
        ? "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
        : darkMode
          ? "text-slate-300 hover:text-slate-100 hover:bg-[var(--color-surface-raised)]"
          : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
    }`;

  const themeBtnCls = `p-2 rounded-lg transition-all ${
    darkMode
      ? "border bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-300 hover:bg-[var(--color-bg)]"
      : "bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200"
  }`;

  function signOut() {
    setSidebarOpen(false);
    supabase.auth.signOut();
  }

  return (
    <>
      <header
        className={`sticky top-0 z-50 border-b transition-all ${
          darkMode
            ? "bg-[var(--color-bg)] backdrop-blur-2xl border-[var(--color-accent-border)]"
            : "bg-white/60 backdrop-blur-xl border-[var(--color-accent-border)] shadow-sm"
        }`}
        style={{
          paddingTop: "env(safe-area-inset-top)",
          ...(darkMode
            ? { boxShadow: "0 4px 24px color-mix(in srgb, var(--color-accent) 12%, transparent)" }
            : {}),
        }}
      >
        {dataSyncing && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-center gap-2 px-4 py-1.5 text-[11px] font-medium border-b border-[var(--color-accent-border)] bg-[var(--color-accent-light)] text-[var(--color-accent)]"
          >
            <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin opacity-90" aria-hidden />
            Syncing your data…
          </div>
        )}

        <div className="max-w-4xl mx-auto px-3 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-3">
          {/* Mobile: hamburger */}
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className={`sm:hidden p-2 -ml-2 rounded-lg ${
              darkMode ? "text-slate-300 hover:bg-[var(--color-surface-raised)]" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Brand — logo + wordmark, always visible. The user's
              avatar moved to the right of the bar so the product name
              isn't pushed offscreen by a long name. */}
          <NavLink to="/pomodoro" className="flex items-center gap-2 shrink-0">
            <span
              className="inline-flex text-[var(--color-accent)]"
              aria-hidden
            >
              <LogoMark size={28} />
            </span>
            <span
              className={`text-base sm:text-lg font-bold tracking-tight ${
                darkMode ? "text-white" : "text-slate-800"
              }`}
              style={{ fontFamily: "'Parkinsans', sans-serif" }}
            >
              Mangodoro
            </span>
          </NavLink>

          {/* Desktop: full nav + actions */}
          <div className="hidden sm:flex items-center gap-3">
            <nav className="flex items-center gap-1">
              <NavLink to="/pomodoro" className={desktopNavLink}>
                Pomodoro
                {hasTeamSessions && (
                  <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse align-middle" />
                )}
              </NavLink>
              <NavLink to="/office" className={desktopNavLink}>Office</NavLink>
              <NavLink to="/time-tracker" className={desktopNavLink}>Time tracker</NavLink>
              <NavLink to="/whiteboards" className={desktopNavLink}>Whiteboards</NavLink>
              <NavLink to="/team" className={desktopNavLink}>Org</NavLink>
            </nav>

            {/* Always-visible timer pill — surfaces the live pomodoro
                state right in the Nav. Replaces the floating bottom-
                right FAB so the indicator is a Nav citizen and doesn't
                cover content. */}
            <RunningTimerPill onOpen={onOpenPomodoro} />

            {/* Single user-menu dropdown on the right — replaces the
                previous strip of Timer / chip / theme / Settings / Sign
                out buttons. The avatar is the primary handle; everything
                else lives inside. */}
            <UserMenu
              dark={darkMode}
              settings={settings}
              todayMins={todayMins}
              hasTeamSessions={hasTeamSessions}
              presenceDot={presenceDot}
              onToggleTheme={toggleTheme}
              session={session}
            />
          </div>
        </div>
      </header>

      {/* Mobile sidebar overlay + drawer */}
      {sidebarOpen && (
        <div
          className="sm:hidden fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`sm:hidden fixed top-0 left-0 z-[90] h-full w-72 max-w-[85vw] transform transition-transform duration-200 ease-out flex flex-col ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${
          darkMode
            ? "border-r bg-[var(--color-surface)] border-[var(--color-border)]"
            : "bg-white border-r border-slate-200"
        }`}
        // The drawer is pinned to the very top/bottom of the screen, so its
        // first/last rows would otherwise sit under the Dynamic Island and
        // the home indicator. Inset its content by the safe areas (the drawer
        // background still fills behind them).
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
        aria-hidden={!sidebarOpen}
      >
        <div className={`flex items-center justify-between px-4 py-3 border-b ${
          darkMode ? "border-[var(--color-border)]" : "border-slate-200"
        }`}>
          <div className="flex items-center gap-2 min-w-0">
            {settings.avatarUrl ? (
              <UserAvatar url={settings.avatarUrl} name={settings.name} size={28} className="shrink-0" />
            ) : (
              <span className="inline-flex shrink-0 text-[var(--color-accent)]" aria-label="Mangodoro">
                <LogoMark size={24} />
              </span>
            )}
            <span className={`text-sm font-semibold truncate ${darkMode ? "text-slate-100" : "text-slate-800"}`}>
              {settings.name ? `${settings.name}` : "Mangodoro"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
            className={`p-1.5 rounded-lg ${
              darkMode ? "text-slate-400 hover:bg-[var(--color-surface-raised)]" : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          {/* Mobile org switcher — visible in the sidebar so multi-org
              users have a single tap to switch without crossing into
              Team admin. Single-org users see nothing here. */}
          <div className="px-2 pb-2">
            <OrgSwitcher />
          </div>

          <NavLink to="/pomodoro" className={sidebarNavLink}>
            <Timer className="w-5 h-5" /> Pomodoro
            {hasTeamSessions && (
              <span className="ml-auto w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
            )}
          </NavLink>
          <NavLink to="/office" className={sidebarNavLink}>
            <Building2 className="w-5 h-5" /> Office
          </NavLink>
          <NavLink to="/time-tracker" className={sidebarNavLink}>
            <span className="w-5 text-center">📋</span> Time tracker
          </NavLink>
          <NavLink to="/whiteboards" className={sidebarNavLink}>
            <span className="w-5 text-center">🪧</span> Whiteboards
          </NavLink>
          <NavLink to="/team" className={sidebarNavLink}>
            <Users className="w-5 h-5" /> Org
          </NavLink>

          <div className={`my-3 border-t ${darkMode ? "border-[var(--color-border-light)]" : "border-slate-100"}`} />

          <button
            type="button"
            onClick={() => { setSidebarOpen(false); onOpenPomodoro?.(); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${
              darkMode
                ? "text-slate-300 hover:text-slate-100 hover:bg-[var(--color-surface-raised)]"
                : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <Timer className="w-5 h-5" /> Quick timer
          </button>

          <NavLink
            to="/settings"
            onClick={() => setSidebarOpen(false)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${
              darkMode
                ? "text-slate-300 hover:text-slate-100 hover:bg-[var(--color-surface-raised)]"
                : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <SettingsIcon className="w-5 h-5" /> Settings
          </NavLink>

          <button
            type="button"
            onClick={() => { toggleTheme(); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${
              darkMode
                ? "text-slate-300 hover:text-slate-100 hover:bg-[var(--color-surface-raised)]"
                : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            {darkMode ? "Light mode" : "Dark mode"}
          </button>
        </nav>

        <div className={`px-3 py-3 border-t ${darkMode ? "border-[var(--color-border-light)]" : "border-slate-100"}`}>
          <button
            type="button"
            onClick={signOut}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
              darkMode
                ? "text-slate-400 hover:text-red-300 hover:bg-red-500/10"
                : "text-slate-600 hover:text-red-600 hover:bg-red-50"
            }`}
          >
            <LogOut className="w-5 h-5" /> Sign out
          </button>
        </div>
      </aside>

      {exportMsg ? (
        <div
          role="status"
          className={`fixed bottom-5 left-1/2 z-[100] max-w-[min(92vw,28rem)] -translate-x-1/2 rounded-lg border px-4 py-2.5 text-sm shadow-lg ${
            darkMode
              ? "border-slate-600 bg-[var(--color-surface-raised)] text-slate-100 shadow-black/40"
              : "border-slate-200 bg-white text-slate-900 shadow-slate-900/10"
          }`}
        >
          {exportMsg}
        </div>
      ) : null}
    </>
  );
}

// Dropdown menu on the right of the top bar. Replaces the previous
// strip of independent buttons (timer / chip / theme / settings /
// sign out) with one click target — the avatar — that reveals the
// rest. Pattern matches Linear/Vercel/Notion: identity-as-handle.
function UserMenu({ dark, settings, todayMins, hasTeamSessions, presenceDot, onToggleTheme, session }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { teams, activeTeam, activeTeamId, switchTeam } = useTeam();

  useEffect(() => {
    if (!open) return;
    function down(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function key(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const email = session?.user?.email || "";
  const name = settings.name || email.split("@")[0] || "You";
  const otherTeams = (teams || []).filter((t) => t.id !== activeTeamId);
  const showOrgSection = (teams || []).length >= 2;

  const itemBase = `w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors`;
  const item = dark
    ? `${itemBase} text-slate-200 hover:bg-slate-700/70`
    : `${itemBase} text-slate-700 hover:bg-slate-100`;
  const destructive = dark
    ? `${itemBase} text-red-300 hover:bg-red-500/15`
    : `${itemBase} text-red-600 hover:bg-red-50`;

  return (
    <div ref={ref} className="hidden sm:block relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full transition-colors ${
          dark ? "hover:bg-[var(--color-surface-raised)]" : "hover:bg-slate-100"
        }`}
      >
        <span className="relative">
          <UserAvatar url={settings.avatarUrl} name={name} size={28} />
          <span
            className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ${presenceDot} ${
              dark ? "ring-slate-900" : "ring-white"
            }`}
            aria-hidden
          />
        </span>
        <ChevronDown className={`w-3.5 h-3.5 ${dark ? "text-slate-500" : "text-slate-400"}`} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute right-0 top-full mt-1.5 min-w-[240px] rounded-xl border shadow-lg overflow-hidden z-50 ${
            dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
          }`}
        >
          {/* Identity row */}
          <div className={`px-3 py-3 border-b ${dark ? "border-[var(--color-border)]" : "border-slate-200/70"}`}>
            <p className={`text-sm font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
              {name}
            </p>
            {email && (
              <p className={`text-[11px] truncate ${dark ? "text-slate-500" : "text-slate-400"}`}>
                {email}
              </p>
            )}
            <p className={`text-[11px] mt-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>
              {todayMins > 0 ? `Today · ${formatDuration(todayMins)}` : "No hours logged today"}
              {hasTeamSessions && (
                <span className="ml-2 inline-flex items-center gap-1 text-[var(--color-accent)]">
                  <Timer className="w-3 h-3 animate-pulse" />
                  session active
                </span>
              )}
            </p>
          </div>

          {/* Org switcher — current org + clickable list of the
              user's other orgs. Hidden when the user is only in one
              org (no switching to do). */}
          {showOrgSection && (
            <>
              <div className={`px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider ${
                dark ? "text-slate-500" : "text-slate-400"
              }`}>
                Org
              </div>
              <div className={`flex items-center gap-2 px-3 py-2 text-sm ${
                dark ? "text-slate-200" : "text-slate-700"
              }`}>
                <UserMenuTeamIcon team={activeTeam} size={20} />
                <span className="truncate font-semibold">{activeTeam?.name}</span>
                <span className={`ml-auto text-[10px] font-bold uppercase tracking-wider ${
                  dark ? "text-emerald-300" : "text-emerald-600"
                }`}>
                  Active
                </span>
              </div>
              {otherTeams.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="menuitem"
                  onClick={() => { switchTeam(t.id); setOpen(false); }}
                  className={item}
                >
                  <UserMenuTeamIcon team={t} size={20} />
                  <span className="truncate">{t.name}</span>
                </button>
              ))}
              <div className={`my-1 h-px ${dark ? "bg-slate-700/60" : "bg-slate-200"}`} />
            </>
          )}

          {/* Theme toggle */}
          <button
            type="button"
            role="menuitem"
            onClick={() => { onToggleTheme(); setOpen(false); }}
            className={item}
          >
            {dark ? <Sun className="w-4 h-4 opacity-70" /> : <Moon className="w-4 h-4 opacity-70" />}
            {dark ? "Switch to light" : "Switch to dark"}
          </button>

          {/* Settings */}
          <NavLink
            to="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={item}
          >
            <SettingsIcon className="w-4 h-4 opacity-70" />
            Settings
          </NavLink>

          <div className={`my-1 h-px ${dark ? "bg-slate-700/60" : "bg-slate-200"}`} />

          {/* Sign out */}
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); supabase.auth.signOut(); }}
            className={destructive}
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// Small team-icon helper used inside the UserMenu org switcher list.
// Mirrors the OrgSwitcher's TeamIcon — not extracted to a shared
// component because the OrgSwitcher one is internal to that file and
// the duplication is a few lines. Worth converging if a third caller
// appears.
function UserMenuTeamIcon({ team, size = 20 }) {
  const px = `${size}px`;
  const initial = (team?.name || "?")[0].toUpperCase();
  if (team?.icon_url) {
    return (
      <img
        src={team.icon_url}
        alt=""
        style={{ width: px, height: px }}
        className="rounded-md object-cover shrink-0"
      />
    );
  }
  return (
    <span
      style={{
        width: px,
        height: px,
        background: team?.color || "#14b8a6",
        fontSize: Math.max(10, Math.round(size / 2.4)),
      }}
      className="rounded-md flex items-center justify-center font-bold text-white shrink-0"
    >
      {initial}
    </span>
  );
}
