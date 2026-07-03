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

  const [items, setItems] = useState([]);
  const [toasts, setToasts] = useState([]);
  // Single source of truth — derive the badge from items so it can't drift /
  // double-count across the initial-fetch ↔ realtime race or redelivery.
  const unread = useMemo(() => items.filter((n) => !n.read_at).length, [items]);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const notificationIdsRef = useRef(new Set());

  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const handleIncoming = useCallback((n) => {
    if (!n) return;
    if (n.id && notificationIdsRef.current.has(n.id)) return;
    if (n.id) notificationIdsRef.current.add(n.id);
    setItems((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev].slice(0, 60)));
    // Audio cue for the arrival. This only runs off a realtime INSERT to me (the
    // initial fetch doesn't call it), so it's a real "just now" notification.
    // DM/channel/mention → chat cue; everything else → the notification cue. You
    // only receive types you've enabled, so this implicitly respects per-type
    // prefs; the master toggle is per-device (Settings → Notifications).
    playForNotification(n.type);
    const channels = n.channels || [];
    if (channels.includes("inapp")) {
      const id = _toastSeq++;
      setToasts((t) => [...t, { id, n }].slice(-4));
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
    }
    if (
      channels.includes("desktop") &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted" &&
      typeof document !== "undefined" && document.hidden &&
      !withinQuietHours(settingsRef.current?.notifQuietStart, settingsRef.current?.notifQuietEnd)
    ) {
      try { new Notification(n.title, { body: n.body || "", icon: "/icon-192.png", tag: n.type }); } catch { /* */ }
    }
  }, []);

  // Initial fetch + realtime subscription per user.
  useEffect(() => {
    if (!userId) { notificationIdsRef.current = new Set(); setItems([]); setToasts([]); return undefined; }
    notificationIdsRef.current = new Set();
    let cancelled = false;
    listNotifications(40).then((rows) => {
      if (cancelled) return;
      notificationIdsRef.current = new Set([...notificationIdsRef.current, ...rows.map((n) => n.id)]);
      setItems((prev) => {
        const fetchedIds = new Set(rows.map((n) => n.id));
        return [...prev.filter((n) => !fetchedIds.has(n.id)), ...rows].slice(0, 60);
      });
    });
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_user_id=eq.${userId}` },
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
