import { useState } from "react";
import { ChevronDown, LayoutGrid, RotateCcw, Move } from "lucide-react";
import { PRESETS } from "./presets";

// Room-header control: pick a preset layout, toggle rearrange mode, or
// reset to the default. `presetId` is "custom" once the layout is edited.
export default function LayoutBar({
  presetId, onApply, onReset, accent, dark, arranging, onToggleArrange,
  panels, activePanels, onTogglePanel,
}) {
  const [open, setOpen] = useState(false);
  const current = PRESETS.find((p) => p.id === presetId);
  const label = current ? current.label : "Custom";
  return (
    <div className="flex items-center gap-1.5">
      {/* Quick add/remove panels — one click to drop a whiteboard / chat
          in or pull it back out, no Arrange mode needed. Filled = shown. */}
      {(panels || []).map(({ id, title, Icon }) => {
        const on = (activePanels || []).includes(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => onTogglePanel?.(id)}
            title={on ? `Remove ${title}` : `Add ${title}`}
            aria-pressed={on}
            className={`inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors ${
              on ? "text-white" : dark ? "bg-[var(--color-surface-raised)] text-slate-300 hover:text-slate-100" : "bg-slate-100 text-slate-600 hover:text-slate-800"
            }`}
            style={on ? { background: accent } : {}}
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        );
      })}
      {(panels || []).length > 0 && (
        <span className={`w-px h-4 mx-0.5 ${dark ? "bg-[var(--color-border)]" : "bg-slate-200"}`} />
      )}
      <button
        type="button"
        onClick={onToggleArrange}
        title={arranging ? "Done arranging" : "Rearrange panels"}
        aria-pressed={arranging}
        className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[11px] font-semibold transition-colors ${
          arranging ? "text-white" : dark ? "bg-[var(--color-surface-raised)] text-slate-300 hover:text-slate-100" : "bg-slate-100 text-slate-600 hover:text-slate-800"
        }`}
        style={arranging ? { background: accent } : {}}
      >
        <Move className="w-3.5 h-3.5" />
        <span className="hidden lg:inline">{arranging ? "Done" : "Arrange"}</span>
      </button>
      <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Room layout"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[11px] font-semibold transition-colors ${
          dark ? "bg-[var(--color-surface-raised)] text-slate-300 hover:text-slate-100" : "bg-slate-100 text-slate-600 hover:text-slate-800"
        }`}
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        <span className="hidden lg:inline">{label}</span>
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <>
          {/* Just needs to clear the stage-mode video call (zIndex:20). */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className={`absolute right-0 top-9 z-40 w-52 p-1 rounded-xl border shadow-lg ${
              dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
            }`}
          >
            {PRESETS.map((p) => {
              const active = p.id === presetId;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="menuitem"
                  onClick={() => { onApply(p.id); setOpen(false); }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
                    active ? "text-white" : dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"
                  }`}
                  style={active ? { background: accent } : {}}
                >
                  {p.label}
                </button>
              );
            })}
            <div className={`my-1 h-px ${dark ? "bg-[var(--color-border)]" : "bg-slate-200"}`} />
            <button
              type="button"
              role="menuitem"
              onClick={() => { onReset(); setOpen(false); }}
              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[12px] font-medium inline-flex items-center gap-2 ${
                dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset to default
            </button>
          </div>
        </>
      )}
      </div>
    </div>
  );
}
