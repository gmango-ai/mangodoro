import { useEffect, useRef, useState } from "react";
import { Pause, Play, MoreHorizontal, Check, Pencil, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";

// One row in the sound library. The play button is the visual anchor —
// 44px tap target so iOS plays nice. The two assignment pills on the
// right (`Focus` / `Break`) close the loop with the timer: tap to
// designate this sound as the alarm for that phase. An overflow menu
// hides rename/delete behind a single tap, keeping the row uncluttered
// for the common case (just preview + pick).
export default function SoundCard({
  dark,
  label,
  sublabel,
  isPlaying,
  isFocusSound,
  isBreakSound,
  canRename,
  canRemove,
  onTogglePreview,
  onSetAsFocus,
  onSetAsBreak,
  onRename,
  onRemove,
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(label || "");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function down(e) { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); }
    function key(e) { if (e.key === "Escape") setMenuOpen(false); }
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [menuOpen]);

  function startRename() {
    setMenuOpen(false);
    setDraft(label || "");
    setRenaming(true);
  }
  function commitRename() {
    const next = draft.trim();
    setRenaming(false);
    if (next && next !== label) onRename?.(next);
  }

  const isSelected = isFocusSound || isBreakSound;

  const cardCls = `relative flex items-stretch gap-3 rounded-xl border transition-colors px-3 py-2.5 ${
    isSelected
      ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]"
      : dark
        ? "border-[var(--color-border)] bg-[var(--color-surface-raised)] hover:border-slate-600"
        : "border-slate-200 bg-white hover:border-slate-300"
  }`;

  return (
    <div className={cardCls}>
      <button
        type="button"
        onClick={onTogglePreview}
        aria-label={isPlaying ? `Stop preview of ${label}` : `Preview ${label}`}
        className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition-all active:scale-95 ${
          isPlaying
            ? "bg-[var(--color-accent)] text-white shadow-md shadow-[var(--color-accent)]/30"
            : dark
              ? "bg-slate-700/60 text-slate-200 hover:bg-slate-700"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
        }`}
      >
        {isPlaying
          ? <Pause className="w-4 h-4" fill="currentColor" />
          : <Play className="w-4 h-4 translate-x-0.5" fill="currentColor" />}
      </button>

      <div className="flex-1 min-w-0 flex flex-col justify-center">
        {renaming ? (
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 80))}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="h-8 text-sm"
            maxLength={80}
          />
        ) : (
          <p className={`truncate text-sm font-semibold ${dark ? "text-slate-100" : "text-slate-800"}`}>
            {label || "Untitled sound"}
          </p>
        )}
        {sublabel && !renaming && (
          <p className={`truncate text-[11px] mt-0.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>
            {sublabel}
          </p>
        )}
      </div>

      <div className="shrink-0 flex items-center gap-1.5">
        <AssignPill
          dark={dark}
          label="Focus"
          active={isFocusSound}
          onClick={onSetAsFocus}
        />
        <AssignPill
          dark={dark}
          label="Break"
          active={isBreakSound}
          onClick={onSetAsBreak}
        />

        {(canRename || canRemove) && (
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="More actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={`shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
                dark ? "text-slate-400 hover:bg-slate-700/50 hover:text-slate-200" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              }`}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className={`absolute right-0 top-full mt-1 min-w-[160px] rounded-lg border shadow-lg overflow-hidden z-30 ${
                  dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
                }`}
              >
                {canRename && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={startRename}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                      dark ? "text-slate-200 hover:bg-slate-700/50" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <Pencil className="w-3.5 h-3.5 opacity-70" /> Rename
                  </button>
                )}
                {canRemove && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setMenuOpen(false); onRemove?.(); }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                      dark ? "text-red-300 hover:bg-red-500/15" : "text-red-600 hover:bg-red-50"
                    }`}
                  >
                    <Trash2 className="w-3.5 h-3.5 opacity-70" /> Delete
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AssignPill({ dark, label, active, onClick }) {
  const baseCls = "shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all";
  const activeCls = "bg-[var(--color-accent)] text-white shadow-sm";
  const idleCls = dark
    ? "bg-slate-700/30 text-slate-400 hover:bg-slate-700 hover:text-slate-200 border border-slate-600/40"
    : "bg-white text-slate-500 hover:text-slate-700 hover:bg-slate-50 border border-slate-200";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${baseCls} ${active ? activeCls : idleCls}`}
      aria-pressed={active}
      aria-label={active ? `${label} alarm — selected` : `Set as ${label} alarm`}
    >
      {active && <Check className="w-3 h-3" strokeWidth={3} />}
      {label}
    </button>
  );
}
