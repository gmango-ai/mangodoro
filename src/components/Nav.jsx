import { NavLink } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import { supabase } from "../supabase";
import { formatDuration } from "../lib/utils";
import { Sun, Moon, LogOut, Loader2, Timer, Users } from "lucide-react";

export default function Nav({ onOpenPomodoro }) {
  const { settings, todayMins, exportMsg, dataSyncing, openSettings } = useApp();
  const { theme, toggleTheme } = useTheme();
  const darkMode = theme === "dark";

  const navLinkClass = ({ isActive }) =>
    `px-2 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
      isActive
        ? darkMode
          ? "bg-cyan-500/15 text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.3)]"
          : "bg-teal-50 text-teal-600"
        : darkMode
          ? "text-slate-400 hover:text-slate-300 hover:bg-slate-800/50"
          : "text-slate-600 hover:text-slate-800 hover:bg-slate-100"
    }`;

  const themeBtnCls = `p-2 rounded-lg transition-all ${
    darkMode
      ? "bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/20"
      : "bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200"
  }`;

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
      <div className="max-w-4xl mx-auto px-4 sm:px-6 h-auto sm:h-16 py-3 sm:py-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
        <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto">
          <img
            src="/logo.svg"
            alt="QuestLogger"
            className={`h-6 sm:h-8 ${darkMode ? "brightness-0 invert" : ""}`}
          />
          <div className="flex-1 sm:flex-none">
            <h1
              className={`text-xs sm:text-sm font-semibold ${darkMode ? "text-white" : "text-slate-800"}`}
            >
              {settings.name ? `${settings.name}'s Quest Log` : "QuestLogger"}
            </h1>
            <p
              className={`text-xs font-mono tracking-tight ${darkMode ? "text-slate-500" : "text-slate-500"}`}
            >
              {todayMins > 0
                ? `Today · ${formatDuration(todayMins)}`
                : "No hours logged today"}
            </p>
          </div>

          {/* Mobile Theme Toggle */}
          <button
            onClick={toggleTheme}
            className={`sm:hidden ${themeBtnCls}`}
            title={darkMode ? "Light mode" : "Dark mode"}
          >
            {darkMode ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
        </div>

        <div className="flex items-center w-full sm:w-auto justify-between sm:justify-end sm:gap-4">
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={navLinkClass}>
              Log
            </NavLink>
            <NavLink to="/overview" className={navLinkClass}>
              Overview
            </NavLink>
            <NavLink to="/planner" className={navLinkClass}>
              Planner
            </NavLink>
            <NavLink to="/team" className={navLinkClass}>
              <span className="sm:hidden"><Users className="w-4 h-4" /></span>
              <span className="hidden sm:inline">Team</span>
            </NavLink>
          </nav>

          <div className="flex items-center gap-2">
            {/* Pomodoro Timer */}
            <button
              onClick={onOpenPomodoro}
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                darkMode
                  ? "text-slate-400 hover:text-slate-300 hover:bg-slate-800/50"
                  : "text-slate-600 hover:text-slate-800 hover:bg-slate-100"
              }`}
              title="Pomodoro timer"
            >
              <Timer className="w-4 h-4" />
              <span>Pomodoro</span>
            </button>

            {/* Desktop Theme Toggle */}
            <button
              onClick={toggleTheme}
              className={`hidden sm:block ${themeBtnCls}`}
              title={darkMode ? "Light mode" : "Dark mode"}
            >
              {darkMode ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </button>

            <button
              onClick={openSettings}
              className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
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
              className={`flex items-center gap-1 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${
                darkMode
                  ? "text-slate-400 hover:text-slate-300 hover:bg-slate-800/50"
                  : "text-slate-600 hover:text-slate-800 hover:bg-slate-100"
              }`}
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </div>
    </header>
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
