import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { GraduationCap, X, Check, Lock, Play } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useTour } from "../../context/TourContext";
import { TOUR_CATEGORIES } from "../../lib/tours/registry";

// Persistent "Learn Mangodoro" center — lists every tutorial by category, shows
// completion + prereq-locked state (with the reason), and replays any tour.
// Opened globally via a CustomEvent so a nav button / settings link can trigger
// it without prop-drilling (mirrors WhatsNew.openWhatsNew).

const EVENT = "mangodoro:help";
export function openHelpCenter() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT));
}

export default function HelpCenter() {
  const { theme } = useTheme();
  const { tours = [], tourStatus, startTour } = useTour();
  const [open, setOpen] = useState(false);
  const dark = theme === "dark";

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener(EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener(EVENT, onOpen); window.removeEventListener("keydown", onKey); };
  }, []);

  // Group into the ordered categories; only render categories that have tours.
  const grouped = useMemo(() => {
    return TOUR_CATEGORIES
      .map((c) => ({ ...c, items: tours.filter((t) => t.category === c.id) }))
      .filter((c) => c.items.length > 0);
  }, [tours]);

  if (!open) return null;

  // Close first so the tour overlay isn't behind this modal, then launch.
  const launch = (id) => { setOpen(false); setTimeout(() => startTour(id), 80); };

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div
        className={`relative w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border shadow-2xl ${
          dark ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-100" : "bg-white border-slate-200 text-slate-800"
        }`}
      >
        <div className={`flex items-center gap-3 px-5 py-4 border-b ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
          <span className="w-9 h-9 rounded-xl bg-[var(--color-accent)] text-white flex items-center justify-center">
            <GraduationCap className="w-5 h-5" />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold leading-tight">Learn Mangodoro</h2>
            <p className={`text-[12px] ${dark ? "text-slate-400" : "text-slate-500"}`}>Quick tutorials — replay any time.</p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className={`p-1.5 rounded-lg ${dark ? "text-slate-400 hover:text-white hover:bg-white/10" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-3 py-3 flex flex-col gap-4">
          {grouped.map((cat) => (
            <section key={cat.id}>
              <h3 className={`px-2 mb-1.5 text-[11px] font-semibold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>{cat.label}</h3>
              <ul className="flex flex-col gap-1">
                {cat.items.map((t) => {
                  const st = tourStatus(t.id);
                  return (
                    <li key={t.id}>
                      <div className={`flex items-center gap-3 px-2 py-2 rounded-xl ${dark ? "hover:bg-white/5" : "hover:bg-slate-50"}`}>
                        <span
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                            st.completed
                              ? "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
                              : st.locked
                                ? dark ? "bg-white/5 text-slate-500" : "bg-slate-100 text-slate-400"
                                : dark ? "bg-white/5 text-slate-300" : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {st.completed ? <Check className="w-4 h-4" /> : st.locked ? <Lock className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold leading-tight">{t.title}</p>
                          <p className={`text-[12px] leading-tight ${dark ? "text-slate-400" : "text-slate-500"}`}>
                            {st.locked ? st.reason : t.description}
                          </p>
                        </div>
                        {st.locked ? (
                          <span className={`text-[11px] font-semibold shrink-0 ${dark ? "text-slate-500" : "text-slate-400"}`}>Locked</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => launch(t.id)}
                            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold ${
                              dark ? "bg-white/10 hover:bg-white/20 text-slate-100" : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                            }`}
                          >
                            {st.completed ? "Replay" : "Start"}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
