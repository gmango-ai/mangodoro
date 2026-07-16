import { useCallback, useEffect, useMemo } from "react";
import { useApp } from "../context/AppContext";

// Legacy per-device store, from before widget order was synced to the account.
// Now used only as (a) a first-paint cache before settings load and (b) a
// one-time seed so an existing arrangement carries over to the synced prefs.
const ORDER_KEY = "ql_widget_order";

// Default ordering — most glanceable / most-frequently-needed at the top,
// occasional / placeholder widgets at the bottom. Pomodoro + Room
// Members read at-a-glance; World Clock is a glanceable strip of team
// timezones; Whiteboard is situational; Tasks is a placeholder. (Retro is
// deprecated — replaced by the whiteboard; the countdown timer now lives
// inside the whiteboard, not as a widget.)
export const DEFAULT_WIDGET_ORDER = [
  "pomodoro",
  "team-status",
  "upcoming-meetings",
  "world-clock",
  "goals",
  "whiteboard",
  "tasks",
];

// Reconcile a persisted list against the current default. New widgets
// (added by future PRs) get appended in their default position;
// removed widgets (renamed / deleted) drop out. Preserves the user's
// custom ordering for everything still valid.
function reconcile(stored) {
  const list = Array.isArray(stored) ? stored : DEFAULT_WIDGET_ORDER;
  const valid = list.filter((id) => DEFAULT_WIDGET_ORDER.includes(id));
  const missing = DEFAULT_WIDGET_ORDER.filter((id) => !valid.includes(id));
  return [...valid, ...missing];
}

function loadLegacyOrder() {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Holds the user's chosen widget order, synced to the account via
// settings.widget_prefs.order (so it follows them across devices), and returns
// the order + a reorder(fromId, toId) helper that moves the dragged widget to
// the position of the drop target. localStorage is kept as a first-paint cache
// and a one-time seed for users who had a per-device order before the sync.
export function useWidgetOrder() {
  const { settings, mergeWidgetPrefs } = useApp();
  const synced = settings?.widget_prefs?.order;
  const hasSynced = Array.isArray(synced);

  // Effective order: the account's synced order if present, else the legacy
  // local order (first paint / pre-sync), else the default — always reconciled
  // against the current widget set.
  const order = useMemo(
    () => reconcile(hasSynced ? synced : (loadLegacyOrder() || DEFAULT_WIDGET_ORDER)),
    [hasSynced, synced],
  );

  // One-time seed: no synced order yet but a legacy local one exists → push it
  // up so the user's arrangement isn't lost when we move to synced storage.
  useEffect(() => {
    if (hasSynced) return;
    const legacy = loadLegacyOrder();
    if (legacy && legacy.length) mergeWidgetPrefs({ order: reconcile(legacy) });
  }, [hasSynced, mergeWidgetPrefs]);

  // Keep the local cache fresh so a cold start paints the latest order (even
  // one set on another device) before the settings row loads.
  useEffect(() => {
    if (!hasSynced) return;
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(synced)); } catch { /* */ }
  }, [hasSynced, synced]);

  const reorder = useCallback((fromId, toId) => {
    if (fromId === toId) return;
    const fromIdx = order.indexOf(fromId);
    const toIdx = order.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = order.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    mergeWidgetPrefs({ order: next });
  }, [order, mergeWidgetPrefs]);

  const reset = useCallback(() => mergeWidgetPrefs({ order: DEFAULT_WIDGET_ORDER }), [mergeWidgetPrefs]);

  return { order, reorder, reset };
}
