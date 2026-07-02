import { useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useTheme } from "../../context/ThemeContext";
import { useTour } from "../../context/TourContext";

const SEEN_KEY = "ql_welcome_seen"; // per-device belt to avoid a flash before the server write lands

// First-run orientation, shown ONCE right after a new user finishes the
// OnboardingModal (name set) — it doesn't duplicate that modal's fields, it just
// orients + offers a quick tour. Existing users (already named, predating this
// feature) are seeded to welcomeDone SILENTLY so they never see it. Mirrors the
// WhatsNew first-run-seed approach.
export default function WelcomeFlow() {
  const { settings, session, dataLoaded, setWelcomeDone } = useApp();
  const { theme } = useTheme();
  const { startTour } = useTour();
  const dark = theme === "dark";
  const name = settings?.name || "";
  const welcomeDone = settings?.onboarding?.welcomeDone;
  const [show, setShow] = useState(false);
  const hydratedRef = useRef(false);
  const seededLegacyRef = useRef(false);

  // Once settings have hydrated: if the user is ALREADY named but has no
  // welcomeDone flag, they predate onboarding → mark done silently (no modal).
  useEffect(() => {
    if (!dataLoaded || hydratedRef.current) return;
    hydratedRef.current = true;
    if (name && welcomeDone == null) {
      seededLegacyRef.current = true;
      setWelcomeDone();
    }
  }, [dataLoaded, name, welcomeDone, setWelcomeDone]);

  // After hydration, a genuinely new user who just set their name (and hasn't
  // completed the welcome) gets it once.
  useEffect(() => {
    if (!hydratedRef.current || !session?.user?.id) return;
    if (seededLegacyRef.current) return;
    if (!name || welcomeDone === true) return;
    let seenLocal = false;
    try { seenLocal = localStorage.getItem(SEEN_KEY) === "1"; } catch { /* */ }
    if (!seenLocal) setShow(true);
  }, [name, welcomeDone, session?.user?.id]);

  function finish() {
    try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* */ }
    setWelcomeDone();
    setShow(false);
  }

  if (!show) return null;

  const firstName = name.split(" ")[0] || "there";
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={finish} />
      <div
        className={`relative w-full max-w-md rounded-2xl border shadow-2xl p-6 ${
          dark ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-100" : "bg-white border-slate-200 text-slate-800"
        }`}
      >
        <button
          type="button"
          onClick={finish}
          aria-label="Close"
          className={`absolute top-3 right-3 p-1.5 rounded-lg ${dark ? "text-slate-400 hover:text-white hover:bg-white/10" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"}`}
        >
          <X className="w-4 h-4" />
        </button>
        <div className="w-11 h-11 rounded-xl bg-[var(--color-accent)] text-white flex items-center justify-center mb-4">
          <Sparkles className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold mb-1.5">Welcome, {firstName}! 👋</h2>
        <p className={`text-sm leading-relaxed ${dark ? "text-slate-300" : "text-slate-600"}`}>
          Mangodoro is your team's focus space — run pomodoro sessions, drop into
          rooms with video, and keep goals and messages in one place. Want a quick
          tour, or would you rather explore on your own?
        </p>
        <div className="mt-5 flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            onClick={finish}
            className={`px-4 py-2 rounded-lg text-sm font-semibold ${dark ? "bg-white/5 hover:bg-white/10 text-slate-200" : "bg-slate-100 hover:bg-slate-200 text-slate-700"}`}
          >
            I'll explore
          </button>
          <button
            type="button"
            onClick={() => { finish(); startTour?.("meet-pomodoro"); }}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white"
          >
            Take a quick tour
          </button>
        </div>
      </div>
    </div>
  );
}
