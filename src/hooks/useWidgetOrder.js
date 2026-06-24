import { useCallback, useEffect, useState } from "react";

const ORDER_KEY = "ql_widget_order";

// Default ordering — most glanceable / most-frequently-needed at the top,
// occasional / placeholder widgets at the bottom. Pomodoro + Room
// Members read at-a-glance; Whiteboard is situational; Tasks is a
// placeholder. (Retro is deprecated — replaced by the whiteboard; the
// countdown timer now lives inside the whiteboard, not as a widget.)
export const DEFAULT_WIDGET_ORDER = [
  "pomodoro",
  "room-members",
  "goals",
  "whiteboard",
  "tasks",
];

function loadOrder() {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return DEFAULT_WIDGET_ORDER;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_WIDGET_ORDER;
    return reconcile(parsed);
  } catch {
    return DEFAULT_WIDGET_ORDER;
  }
}

// Reconcile a persisted list against the current default. New widgets
// (added by future PRs) get appended in their default position;
// removed widgets (renamed / deleted) drop out. Preserves the user's
// custom ordering for everything still valid.
function reconcile(stored) {
  const valid = stored.filter((id) => DEFAULT_WIDGET_ORDER.includes(id));
  const missing = DEFAULT_WIDGET_ORDER.filter((id) => !valid.includes(id));
  return [...valid, ...missing];
}

function saveOrder(order) {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch { /* */ }
}

// Holds the user's chosen widget order with localStorage persistence.
// Returns the order + a reorder(fromId, toId) helper that moves the
// dragged widget to the position of the drop target.
export function useWidgetOrder() {
  const [order, setOrderState] = useState(loadOrder);

  useEffect(() => { saveOrder(order); }, [order]);

  const reorder = useCallback((fromId, toId) => {
    if (fromId === toId) return;
    setOrderState((prev) => {
      const fromIdx = prev.indexOf(fromId);
      const toIdx = prev.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = prev.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  const reset = useCallback(() => setOrderState(DEFAULT_WIDGET_ORDER), []);

  return { order, reorder, reset };
}
