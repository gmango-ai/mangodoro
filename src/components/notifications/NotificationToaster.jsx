import { X } from "lucide-react";
import { useNotifications } from "../../context/NotificationContext";
import { useTheme } from "../../context/ThemeContext";

// Transient toasts for incoming notifications (the `inapp` channel). Stacked
// bottom-right, above the home-indicator safe area; auto-dismiss in the provider.
export default function NotificationToaster() {
  const { toasts, dismissToast } = useNotifications();
  const { theme } = useTheme();
  const dark = theme === "dark";
  if (!toasts?.length) return null;
  return (
    <div
      className="fixed z-[9998] flex flex-col gap-2 items-end"
      style={{ right: 16, bottom: "calc(1.25rem + var(--bottom-inset, 0px))", pointerEvents: "none" }}
    >
      {toasts.map(({ id, n }) => (
        <div
          key={id}
          className="rounded-2xl border shadow-xl px-3.5 py-2.5 max-w-[320px] pointer-events-auto"
          style={{ background: dark ? "var(--color-surface)" : "#fff", borderColor: dark ? "var(--color-border)" : "rgb(226,232,240)" }}
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              <div className={`text-[13px] font-bold leading-snug ${dark ? "text-slate-100" : "text-slate-800"}`}>{n.title}</div>
              {n.body && <div className={`text-[12px] leading-snug mt-0.5 ${dark ? "text-slate-400" : "text-slate-500"}`}>{n.body}</div>}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(id)}
              className={dark ? "text-slate-500 hover:text-slate-300 shrink-0" : "text-slate-400 hover:text-slate-600 shrink-0"}
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
