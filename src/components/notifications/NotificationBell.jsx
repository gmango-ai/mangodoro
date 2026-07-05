import { useEffect, useRef, useState } from "react";
import { Bell, Check, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useNotifications } from "../../context/NotificationContext";
import { useTheme } from "../../context/ThemeContext";

function timeAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// Bell + unread badge in the nav; opens an inbox dropdown. Clicking an item
// marks it read and routes via payload.route. Closes on outside click.
export default function NotificationBell({ size = "md" }) {
  const { items, unread, markRead, markAllRead, clearOne, clearAll } = useNotifications();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const btnSize = size === "lg" ? "w-11 h-11" : "w-9 h-9";
  const iconSize = size === "lg" ? "w-6 h-6" : "w-5 h-5";
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  const onItem = (n) => {
    if (!n.read_at) markRead(n.id);
    setOpen(false);
    // Prefer the specific room when the payload carries one (the stored route is
    // the hallway fallback).
    const rid = n.payload?.room_id;
    const route = rid ? `/office/r/${rid}` : n.payload?.route;
    if (route) navigate(route);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        aria-label="Notifications"
        className={`relative ${btnSize} rounded-full flex items-center justify-center transition-colors ${dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"}`}
      >
        <Bell className={iconSize} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute right-0 mt-2 w-80 max-w-[92vw] rounded-2xl border shadow-2xl overflow-hidden z-50"
          style={{ background: dark ? "var(--color-surface)" : "#fff", borderColor: dark ? "var(--color-border)" : "rgb(226,232,240)" }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: dark ? "var(--color-border)" : "rgb(241,245,249)" }}>
            <span className={`text-sm font-bold ${dark ? "text-slate-200" : "text-slate-700"}`}>Notifications</span>
            <div className="flex items-center gap-2.5">
              {unread > 0 && (
                <button type="button" onClick={markAllRead} title="Mark all read" className={`text-xs inline-flex items-center gap-1 ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}>
                  <Check className="w-3.5 h-3.5" /> Read
                </button>
              )}
              {items.length > 0 && (
                <button type="button" onClick={clearAll} title="Clear all notifications" className={`text-xs inline-flex items-center gap-1 ${dark ? "text-slate-400 hover:text-rose-300" : "text-slate-500 hover:text-rose-600"}`}>
                  <Trash2 className="w-3.5 h-3.5" /> Clear all
                </button>
              )}
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {(!items || items.length === 0) && (
              <div className={`px-3 py-8 text-center text-sm ${dark ? "text-slate-500" : "text-slate-400"}`}>You're all caught up.</div>
            )}
            {items.map((n) => (
              <div
                key={n.id}
                className={`relative group border-b last:border-b-0 ${dark ? "border-[var(--color-border)]" : "border-slate-100"}`}
              >
                <button
                  type="button"
                  onClick={() => onItem(n)}
                  className={`w-full text-left px-3 py-2.5 pr-9 flex gap-2.5 items-start transition-colors ${dark ? "hover:bg-white/5" : "hover:bg-slate-50"}`}
                >
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.read_at ? "bg-transparent" : "bg-sky-500"}`} />
                  <span className="flex-1 min-w-0">
                    <span className={`block text-[13px] font-semibold leading-snug ${dark ? "text-slate-200" : "text-slate-700"}`}>{n.title}</span>
                    {n.body && <span className={`block text-[12px] leading-snug ${dark ? "text-slate-400" : "text-slate-500"}`}>{n.body}</span>}
                    <span className={`block text-[10px] mt-0.5 ${dark ? "text-slate-600" : "text-slate-400"}`}>{timeAgo(n.created_at)}</span>
                  </span>
                </button>
                {/* Per-item clear — sibling of the row button (not nested). */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); clearOne(n.id); }}
                  title="Clear"
                  aria-label="Clear notification"
                  className={`absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ${dark ? "text-slate-400 hover:text-rose-300 hover:bg-white/10" : "text-slate-400 hover:text-rose-600 hover:bg-slate-100"}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
