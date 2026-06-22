import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { applyAccent } from "../lib/accent";
import { LocalPomodoroProvider } from "../pomodoro/LocalPomodoroProvider";
import ModePicker from "../components/pomodoro/ModePicker";
import TimerClock from "../components/pomodoro/TimerClock";
import TimerControls from "../components/pomodoro/TimerControls";
import SessionDots from "../components/pomodoro/SessionDots";
import LogoMark from "../components/LogoMark";

// Public, no-account timer (App.jsx mounts it at /timer, outside the authed
// provider stack). No org, no sync, no Supabase — just the shared timer
// components driven by LocalPomodoroProvider. Because there's no AppProvider
// to own theming here, we set the .dark class and accent palette ourselves.
export default function LocalTimerPage() {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    applyAccent("teal", dark);
  }, [dark]);

  // On leave, drop the dark class we set so it doesn't bleed onto the
  // (light-only) AuthPage; the authed app's AppLayout re-applies it on mount.
  useEffect(() => () => document.documentElement.classList.remove("dark"), []);

  return (
    <LocalPomodoroProvider>
      <main
        className={`min-h-[100dvh] flex flex-col bg-[var(--color-bg)] ${
          dark ? "text-slate-100" : "text-slate-800"
        }`}
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        {/* Top bar — brand + log-in + theme toggle. ql-drag-region makes this
            strip the Electron window-drag handle (there's no global Nav here);
            its interactive children opt back out via index.css. */}
        <header className="ql-drag-region w-full shrink-0">
          <div className="max-w-2xl mx-auto px-5 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-flex text-[var(--color-accent)]" aria-hidden>
                <LogoMark size={26} />
              </span>
              <span className="font-bold tracking-tight" style={{ fontFamily: "'Parkinsans', sans-serif" }}>
                Mangodoro
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Link
                to="/login"
                className="px-3.5 py-1.5 rounded-full text-sm font-semibold border border-[var(--color-accent-border)] text-[var(--color-accent)] hover:bg-[var(--color-accent-light)] transition-colors"
              >
                Log in
              </Link>
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
                className={`p-2 rounded-lg transition-colors ${
                  dark ? "text-slate-400 hover:bg-[var(--color-surface-raised)]" : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </header>

        {/* Timer card — the same shared components the app uses */}
        <div className="flex-1 flex items-center justify-center px-4 pb-10">
          <div
            className={`w-full max-w-md rounded-3xl border p-6 sm:p-8 ${
              dark
                ? "border-[var(--color-border)] bg-[var(--color-surface)]"
                : "border-slate-200 bg-white shadow-sm"
            }`}
          >
            <ModePicker />
            <div className="mt-7 flex flex-col items-center gap-3">
              <TimerClock size="lg" slot="numbers" />
              <TimerClock size="sm" slot="label" />
              <SessionDots align="center" />
              <div className="mt-3">
                <TimerControls size="lg" />
              </div>
            </div>
          </div>
        </div>

        {/* Footer — what this is + what logging in unlocks */}
        <footer className="w-full max-w-md mx-auto px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] text-center shrink-0">
          <p className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>
            Runs offline and stays on this device.{" "}
            <Link to="/login" className="font-semibold text-[var(--color-accent)] hover:underline">
              Log in
            </Link>{" "}
            for team sync, time tracking, and the full app.
          </p>
        </footer>
      </main>
    </LocalPomodoroProvider>
  );
}
