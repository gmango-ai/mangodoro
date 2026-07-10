import { createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";

// Toolbar-pill palette per theme. The utility text/bg/border colours are remapped
// by the .wb-toolpill--light CSS rules (index.css); here we set the inline SHELL
// bg + border + the few inline colours (open-state, selected swatch outline).
function usePillTheme() {
  const { theme } = useTheme();
  const light = theme !== "dark";
  return {
    light,
    cls: light ? "wb-toolpill--light" : "",
    bg: light ? "#ffffff" : "#1f2937",
    border: light ? "1px solid rgb(226, 232, 240)" : "1px solid rgba(255,255,255,.08)",
    panelBorder: light ? "1px solid rgb(226, 232, 240)" : "1px solid rgba(255,255,255,.1)",
    openBg: light ? "rgba(15,23,42,.08)" : "rgba(255,255,255,.14)",
    swatchOutline: light ? "#0f172a" : "#ffffff",
  };
}

// Flyout direction for Dropdowns. Bottom-anchored bars (the mobile node
// inspector) provide `true` so panels open upward instead of off-screen.
export const DropUpContext = createContext(false);

// Shared FigJam-style contextual-toolbar primitives. Both the edge toolbar
// (edges.jsx) and the node toolbar (Inspector.jsx) build from these so the
// two read as one design language: a dark floating pill of icon dropdowns.

export const PALETTE = [
  "#0ea5e9", "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#f59e0b", "#eab308", "#22c55e", "#10b981", "#14b8a6",
  "#06b6d4", "#64748b", "#475569", "#0f172a", "#9ca3af", "#ffffff",
];

// The rounded shell every contextual toolbar sits in (dark, or light in light mode).
export function Pill({ children, className = "" }) {
  const t = usePillTheme();
  return (
    <div
      className={`wb-toolpill ${t.cls} flex items-center gap-0.5 px-1.5 py-1 rounded-xl shadow-2xl ${className}`}
      style={{ background: t.bg, border: t.border }}
    >
      {children}
    </div>
  );
}

export function ToolDivider() {
  return <div className="w-px h-5 bg-white/10 mx-0.5" />;
}

// An icon button that toggles a popover panel. `openKey` identifies this
// dropdown within the toolbar's single `open` state, so only one is open.
export function Dropdown({ openKey, open, setOpen, icon, title, width, children }) {
  const up = useContext(DropUpContext);
  const t = usePillTheme();
  return (
    <div className="relative">
      <button
        type="button"
        title={title}
        onClick={() => setOpen(open === openKey ? null : openKey)}
        className="h-7 px-1 rounded-md flex items-center gap-0.5 text-white/90 hover:bg-white/10"
        style={{ background: open === openKey ? t.openBg : "transparent" }}
      >
        {icon}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open === openKey && (up ? (
        // Bottom bar mode: the bar scrolls horizontally and would clip an
        // absolute panel — portal it above the bar (clearance published in
        // --wb-inspector-clear), with a backdrop so a stray tap closes it.
        createPortal(
          <>
            <div className="fixed inset-0 z-[85]" onClick={() => setOpen(null)} />
            <div
              className={`wb-toolpill ${t.cls} fixed left-1/2 -translate-x-1/2 z-[90] rounded-lg shadow-2xl p-1`}
              style={{
                minWidth: width || 96,
                background: t.bg,
                border: t.panelBorder,
                bottom: "calc(var(--bottom-inset, 0px) + var(--wb-inspector-clear, 190px))",
              }}
            >
              {children}
            </div>
          </>,
          document.body,
        )
      ) : (
        <div
          className={`wb-toolpill ${t.cls} absolute top-8 left-0 z-30 rounded-lg shadow-2xl p-1`}
          style={{ minWidth: width || 96, background: t.bg, border: t.panelBorder }}
        >
          {children}
        </div>
      ))}
    </div>
  );
}

// A 6-wide grid of colour swatches for a Dropdown panel, ending in a custom
// colour well. `onLive` (optional) previews the native picker as you drag
// WITHOUT committing/closing — onPick is the final commit (swatch click).
export function SwatchGrid({ value, onPick, onLive }) {
  const live = onLive || onPick;
  const t = usePillTheme();
  // Fixed-width tracks (not fractional grid-cols) so swatches keep their full
  // size and gap no matter how the panel sizes itself — no overlap.
  return (
    <div className="grid gap-2.5 p-2.5" style={{ gridTemplateColumns: "repeat(6, 24px)", justifyContent: "center" }}>
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onPick(c)}
          className="rounded-full border border-white/20 hover:scale-110 transition-transform"
          style={{ width: 24, height: 24, background: c, outline: value === c ? `2px solid ${t.swatchOutline}` : "none", outlineOffset: 2 }}
        />
      ))}
      <label
        title="Custom colour"
        className="rounded-full overflow-hidden inline-flex items-center justify-center cursor-pointer border border-white/30"
        style={{ width: 24, height: 24, background: "conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red)" }}
      >
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value || "") ? value : "#888888"}
          // Live-preview while dragging the native picker; never auto-close, so
          // you can keep adjusting (click a swatch or click away to finish).
          onInput={(e) => live(e.target.value)}
          onChange={(e) => live(e.target.value)}
          style={{ width: 30, height: 30, margin: -3, padding: 0, border: "none", background: "none", cursor: "pointer", opacity: 0 }}
        />
      </label>
    </div>
  );
}

// A single text row inside a Dropdown panel.
export function Opt({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full text-left px-2 py-1 rounded text-[12px] whitespace-nowrap ${active ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10"}`}
    >
      {children}
    </button>
  );
}
