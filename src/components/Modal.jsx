import { useEffect } from "react";
import { cn } from "../lib/utils";

// Shared modal scaffold: fixed backdrop, centered panel slot, click-outside
// and Escape both close. Purely structural — the panel look stays with each
// modal's children, so adopting this changes no visuals.
//
//   <Modal open={open} onClose={onClose} labelledBy="my-title">
//     <div className="…panel classes…">…</div>
//   </Modal>
//
// `overlayClassName` extends/overrides the backdrop (z-index, blur strength).
// The panel child must keep its own onClick stopPropagation so inside
// clicks never reach the backdrop (every existing modal already does).
export default function Modal({
  open = true,
  onClose,
  children,
  overlayClassName = "",
  labelledBy,
}) {
  useEffect(() => {
    if (!open || !onClose) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className={cn(
        "fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4",
        overlayClassName,
      )}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      {children}
    </div>
  );
}
