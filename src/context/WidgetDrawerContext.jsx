import { createContext, useCallback, useContext, useState } from "react";

// Open/closed state for the app-wide widget drawer. This is ephemeral UI state
// (unlike widget order + pins, which sync to the account), so it's kept local
// and merely remembered per-device via localStorage. Shared through context so
// the nav trigger, the drawer itself, and the in-room toggle all agree.
const KEY = "ql_widget_drawer_open";
const Ctx = createContext({ open: false, setOpen: () => {}, toggle: () => {} });

function load() {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function WidgetDrawerProvider({ children }) {
  const [open, setOpenRaw] = useState(load);
  const persist = (v) => { try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* */ } };
  const setOpen = useCallback((v) => setOpenRaw((prev) => { const next = typeof v === "function" ? v(prev) : v; persist(next); return next; }), []);
  const toggle = useCallback(() => setOpen((v) => !v), [setOpen]);
  return <Ctx.Provider value={{ open, setOpen, toggle }}>{children}</Ctx.Provider>;
}

export function useWidgetDrawer() {
  return useContext(Ctx);
}
