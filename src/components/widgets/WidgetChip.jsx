import { useRef, useState } from "react";
import Popover from "../goals/Popover";

// Shared nav-strip pill for widget chips that don't already have a bespoke one.
// icon + an optional truncating `name` + a live `value` (+ optional label);
// click opens a Popover with `children` (typically the widget's full card).
// Styling matches the existing bespoke chips (WorkingNowBar / WorldClockNav).
export default function WidgetChip({ icon: Icon, name, value, label, title, dark, popoverWidth = 300, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
          dark ? "bg-[var(--color-surface-raised)] text-slate-300 hover:text-slate-100" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
        }`}
      >
        {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
        {/* A name (e.g. the meeting title) truncates so a long one can't blow out
            the strip; the value (time/count) always stays visible beside it. */}
        {name && <span className="truncate max-w-[120px]">{name}</span>}
        {value != null && value !== "" && <span className={`tabular-nums shrink-0 ${name ? "opacity-70" : ""}`}>{value}</span>}
        {label && <span className="hidden sm:inline text-[10px] uppercase tracking-wider opacity-80">{label}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={popoverWidth} dark={dark}>
        {children}
      </Popover>
    </>
  );
}
