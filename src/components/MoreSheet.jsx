import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { Timer, Settings as SettingsIcon, Sun, Moon, LogOut } from "lucide-react";
import UserAvatar from "./UserAvatar";
import LogoMark from "./LogoMark";
import OrgSwitcher from "./OrgSwitcher";

// Bottom sheet opened by the BottomNav "More" tab. A side drawer is hard to
// reach one-handed on a phone, so the secondary destinations live in a sheet
// that slides up from the bottom (thumb territory) and swipes back down to
// dismiss. Holds what the bottom tab bar doesn't: Time tracker, Quick timer,
// Settings, theme, Sign out — plus the org switcher and profile. The side
// drawer in Nav.jsx is kept for the narrow-desktop (fine-pointer) hamburger.
export default function MoreSheet({
  open,
  onClose,
  dark,
  settings,
  onToggleTheme,
  onOpenPomodoro,
  onSignOut,
  session,
}) {
  const [dragY, setDragY] = useState(0);
  const startRef = useRef(null);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll while open, and reset any leftover drag offset.
  useEffect(() => {
    if (!open) return;
    setDragY(0);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Swipe-to-dismiss off the grabber. Pointer capture keeps move/up firing even
  // when the finger slides past the handle; only downward drag counts.
  function onPointerDown(e) {
    startRef.current = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (startRef.current == null) return;
    const dy = e.clientY - startRef.current;
    setDragY(dy > 0 ? dy : 0);
  }
  function endDrag() {
    if (startRef.current == null) return;
    if (dragY > 100) onClose();
    else setDragY(0);
    startRef.current = null;
  }

  const itemCls = `w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-colors ${
    dark ? "text-slate-200 hover:bg-[var(--color-surface-raised)]" : "text-slate-700 hover:bg-slate-100"
  }`;
  const email = session?.user?.email || "";

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`xl:hidden fixed inset-0 z-[95] bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="More"
        aria-hidden={!open}
        className={`xl:hidden fixed inset-x-0 bottom-0 z-[96] flex flex-col max-h-[85dvh] rounded-t-3xl border-t shadow-2xl ${
          dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
        }`}
        style={{
          paddingBottom: "env(safe-area-inset-bottom)",
          transform: open ? `translateY(${dragY}px)` : "translateY(100%)",
          transition: startRef.current == null ? "transform 0.25s ease-out" : "none",
        }}
      >
        {/* Grabber doubles as the swipe-to-dismiss target. */}
        <div
          className="pt-2.5 pb-1.5 flex justify-center cursor-grab touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className={`h-1.5 w-10 rounded-full ${dark ? "bg-slate-600" : "bg-slate-300"}`} />
        </div>

        <div className="overflow-y-auto px-3 pb-3 space-y-1">
          <div className="flex items-center gap-3 px-2 py-2">
            {settings.avatarUrl ? (
              <UserAvatar url={settings.avatarUrl} name={settings.name} size={40} className="shrink-0" />
            ) : (
              <span className="inline-flex shrink-0 text-[var(--color-accent)]" aria-hidden>
                <LogoMark size={32} />
              </span>
            )}
            <div className="min-w-0">
              <p className={`text-sm font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
                {settings.name || "Mangodoro"}
              </p>
              {email && (
                <p className={`text-xs truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>{email}</p>
              )}
            </div>
          </div>

          <div className="px-2 pb-1">
            <OrgSwitcher />
          </div>

          <NavLink to="/time-tracker" onClick={onClose} className={itemCls}>
            <span className="w-5 text-center">📋</span> Time tracker
          </NavLink>

          <button type="button" onClick={() => { onClose(); onOpenPomodoro?.(); }} className={itemCls}>
            <Timer className="w-5 h-5" /> Quick timer
          </button>

          <NavLink to="/settings" onClick={onClose} className={itemCls}>
            <SettingsIcon className="w-5 h-5" /> Settings
          </NavLink>

          <button type="button" onClick={onToggleTheme} className={itemCls}>
            {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            {dark ? "Light mode" : "Dark mode"}
          </button>

          <div className={`my-1 border-t ${dark ? "border-[var(--color-border-light)]" : "border-slate-100"}`} />

          <button
            type="button"
            onClick={onSignOut}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
              dark ? "text-slate-400 hover:text-red-300 hover:bg-red-500/10" : "text-slate-600 hover:text-red-600 hover:bg-red-50"
            }`}
          >
            <LogOut className="w-5 h-5" /> Sign out
          </button>
        </div>
      </div>
    </>
  );
}
