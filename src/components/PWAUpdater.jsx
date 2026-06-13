import { useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useTheme } from "../context/ThemeContext";
import { RefreshCw } from "lucide-react";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly background check
const PENDING_KEY = "ql_pwa_pending_reload";

export default function PWAUpdater() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [showUpdated, setShowUpdated] = useState(false);
  const autoAppliedRef = useRef(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      const id = setInterval(() => {
        registration.update().catch(() => {});
      }, CHECK_INTERVAL_MS);
      function onVisible() {
        if (!document.hidden) registration.update().catch(() => {});
      }
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        clearInterval(id);
        document.removeEventListener("visibilitychange", onVisible);
      };
    },
  });

  // Auto-apply update silently when a new SW is waiting.
  useEffect(() => {
    if (!needRefresh || autoAppliedRef.current) return;
    autoAppliedRef.current = true;
    try {
      sessionStorage.setItem(PENDING_KEY, "1");
    } catch { /* ignore */ }
    updateServiceWorker(true).catch(() => {
      // If auto-apply fails, fall back to leaving the prompt visible.
      try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
      autoAppliedRef.current = false;
    });
  }, [needRefresh, updateServiceWorker]);

  // After auto-reload, show a small "Updated" toast.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(PENDING_KEY) === "1") {
        sessionStorage.removeItem(PENDING_KEY);
        setShowUpdated(true);
        const t = setTimeout(() => setShowUpdated(false), 4000);
        return () => clearTimeout(t);
      }
    } catch { /* ignore */ }
  }, []);

  // Fallback prompt if auto-apply didn't trigger (e.g. user dismissed via setNeedRefresh).
  if (needRefresh && !autoAppliedRef.current) {
    return (
      <div
        role="status"
        className={`fixed bottom-5 left-1/2 z-[300] -translate-x-1/2 max-w-[min(92vw,28rem)] rounded-lg border shadow-lg flex items-center gap-3 px-4 py-2.5 text-sm border-[var(--color-accent)] ${
          dark
            ? "bg-slate-800 text-slate-100 shadow-black/40"
            : "bg-white text-slate-900 shadow-slate-900/10"
        }`}
      >
        <RefreshCw className="w-4 h-4 shrink-0 text-[var(--color-accent)]" />
        <span className="flex-1">A new version is available.</span>
        <button
          type="button"
          onClick={() => updateServiceWorker(true)}
          className="text-xs font-semibold px-3 py-1 rounded-md bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]"
        >
          Update
        </button>
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          className={`text-xs ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}
        >
          Later
        </button>
      </div>
    );
  }

  if (showUpdated) {
    return (
      <div
        role="status"
        className={`fixed bottom-5 left-1/2 z-[300] -translate-x-1/2 max-w-[min(92vw,28rem)] rounded-lg border shadow-lg flex items-center gap-3 px-4 py-2.5 text-sm ${
          dark
            ? "border-emerald-500/40 bg-slate-800 text-slate-100 shadow-black/40"
            : "border-emerald-300 bg-white text-slate-900 shadow-slate-900/10"
        }`}
      >
        <RefreshCw className={`w-4 h-4 shrink-0 ${dark ? "text-emerald-400" : "text-emerald-600"}`} />
        <span>Updated to the latest version.</span>
      </div>
    );
  }

  return null;
}
