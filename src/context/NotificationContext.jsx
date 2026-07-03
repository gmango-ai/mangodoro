import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabase";
import { useApp } from "./AppContext";
import { listNotifications, markRead as apiMarkRead, markAllRead as apiMarkAllRead, clearNotification as apiClearOne, clearAllNotifications as apiClearAll } from "../lib/notifications";
import { playForNotification } from "../lib/uiSounds";

// Notification layer — in-app delivery.
//
// The `notifications` table is the bus: emit_notification inserts a row →
// Supabase Realtime broadcasts it here → we feed the bell/inbox + a transient
// toast, and raise a browser Notification for the `desktop` channel when the
// tab is backgrounded and not within the user's quiet hours. Mirrors the
// clock:{userId} subscription pattern in AppContext.

const NotificationContext = createContext(null);
export const useNotifications = () => useContext(NotificationContext) || {};

let _toastSeq = 1;

// Is the current LOCAL time within the user's quiet-hours window? (Quiet hours
// only suppress desktop pings — the inbox always records.)
function withinQuietHours(start, end) {
  if (!start || !end) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const a = sh * 60 + sm, b = eh * 60 + em;
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return a <= b ? cur >= a && cur < b : cur >= a || cur < b; // overnight window
}

export function NotificationProvider({ children }) {
  const { session, settings } = useApp();
  const userId = session?.user?.id;

  // Live resolved availability, for the client-side (last-mile) delivery policy.
  const { resolved } = useResolvedSelf();
  const availabilityRef = useRef("available");
  availabilityRef.current = resolved?.availability || "available";

  const [items, setItems] = useState([]);
  const [toasts, setToasts] = useState([]);
  // Single source of truth — derive the badge from items so it can't drift /
  // double-count across the initial-fetch ↔ realtime race or redelivery.
  const unread = useMemo(() => items.filter((n) => !n.read_at).length, [items]);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const handleIncoming = useCallback((n) => {
    if (!n) return;
    setItems((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev].slice(0, 60)));
    // Audio cue for the arrival. This only runs off a realtime INSERT to me (the
    // initial fetch doesn't call it), so it's a real "just now" notification.
    // DM/channel/mention → chat cue; everything else → the notification cue. You
    // only receive types you've enabled, so this implicitly respects per-type
    // prefs; the master toggle is per-device (Settings → Notifications).
    playForNotification(n.type);
    const channels = n.channels || [];
    // Client last-mile: decide banner / sound / push from THIS device's live
    // status + the notification's priority (fresher than the server's emit-time
    // routing). High/urgent always break through; low/normal are muted while you
    // focus but still shown.
    const action = deliveryAction(n.priority || "normal", availabilityRef.current);
    // In-app toast — always show it so a notification is never silently lost
    // (there's no return-from-focus digest yet). The chime only plays when the
    // policy allows sound.
    if (channels.includes("inapp")) {
      const id = _toastSeq++;
      setToasts((t) => [...t, { id, n }].slice(-4));
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
      if (action.sound) playNotificationChime();
    }
    // OS notification — fires whenever the type wants desktop, the policy allows
    // a push, permission is granted, and it's not quiet hours. Per preference it
    // surfaces to the OS ALWAYS, even when the tab is focused (not just when
    // backgrounded), so you get the native popup alongside the in-app toast.
    const wantsDesktop = (typeMeta(n.type)?.channels || channels).includes("desktop");
    if (
      action.push && wantsDesktop &&
      typeof Notification !== "undefined" && Notification.permission === "granted" &&
      !withinQuietHours(settingsRef.current?.notifQuietStart, settingsRef.current?.notifQuietEnd)
    ) {
      try { new Notification(n.title, { body: n.body || "", icon: "/icon-192.png", tag: n.type }); } catch { /* */ }
    }
  }, []);

  // Initial fetch + realtime subscription per user.
  useEffect(() => {
    if (!userId) { setItems([]); setToasts([]); return undefined; }
    let cancelled = false;
    listNotifications(40).then((rows) => {
      if (cancelled) return;
      setItems(rows);
    });
    const channel = supabase
      .channel(`notification_deliveries:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notification_deliveries", filter: `recipient_user_id=eq.${userId}` },
        (payload) => handleIncoming(payload.new)
      )
      .subscribe();
    return () => {
      cancelled = true;
      try { supabase.removeChannel(channel); } catch { /* */ }
    };
  }, [userId, handleIncoming]);

  const markRead = useCallback(async (id) => {
    setItems((prev) => prev.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n)));
    await apiMarkRead(id);
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
    await apiMarkAllRead();
  }, []);

  // Clear = remove from the inbox entirely (delete). Optimistic.
  const clearOne = useCallback(async (id) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    await apiClearOne(id);
  }, []);

  const clearAll = useCallback(async () => {
    setItems([]);
    await apiClearAll();
  }, []);

  const value = { items, unread, toasts, dismissToast, markRead, markAllRead, clearOne, clearAll };
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}
