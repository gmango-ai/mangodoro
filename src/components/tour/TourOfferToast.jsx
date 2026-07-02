import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { GraduationCap, X } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useTheme } from "../../context/ThemeContext";
import { useTour } from "../../context/TourContext";
import { toursForSurface } from "../../lib/tours/registry";

// Non-blocking "take a quick tour?" nudge. When the user lands on a surface a
// tour targets (a route, or a present element like the call layout button) and
// that tour is runnable + unseen + not already offered on this device, we offer
// it once. It never hijacks — the user picks Start or Not now (which dismisses
// the tour server-side so it won't re-nag, but leaves it replayable in Help).

const OFFERED_PREFIX = "ql_tour_autooffered:";
const wasOffered = (id) => { try { return localStorage.getItem(OFFERED_PREFIX + id) === "1"; } catch { return false; } };
const markOffered = (id) => { try { localStorage.setItem(OFFERED_PREFIX + id, "1"); } catch { /* */ } };

export default function TourOfferToast() {
  const { pathname } = useLocation();
  const { theme } = useTheme();
  const { dismissTour } = useApp();
  const { active, startTour, tourStatus, announcement, ackAnnouncement } = useTour();
  const dark = theme === "dark";
  const [offer, setOffer] = useState(null);
  const offerRef = useRef(null);

  useEffect(() => {
    if (active) { offerRef.current = null; setOffer(null); return undefined; }
    let cancelled = false;
    const evaluate = () => {
      if (cancelled || offerRef.current) return;
      for (const t of toursForSurface(pathname)) {
        if (wasOffered(t.id)) continue;
        const st = tourStatus(t.id);
        if (st.completed || st.dismissed || st.locked) continue;
        markOffered(t.id);
        offerRef.current = t;
        setOffer(t);
        return;
      }
    };
    // Element-triggered tours (in-call / green room) share a route with the
    // hallway, so poll briefly in addition to the initial + route-change check.
    evaluate();
    const iv = setInterval(evaluate, 1500);
    return () => { cancelled = true; clearInterval(iv); };
  }, [pathname, active, tourStatus]);

  const close = () => { offerRef.current = null; setOffer(null); };
  if (active) return null;

  // A "new feature" announcement (whole app, WhatsNew-style) takes priority over
  // a surface-specific offer; both render the same toast.
  const item = announcement || offer;
  if (!item) return null;
  const isNew = !!announcement;

  const onStart = () => {
    const id = item.id;
    if (isNew) ackAnnouncement(); else close();
    startTour(id);
  };
  const onDismiss = () => {
    if (isNew) ackAnnouncement();
    else { dismissTour(item.id); close(); }
  };

  return (
    <div className="fixed left-1/2 -translate-x-1/2 z-[150] bottom-[calc(5rem+env(safe-area-inset-bottom))] xl:bottom-6 w-[min(94vw,26rem)]">
      <div
        className={`flex items-center gap-3 rounded-2xl border shadow-xl px-4 py-3 ${
          dark ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-100" : "bg-white border-slate-200 text-slate-800"
        }`}
      >
        <span className="w-8 h-8 rounded-lg bg-[var(--color-accent)] text-white flex items-center justify-center shrink-0">
          <GraduationCap className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight truncate">
            {isNew && <span className="mr-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-accent)]">New</span>}
            {item.title}
          </p>
          <p className={`text-[12px] leading-tight truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>{item.description}</p>
        </div>
        <button
          type="button"
          onClick={onStart}
          className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white"
        >
          Start
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Not now"
          title="Not now"
          className={`shrink-0 p-1.5 rounded-lg ${dark ? "text-slate-400 hover:text-slate-200 hover:bg-white/10" : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"}`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
