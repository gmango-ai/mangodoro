import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { X } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useWidgetDrawer } from "../../context/WidgetDrawerContext";
import WidgetList from "./WidgetList";

// App-wide widget drawer: the full widget cards as a left slide-over available
// on every page (the promoted, no-longer-room-only WidgetsSidebar). Order syncs
// via useWidgetOrder; open/closed is local per-device (WidgetDrawerContext).
export default function WidgetDrawer() {
  const { open, setOpen } = useWidgetDrawer();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const location = useLocation();
  const inRoom = location.pathname.startsWith("/office/r/");

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, setOpen]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[120]" role="dialog" aria-modal="true" aria-label="Widgets">
      <div className="absolute inset-0 bg-black/40 animate-[fadeIn_.15s_ease]" onClick={() => setOpen(false)} />
      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute inset-y-0 left-0 w-80 max-w-[85vw] flex flex-col shadow-2xl animate-[slideInLeft_.2s_ease] ${
          dark ? "bg-[var(--color-surface)] border-r border-[var(--color-border)]" : "bg-white border-r border-slate-200"
        }`}
      >
        <div className={`flex items-center justify-between px-3 py-2.5 border-b shrink-0 ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>Widgets</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close widgets"
            className={`p-1.5 -mr-1 rounded-lg ${dark ? "text-slate-400 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <WidgetList dark={dark} ctx={{ inRoom }} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
