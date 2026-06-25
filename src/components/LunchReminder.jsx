import { useEffect, useRef, useState } from "react";
import { Utensils, X } from "lucide-react";
import { useApp } from "../context/AppContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { useTheme } from "../context/ThemeContext";
import { emitSelfNotification } from "../lib/notifications";

// "Out to lunch" auto-status.
//
// Watches the user's configured lunch time (a per-user setting) and, once a
// day while the app is open, either flips presence to out_to_lunch (mode
// "auto") or prompts them to (mode "ask"). After the configured duration it
// flips back to active. A browser notification fires too when permitted, so a
// backgrounded tab still nudges. This is the app-open version — closed-tab /
// push delivery is for the notification layer (roadmap).
//
// Per-day fire + the lunch window are tracked in localStorage so reopening a
// tab doesn't re-fire, and a tab opened a few minutes late still catches it.

const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const hmToMin = (hm) => { if (!hm) return null; const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } };
const del = (k) => { try { localStorage.removeItem(k); } catch { /* */ } };

// Self lunch nudge through the notification layer → inbox + desktop (when the
// tab is backgrounded), respecting the user's prefs + quiet hours. Recipient is
// forced to the caller server-side; deduped to once per day across tabs/devices
// (a partial unique index makes the dedupe race-proof).
function notifyLunch(userId, title, body) {
  if (!userId) return;
  emitSelfNotification({
    type: "lunch_reminder",
    title,
    body,
    payload: { route: "/office" },
    dedupeKey: `lunch_reminder:${userId}:${todayKey()}`,
    dedupeWindowMinutes: 720,
  });
}

const FIRE_WINDOW_MIN = 10; // catch a tab opened up to 10 min after lunch time

export default function LunchReminder() {
  const { settings, session, updateStatus, clockIn, startClockBreak, endClockBreak } = useApp();
  const { syncSession, setStatus: setSyncStatus } = useSyncSession();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [prompt, setPrompt] = useState(false);

  // Latest values for the interval to read without re-subscribing.
  const ref = useRef({});
  ref.current = {
    userId: session?.user?.id,
    mode: settings?.lunchMode || "off",
    lunchTime: settings?.lunchTime || "",
    durationMin: settings?.lunchDurationMin ?? 60,
    presence: settings?.presenceState || "active",
    lunchPaid: settings?.lunchBreakPaid,
    clockIn,
    startClockBreak,
    endClockBreak,
    syncSession,
    setSyncStatus,
    updateStatus,
    setPrompt,
  };

  const setPresence = async (state) => {
    const s = ref.current;
    try { await s.updateStatus?.({ presenceState: state }); } catch { /* */ }
    // Also reflect it in the active sync session, if any.
    if (s.syncSession && s.setSyncStatus) { try { await s.setSyncStatus({ presenceState: state }); } catch { /* */ } }
  };
  const goToLunch = async () => {
    const s = ref.current;
    await setPresence("out_to_lunch");
    // If clocked in, log the lunch as a break (paid/unpaid per Settings).
    if (s.clockIn && !s.clockIn.activeBreak) s.startClockBreak?.({ unpaid: !s.lunchPaid, kind: "lunch" });
    put(`lunch_until:${s.userId}`, String(Date.now() + (s.durationMin || 60) * 60000));
  };
  const backFromLunch = async () => {
    const s = ref.current;
    await setPresence("active");
    if (s.clockIn?.activeBreak?.kind === "lunch") s.endClockBreak?.();
    del(`lunch_until:${s.userId}`);
  };
  ref.current.goToLunch = goToLunch;
  ref.current.backFromLunch = backFromLunch;

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return undefined;
    const tick = () => {
      const s = ref.current;
      if (!s.userId) return;
      // Auto-return when the lunch window elapses (only if still at lunch).
      const until = Number(get(`lunch_until:${s.userId}`) || 0);
      if (until && Date.now() >= until && s.presence === "out_to_lunch") s.backFromLunch();
      // Fire the lunch trigger once per day, within a short window after the time.
      if (s.mode === "off" || !s.lunchTime) return;
      const firedKey = `lunch_fired:${s.userId}:${todayKey()}`;
      if (get(firedKey) === "1") return;
      const target = hmToMin(s.lunchTime);
      const now = nowMinutes();
      if (target == null || now < target || now >= target + FIRE_WINDOW_MIN) return;
      put(firedKey, "1");
      if (s.mode === "auto") { s.goToLunch(); notifyLunch(s.userId, "Out to lunch", "Status set to Out to lunch — enjoy your break!"); }
      else { s.setPrompt(true); notifyLunch(s.userId, "Lunch time?", "Set your status to Out to lunch."); }
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [session?.user?.id]);

  if (!prompt) return null;
  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border shadow-xl"
      style={{
        bottom: "calc(1.5rem + var(--bottom-inset, 0px))",
        background: dark ? "var(--color-surface)" : "#fff",
        borderColor: dark ? "var(--color-border)" : "rgb(226,232,240)",
      }}
    >
      <Utensils className={`w-5 h-5 ${dark ? "text-orange-300" : "text-orange-500"}`} />
      <span className={`text-sm font-semibold ${dark ? "text-slate-200" : "text-slate-700"}`}>Heading to lunch?</span>
      <button
        type="button"
        onClick={async () => { setPrompt(false); await goToLunch(); }}
        className="text-sm font-bold px-3 py-1.5 rounded-lg text-white"
        style={{ background: "var(--color-accent)" }}
      >
        Out to lunch
      </button>
      <button
        type="button"
        onClick={() => setPrompt(false)}
        className={`text-sm px-2 py-1.5 rounded-lg ${dark ? "text-slate-400 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"}`}
      >
        Not now
      </button>
      <button type="button" onClick={() => setPrompt(false)} title="Dismiss" className={dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"}>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
