import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import MarkdownText from "./MarkdownText";
import { changelogBody, latestEntryId, appVersion } from "../lib/changelog";

const SEEN_KEY = "mango:seenChangelog";
const WHATS_NEW_EVENT = "mangodoro:whatsnew";

// Open the "What's new" modal from anywhere (Settings link, nav menu, a toast).
export function openWhatsNew() {
  window.dispatchEvent(new CustomEvent(WHATS_NEW_EVENT));
}

// Surfaces the changelog: a one-time "What's new" toast after an update lands,
// and an on-demand modal. The release marker is the newest CHANGELOG heading
// (bundled at build time); when it differs from what the user last saw we nudge
// once. First run seeds silently so we don't replay the whole backlog.
export default function WhatsNew() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(false);

  const latest = latestEntryId();

  useEffect(() => {
    const embed = new URLSearchParams(window.location.search).get("embed") === "1";
    if (embed || !latest) return;
    let seen = null;
    try { seen = localStorage.getItem(SEEN_KEY); } catch { /* ignore */ }
    if (seen == null) {
      try { localStorage.setItem(SEEN_KEY, latest); } catch { /* ignore */ }
      return;
    }
    if (seen !== latest) {
      setToast(true);
      const t = setTimeout(() => setToast(false), 12000);
      return () => clearTimeout(t);
    }
  }, [latest]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(WHATS_NEW_EVENT, onOpen);
    return () => window.removeEventListener(WHATS_NEW_EVENT, onOpen);
  }, []);

  const markSeen = () => {
    try { localStorage.setItem(SEEN_KEY, latest); } catch { /* ignore */ }
  };
  const openModal = () => { setToast(false); setOpen(true); markSeen(); };
  const close = () => { setOpen(false); markSeen(); };
  const dismissToast = () => { setToast(false); markSeen(); };

  const surface = dark ? "var(--color-surface)" : "#fff";
  const border = dark ? "var(--color-border)" : "rgb(226,232,240)";

  return (
    <>
      {toast && !open && (
        <div
          role="status"
          className={`fixed bottom-5 left-1/2 z-[300] -translate-x-1/2 max-w-[min(92vw,28rem)] rounded-lg border shadow-lg flex items-center gap-3 px-4 py-2.5 text-sm border-[var(--color-accent)] ${
            dark ? "bg-[var(--color-surface-raised)] text-slate-100 shadow-black/40" : "bg-white text-slate-900 shadow-slate-900/10"
          }`}
        >
          <Sparkles className="w-4 h-4 shrink-0 text-[var(--color-accent)]" />
          <button type="button" onClick={openModal} className="flex-1 text-left">
            <span className="font-semibold">What&rsquo;s new</span> — see what changed in this update.
          </button>
          <button
            type="button"
            onClick={dismissToast}
            aria-label="Dismiss"
            className={`${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.35)" }}
          onMouseDown={close}
        >
          <div
            className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-2xl border shadow-xl"
            style={{ background: surface, borderColor: border }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: border }}>
              <Sparkles className="w-4 h-4 text-[var(--color-accent)]" />
              <span className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>What&rsquo;s new</span>
              {appVersion && (
                <span className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>v{appVersion}</span>
              )}
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className={`ml-auto ${dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-3 text-sm">
              <MarkdownText dark={dark}>{changelogBody()}</MarkdownText>
            </div>
            <div className="flex justify-end px-4 py-3 border-t" style={{ borderColor: border }}>
              <button
                type="button"
                onClick={close}
                className="text-sm font-semibold px-3 py-1.5 rounded-lg text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
