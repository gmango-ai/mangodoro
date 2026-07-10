import Modal from "../Modal";

// A "?" cheatsheet of the whiteboard's keyboard shortcuts. Grouped, platform-
// aware (⌘ vs Ctrl). Opened/closed by the "?" key (wired in WhiteboardPage);
// Esc / backdrop / the close button also dismiss it via the shared Modal.
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
const MOD = MAC ? "⌘" : "Ctrl";

const GROUPS = [
  { title: "Tools", items: [
    ["V", "Select"], ["P", "Pen"], ["B", "Brush"], ["L", "Laser"], ["O", "Lasso"], ["Q", "Quick palette"],
  ] },
  { title: "Place — then click to drop", items: [
    ["1–9 0", "Shapes"], ["N", "Sticky note"], ["G", "Goal"], ["F", "Frame"], ["I", "Image"],
  ] },
  { title: "Arrange", items: [
    [`${MOD} ]`, "Bring to front"], [`${MOD} [`, "Send to back"], [`${MOD} ⇧ .`, "Bigger font"], [`${MOD} ⇧ ,`, "Smaller font"],
  ] },
  { title: "Edit", items: [
    [`${MOD} Z`, "Undo"], [`${MOD} ⇧ Z`, "Redo"], [`${MOD} C`, "Copy"], [`${MOD} X`, "Cut"], [`${MOD} D`, "Duplicate"], ["⌫", "Delete"],
  ] },
  { title: "View", items: [
    [`${MOD} +`, "Zoom in"], [`${MOD} −`, "Zoom out"], [`${MOD} 0`, "Reset zoom"], ["⇧ 1", "Fit to screen"], ["Arrows", "Pan"],
  ] },
  { title: "General", items: [
    ["Esc", "Select tool / cancel"], ["?", "This help"],
  ] },
];

function Keys({ combo, dark }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {combo.split(" ").map((k, i) => (
        <kbd
          key={i}
          className={`inline-flex min-w-[1.5rem] items-center justify-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold leading-none ${
            dark ? "border-[var(--color-border)] bg-white/5" : "border-slate-300 bg-slate-50 text-slate-700"
          }`}
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

export default function WhiteboardShortcuts({ open, onClose, dark }) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="wb-shortcuts-title" overlayClassName="z-[210]">
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border p-5 shadow-2xl ${
          dark ? "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]" : "border-slate-200 bg-white text-slate-900"
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="wb-shortcuts-title" className="text-lg font-bold">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg px-2 py-1 text-xs font-medium ${dark ? "bg-white/10 hover:bg-white/15" : "bg-slate-100 hover:bg-slate-200 text-slate-600"}`}
          >
            Esc
          </button>
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide opacity-60">{g.title}</div>
              <ul className="space-y-1.5">
                {g.items.map(([combo, label]) => (
                  <li key={label} className="flex items-center justify-between gap-3 text-sm">
                    <span className="opacity-90">{label}</span>
                    <Keys combo={combo} dark={dark} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
