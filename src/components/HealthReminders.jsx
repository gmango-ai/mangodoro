import { useEffect, useRef } from "react";
import { useApp } from "../context/AppContext";
import { emitSelfNotification } from "../lib/notifications";
import { REMINDERS, reminderConfig, REMINDER_DEFAULT_START, REMINDER_DEFAULT_END } from "../lib/reminders";

// Wellbeing / break reminders. A single always-open ticker that fires each
// enabled reminder on its interval, only within the user's active hours, and
// routes it through the notification layer (inbox + desktop, prefs/quiet-hours
// respected). Per-tab last-fire is tracked in localStorage; the DB dedupe key
// (bucketed by interval) keeps it to one ping per interval across devices.
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const hmToMin = (hm) => { if (!hm) return null; const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } };

export default function HealthReminders() {
  const { settings, session } = useApp();
  const ref = useRef({});
  ref.current = {
    userId: session?.user?.id,
    reminders: settings?.wellbeingReminders || {},
    activeStart: settings?.reminderActiveStart || REMINDER_DEFAULT_START,
    activeEnd: settings?.reminderActiveEnd || REMINDER_DEFAULT_END,
  };

  useEffect(() => {
    const uid = session?.user?.id;
    if (!uid) return undefined;
    const tick = () => {
      const s = ref.current;
      if (!s.userId) return;
      const startMin = hmToMin(s.activeStart);
      const endMin = hmToMin(s.activeEnd);
      const nm = nowMinutes();
      const active = startMin == null || endMin == null ? true : (nm >= startMin && nm < endMin);
      if (!active) return;
      for (const r of REMINDERS) {
        const cfg = reminderConfig(s.reminders, r.key);
        if (!cfg.on) continue;
        const k = `reminder_last:${s.userId}:${r.key}`;
        const last = Number(get(k) || 0);
        // First sighting after enabling: anchor now, so the first nudge is one
        // interval out (no immediate fire).
        if (!last) { put(k, String(Date.now())); continue; }
        if (Date.now() - last < cfg.every * 60000) continue;
        put(k, String(Date.now()));
        const bucket = Math.floor(Date.now() / (cfg.every * 60000));
        emitSelfNotification({
          type: "reminder",
          title: r.title,
          body: r.body,
          payload: { kind: r.key },
          dedupeKey: `reminder:${r.key}:${bucket}`,
          dedupeWindowMinutes: cfg.every,
        });
      }
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [session?.user?.id]);

  return null;
}
