import { useState } from "react";
import { ChevronDown, LayoutGrid, RotateCcw, Globe, Plus, Check } from "lucide-react";
import { PRESETS } from "./presets";

// Room-header control. Two trailing-control modes:
//   • addMenu (rooms) — an "Add" menu that lists every item you can drop into
//     the view (video / chat / whiteboard / web view, growing as we add more)
//     plus "Reset layout". The web view lives here, not as a separate button.
//   • preset dropdown (kiosk) — the legacy layout-template picker. Rendered
//     only when a preset set is supplied and addMenu is off, so the device
//     kiosk keeps its presets unchanged.
// The "quick view" toggle buttons (the pinned panels) are shown in both modes.
export default function LayoutBar({
  presetId, onApply, onReset, accent, dark,
  panels, addPanels, activePanels, badges, onTogglePanel, onAddWeb, presets = PRESETS,
  addMenu = false,
}) {
  const [open, setOpen] = useState(false);
  const current = presets.find((p) => p.id === presetId);
  const label = current ? current.label : "Custom";

  const pillCls = `inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[11px] font-semibold transition-colors ${
    dark ? "bg-[var(--color-surface-raised)] text-slate-300 hover:text-slate-100" : "bg-slate-100 text-slate-600 hover:text-slate-800"
  }`;
  // The Add button stays on mobile (bigger touch target), while the quick
  // toggles + arrange collapse away.
  const addBtnCls = `inline-flex items-center justify-center gap-1.5 px-3 sm:px-2.5 h-10 sm:h-7 rounded-full text-[13px] sm:text-[11px] font-semibold transition-colors ${
    dark ? "bg-[var(--color-surface-raised)] text-slate-300 hover:text-slate-100" : "bg-slate-100 text-slate-600 hover:text-slate-800"
  }`;
  const menuCls = `absolute right-0 top-11 sm:top-9 z-40 w-64 sm:w-52 p-1.5 sm:p-1 rounded-xl border shadow-lg ${
    dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
  }`;
  // Roomier rows on touch (44px targets) than on desktop.
  const itemCls = `w-full text-left px-3 sm:px-2.5 py-2.5 sm:py-1.5 rounded-lg text-[14px] sm:text-[12px] font-medium inline-flex items-center gap-2.5 sm:gap-2 transition-colors ${
    dark ? "text-slate-300 hover:bg-white/10 active:bg-white/10" : "text-slate-600 hover:bg-slate-100 active:bg-slate-100"
  }`;
  const itemIconCls = "w-5 h-5 sm:w-3.5 sm:h-3.5 shrink-0";

  return (
    <div className="flex items-center gap-1.5">
      {/* Quick panel toggles are desktop-only (hidden on mobile);
          the mobile room header keeps just the Add button unless arranging. */}
      <div className="hidden sm:flex items-center gap-1.5">
      {/* Quick view buttons — pinned panels, one click to drop one in or pull
          it back out, no Arrange mode needed. Filled = shown. */}
      {(panels || []).map(({ id, title, Icon }) => {
        const on = (activePanels || []).includes(id);
        // Activity badge only when the panel is CLOSED (open = you're seeing it).
        const badge = !on ? badges?.[id] : null;
        const badgeLabel = badge
          ? (id === "chat"
              ? `${badge.count} unread message${badge.count === 1 ? "" : "s"}`
              : `${badge.count} ${id === "video" ? "in the call" : "on the whiteboard"}`)
          : "";
        return (
          <div key={id} className="relative">
            <button
              type="button"
              onClick={() => onTogglePanel?.(id)}
              title={badge ? `${title} — ${badgeLabel}` : on ? `Remove ${title}` : `Add ${title}`}
              aria-pressed={on}
              className={`inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors ${
                on ? "text-white" : dark ? "bg-[var(--color-surface-raised)] text-slate-300 hover:text-slate-100" : "bg-slate-100 text-slate-600 hover:text-slate-800"
              }`}
              style={on ? { background: accent } : {}}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
            {badge && (
              <span
                aria-label={badgeLabel}
                className={`absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 inline-flex items-center justify-center rounded-full text-[9px] font-bold leading-none ring-2 ${
                  dark ? "ring-[var(--color-surface)]" : "ring-white"
                } ${
                  badge.live
                    ? "bg-emerald-500 text-white"
                    : "bg-[var(--color-accent)] text-white"
                }`}
              >
                {badge.count > 9 ? "9+" : badge.count}
              </span>
            )}
          </div>
        );
      })}

      {/* Legacy standalone add-website button — only in preset mode; the room's
          addMenu carries the web view inside the Add menu instead. */}
      {onAddWeb && !addMenu && (
        <button
          type="button"
          onClick={onAddWeb}
          title="Add a shared web view (everyone sees it)"
          className={`inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors ${
            dark ? "bg-[var(--color-surface-raised)] text-slate-300 hover:text-slate-100" : "bg-slate-100 text-slate-600 hover:text-slate-800"
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
        </button>
      )}

      {(panels || []).length > 0 && (
        <span className={`w-px h-4 mx-0.5 ${dark ? "bg-[var(--color-border)]" : "bg-slate-200"}`} />
      )}
      </div>

      <div className="relative">
        {addMenu ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            title="Add to the view"
            aria-haspopup="menu"
            aria-expanded={open}
            className={addBtnCls}
          >
            <Plus className="w-5 h-5 sm:w-3.5 sm:h-3.5" />
            <span className="hidden lg:inline">Add</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            title="Room layout"
            aria-haspopup="menu"
            aria-expanded={open}
            className={pillCls}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">{label}</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>
        )}
        {open && (
          <>
            {/* Just needs to clear the stage-mode video call (zIndex:20). */}
            <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
            <div role="menu" className={menuCls}>
              {addMenu ? (
                <>
                  <p className={`px-2.5 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>
                    Add to view
                  </p>
                  {/* Every panel type — a checkmark shows what's already open;
                      click toggles it. Menu stays open so you can add several. */}
                  {(addPanels || panels || []).map(({ id, title, Icon }) => {
                    const on = (activePanels || []).includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        role="menuitem"
                        onClick={() => onTogglePanel?.(id)}
                        className={itemCls}
                      >
                        <Icon className={itemIconCls} />
                        <span className="flex-1">{title}</span>
                        {on && <Check className="w-5 h-5 sm:w-3.5 sm:h-3.5 text-[var(--color-accent)]" />}
                      </button>
                    );
                  })}
                  {onAddWeb && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { onAddWeb(); setOpen(false); }}
                      className={itemCls}
                    >
                      <Globe className={itemIconCls} />
                      <span className="flex-1">Web view</span>
                      <Plus className="w-4 h-4 sm:w-3 sm:h-3 opacity-60" />
                    </button>
                  )}
                  <div className={`my-1 h-px ${dark ? "bg-[var(--color-border)]" : "bg-slate-200"}`} />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { onReset?.(); setOpen(false); }}
                    className={itemCls}
                  >
                    <RotateCcw className={itemIconCls} /> Reset layout
                  </button>
                </>
              ) : (
                <>
                  {presets.map((p) => {
                    const active = p.id === presetId;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="menuitem"
                        onClick={() => { onApply?.(p.id); setOpen(false); }}
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
                    onClick={() => { onReset?.(); setOpen(false); }}
                    className={itemCls}
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Reset to default
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
