import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useTheme } from "../context/ThemeContext";
import { supabase } from "../supabase";
import { formatDuration } from "../lib/utils";
import { Sun, Moon, LogOut, Loader2, Timer, Users, Settings as SettingsIcon, Menu, X } from "lucide-react";
import UserAvatar from "./UserAvatar";

const PRESENCE_DOT_COLOR = {
  active: "bg-emerald-500",
  available: "bg-sky-500",
  heads_down: "bg-violet-500",
  in_meeting: "bg-rose-500",
  away: "bg-amber-500",
};

export default function Nav({ onOpenPomodoro }) {
  const { settings, todayMins, exportMsg, dataSyncing, openSettings } = useApp();
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

  const desktopNavLink = ({ isActive }) =>
    `px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
      isActive
        ? darkMode
          ? "bg-cyan-500/15 text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.3)]"
          : "bg-teal-50 text-teal-600"
        : darkMode
          ? "text-slate-400 hover:text-slate-300 hover:bg-slate-800/50"
          : "text-slate-600 hover:text-slate-800 hover:bg-slate-100"
    }`;

  const sidebarNavLink = ({ isActive }) =>
    `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${
      isActive
        ? darkMode
          ? "bg-cyan-500/15 text-cyan-400"
          : "bg-teal-50 text-teal-600"
        : darkMode
          ? "text-slate-300 hover:text-slate-100 hover:bg-slate-800/60"
          : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
    }`;

  const themeBtnCls = `p-2 rounded-lg transition-all ${
    darkMode
      ? "bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/20"
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
            ? "bg-slate-900/40 backdrop-blur-2xl border-cyan-500/10 shadow-[0_4px_24px_rgba(6,182,212,0.1)]"
            : "bg-white/60 backdrop-blur-xl border-blue-200/50 shadow-sm"
        }`}
      >
        {dataSyncing && (
          <div
            role="status"
            aria-live="polite"
            className={`flex items-center justify-center gap-2 px-4 py-1.5 text-[11px] font-medium border-b ${
              darkMode
                ? "border-cyan-500/15 bg-cyan-500/5 text-cyan-300/95"
                : "border-teal-200/60 bg-teal-50/80 text-teal-900"
            }`}
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
              darkMode ? "text-slate-300 hover:bg-slate-800/50" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Logo + title */}
          <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
            <div className="relative shrink-0">
              {settings.avatarUrl ? (
                <UserAvatar url={settings.avatarUrl} name={settings.name} size={32} />
              ) : (
                <img
                  src="/logo.svg"
                  alt="Mangodoro"
                  className={`h-6 sm:h-8 ${darkMode ? "brightness-0 invert" : ""}`}
                />
              )}
              {settings.avatarUrl && (
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ${presenceDot} ${
                    darkMode ? "ring-slate-900" : "ring-white"
                  }`}
                  title={`Status: ${settings.presenceState || "active"}${settings.status ? ` — ${settings.status}` : ""}`}
                />
              )}
            </div>
            <div className="min-w-0">
              <h1
                className={`text-xs sm:text-sm font-semibold truncate ${darkMode ? "text-white" : "text-slate-800"}`}
              >
                {settings.name ? `${settings.name}'s Mangodoro` : "Mangodoro"}
              </h1>
              <p
                className={`text-[11px] sm:text-xs font-mono tracking-tight truncate ${darkMode ? "text-slate-500" : "text-slate-500"}`}
              >
                {todayMins > 0
                  ? `Today · ${formatDuration(todayMins)}`
                  : "No hours logged today"}
              </p>
            </div>
          </div>

          {/* Desktop: full nav + actions */}
          <div className="hidden sm:flex items-center gap-4">
            <nav className="flex items-center gap-1">
              <NavLink to="/pomodoro" className={desktopNavLink}>
                Pomodoro
                {hasTeamSessions && (
                  <span className={`ml-1.5 inline-block w-1.5 h-1.5 rounded-full ${darkMode ? "bg-cyan-400" : "bg-teal-500"} animate-pulse align-middle`} />
                )}
              </NavLink>
              <NavLink to="/log" className={desktopNavLink}>Log</NavLink>
              <NavLink to="/overview" className={desktopNavLink}>Overview</NavLink>
              <NavLink to="/planner" className={desktopNavLink}>Planner</NavLink>
              <NavLink to="/team" className={desktopNavLink}>Team</NavLink>
            </nav>

            <div className="flex items-center gap-2">
              <button
                onClick={onOpenPomodoro}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  darkMode
                    ? "text-slate-400 hover:text-slate-300 hover:bg-slate-800/50"
                    : "text-slate-600 hover:text-slate-800 hover:bg-slate-100"
                }`}
                title={hasTeamSessions ? "Pomodoro — a teammate has a session running" : "Pomodoro timer"}
              >
                <Timer className="w-4 h-4" />
                <span>Timer</span>
                {hasTeamSessions && (
                  <span className={`absolute top-1 right-1.5 w-2 h-2 rounded-full ${darkMode ? "bg-cyan-400" : "bg-teal-500"} animate-pulse`} />
                )}
              </button>

              <button onClick={toggleTheme} className={themeBtnCls} title={darkMode ? "Light mode" : "Dark mode"}>
                {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>

              <button
                onClick={openSettings}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                  darkMode
                    ? "bg-gradient-to-r from-cyan-500 to-teal-500 text-white shadow-lg shadow-cyan-500/30 hover:shadow-cyan-500/50"
                    : "bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-lg shadow-teal-500/30"
                }`}
              >
                Settings
              </button>

              <button
                onClick={() => supabase.auth.signOut()}
                title="Sign out"
                className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  darkMode
                    ? "text-slate-400 hover:text-slate-300 hover:bg-slate-800/50"
                    : "text-slate-600 hover:text-slate-800 hover:bg-slate-100"
                }`}
              >
                <LogOut className="w-4 h-4" />
                <span>Sign out</span>
              </button>
            </div>
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
            ? "bg-slate-900 border-r border-slate-700/60"
            : "bg-white border-r border-slate-200"
        }`}
        aria-hidden={!sidebarOpen}
      >
        <div className={`flex items-center justify-between px-4 py-3 border-b ${
          darkMode ? "border-slate-700/60" : "border-slate-200"
        }`}>
          <div className="flex items-center gap-2 min-w-0">
            {settings.avatarUrl ? (
              <UserAvatar url={settings.avatarUrl} name={settings.name} size={28} className="shrink-0" />
            ) : (
              <img
                src="/logo.svg"
                alt="Mangodoro"
                className={`h-6 shrink-0 ${darkMode ? "brightness-0 invert" : ""}`}
              />
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
              darkMode ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          <NavLink to="/pomodoro" className={sidebarNavLink}>
            <Timer className="w-5 h-5" /> Pomodoro
            {hasTeamSessions && (
              <span className={`ml-auto w-2 h-2 rounded-full ${darkMode ? "bg-cyan-400" : "bg-teal-500"} animate-pulse`} />
            )}
          </NavLink>
          <NavLink to="/log" className={sidebarNavLink}>
            <span className="w-5 text-center">📋</span> Log
          </NavLink>
          <NavLink to="/overview" className={sidebarNavLink}>
            <span className="w-5 text-center">📊</span> Overview
          </NavLink>
          <NavLink to="/planner" className={sidebarNavLink}>
            <span className="w-5 text-center">🗓️</span> Planner
          </NavLink>
          <NavLink to="/team" className={sidebarNavLink}>
            <Users className="w-5 h-5" /> Team
          </NavLink>

          <div className={`my-3 border-t ${darkMode ? "border-slate-800" : "border-slate-100"}`} />

          <button
            type="button"
            onClick={() => { setSidebarOpen(false); onOpenPomodoro?.(); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${
              darkMode
                ? "text-slate-300 hover:text-slate-100 hover:bg-slate-800/60"
                : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <Timer className="w-5 h-5" /> Quick timer
          </button>

          <button
            type="button"
            onClick={() => { setSidebarOpen(false); openSettings?.(); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${
              darkMode
                ? "text-slate-300 hover:text-slate-100 hover:bg-slate-800/60"
                : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            <SettingsIcon className="w-5 h-5" /> Settings
          </button>

          <button
            type="button"
            onClick={() => { toggleTheme(); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-semibold transition-all ${
              darkMode
                ? "text-slate-300 hover:text-slate-100 hover:bg-slate-800/60"
                : "text-slate-700 hover:text-slate-900 hover:bg-slate-100"
            }`}
          >
            {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            {darkMode ? "Light mode" : "Dark mode"}
          </button>
        </nav>

        <div className={`px-3 py-3 border-t ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
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
              ? "border-slate-600 bg-slate-800 text-slate-100 shadow-black/40"
              : "border-slate-200 bg-white text-slate-900 shadow-slate-900/10"
          }`}
        >
          {exportMsg}
        </div>
      ) : null}
    </>
  );
}
