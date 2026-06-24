import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// A dropdown panel rendered in a portal with fixed positioning, so it can't be
// clipped by an ancestor's overflow (cards, scroll areas) and won't overflow
// the viewport. Right-aligned to the anchor, clamped to the screen, closes on
// outside-click / Esc / scroll / resize.
export default function Popover({ open, onClose, anchorRef, children, width = 208, dark }) {
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) { setPos(null); return; }
    const r = anchorRef.current.getBoundingClientRect();
    let left = Math.min(Math.max(8, r.right - width), window.innerWidth - 8 - width);
    const top = Math.min(r.bottom + 4, window.innerHeight - 8);
    setPos({ left, top });
  }, [open, anchorRef, width]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (anchorRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, anchorRef, onClose]);

  if (!open || !pos) return null;
  return createPortal(
    <div
      ref={panelRef}
      style={{ position: "fixed", left: pos.left, top: pos.top, width }}
      className={`z-[1000] max-h-60 overflow-y-auto rounded-lg border shadow-lg p-1 ${
        dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)]" : "bg-white border-slate-200"
      }`}
    >
      {children}
    </div>,
    document.body
  );
}
