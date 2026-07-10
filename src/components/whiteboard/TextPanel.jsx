import { useEffect, useMemo, useState } from "react";
import { AlignLeft, AlignCenter, AlignRight, Italic, Underline, Strikethrough, ChevronDown } from "lucide-react";
import { SwatchGrid, Opt } from "./toolbarUI";
import { GOOGLE_FONTS, PRESET_OPTIONS, fontStack, ensureGoogleFont } from "../../lib/whiteboardFonts";
import { useTheme } from "../../context/ThemeContext";

// Named size presets — a few common ones carry a friendly label.
const NAMED_SIZES = [
  { v: 12 }, { v: 14, label: "Small" }, { v: 16, label: "Normal" },
  { v: 20 }, { v: 24, label: "Large" }, { v: 32 }, { v: 48, label: "Heading" },
  { v: 64 }, { v: 72 }, { v: 96 },
];

// Font weights (numeric → friendly name). Not every font ships every weight;
// the browser falls back to the nearest available, which is fine.
const WEIGHTS = [
  [300, "Light"], [400, "Regular"], [500, "Medium"],
  [600, "Semibold"], [700, "Bold"], [800, "Extrabold"],
];

const RAINBOW = "conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red)";
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A compact −value+ stepper for the advanced numeric controls (line height, kern).
function Stepper({ label, value, display, dec, inc }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wide text-white/40 w-9 shrink-0">{label}</span>
      <div className="flex items-center rounded-md bg-white/10 flex-1">
        <button type="button" onClick={dec} className="px-2.5 py-1 text-white/60 hover:text-white leading-none">−</button>
        <span className="flex-1 text-center text-white text-[12px] tabular-nums">{display}</span>
        <button type="button" onClick={inc} className="px-2.5 py-1 text-white/60 hover:text-white leading-none">+</button>
      </div>
    </div>
  );
}

// The single, merged text-editing panel — a compact format bar. Top→bottom:
// ALIGN · FONT FAMILY (searchable dropdown) · SIZE + WEIGHT · STYLE (italic /
// underline / strike) + Advanced (line-height, kerning) · COLOUR (button →
// swatch submenu). The tall always-open sections live behind dropdowns so the
// panel stays short.
export default function TextPanel({ node, patchNodeData, forDefaults }) {
  const { theme } = useTheme();
  // Nested submenus set their bg inline, so theme them here (the
  // .wb-toolpill--light CSS only remaps utility classes, not inline styles).
  const menuStyle = {
    background: theme === "dark" ? "#1f2937" : "#ffffff",
    border: theme === "dark" ? "1px solid rgba(255,255,255,.1)" : "1px solid rgb(226, 232, 240)",
  };

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null); // "font" | "size" | "weight" | "colour" | null
  const [adv, setAdv] = useState(false);
  const toggle = (k) => setOpen((o) => (o === k ? null : k));

  const data = node.data || {};
  const isText = node.type === "text";
  const withVAlign = node.type === "sticky" || ["shape", "rect", "ellipse", "diamond"].includes(node.type);
  const curFamily = data.fontFamily || "sans";
  const curSize = data.fontSize || (isText || node.type === "sticky" ? 16 : 13);
  const curWeight = data.fontWeight ?? (isText ? 700 : 600);
  const curColor = data.textColor || null;
  const curAlign = data.textAlign || (isText ? "left" : "center");
  const curV = data.vAlign || "middle";
  const curLine = data.lineHeight ?? 1.3;
  const curKern = data.letterSpacing ?? 0;

  const [sizeInput, setSizeInput] = useState(String(curSize));
  useEffect(() => { setSizeInput(String(curSize)); }, [curSize]);
  const commitSize = (v) => {
    const n = Math.max(4, Math.min(400, Math.round(Number(v) || 0)));
    if (n) patchNodeData({ fontSize: n });
  };
  const weightLabel = WEIGHTS.find(([v]) => v === curWeight)?.[1] || `${curWeight}`;
  const fontLabel = PRESET_OPTIONS.find(([, v]) => v === curFamily)?.[0] || curFamily;

  const fonts = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return ql ? GOOGLE_FONTS.filter((f) => f.toLowerCase().includes(ql)) : GOOGLE_FONTS;
  }, [q]);

  const fontRow = (label, val) => (
    <button
      key={val}
      type="button"
      onMouseEnter={() => ensureGoogleFont(val)}
      onClick={() => { patchNodeData({ fontFamily: val === "sans" ? null : val }); setOpen(null); }}
      style={{ fontFamily: fontStack(val) }}
      className={`block w-full text-left px-2 py-1 rounded text-[12px] truncate ${
        curFamily === val ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10"
      }`}
    >
      {label}
    </button>
  );

  const alignBtn = (v, Icon) => (
    <button
      key={v}
      type="button"
      title={`Align ${v}`}
      onClick={() => patchNodeData({ textAlign: v })}
      className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 transition-colors ${
        curAlign === v ? "bg-white/20 text-white" : "text-white/70 hover:bg-white/10"
      }`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );

  const styleBtn = (key, Icon, title) => (
    <button
      key={key}
      type="button"
      title={title}
      onClick={() => patchNodeData({ [key]: !data[key] })}
      className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 transition-colors ${
        data[key] ? "bg-white/20 text-white" : "text-white/70 hover:bg-white/10"
      }`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );

  return (
    <div className="p-1.5" style={{ width: 252 }}>
      {/* ── ALIGNMENT (top) ── */}
      <div className="flex items-center gap-1">
        {alignBtn("left", AlignLeft)}
        {alignBtn("center", AlignCenter)}
        {alignBtn("right", AlignRight)}
        {withVAlign && <div className="w-px h-5 bg-white/10 mx-0.5 shrink-0" />}
        {withVAlign && [["top", "T"], ["middle", "M"], ["bottom", "B"]].map(([v, l]) => (
          <button
            key={v}
            type="button"
            title={`Vertical ${v}`}
            onClick={() => patchNodeData({ vAlign: v })}
            className={`h-7 w-6 rounded-md text-[11px] font-bold shrink-0 transition-colors ${
              curV === v ? "bg-white/20 text-white" : "text-white/70 hover:bg-white/10"
            }`}
          >{l}</button>
        ))}
      </div>

      {/* ── FONT FAMILY (searchable dropdown) ── */}
      <div className="relative pt-1.5">
        <button
          type="button"
          title="Font"
          onClick={() => toggle("font")}
          className="w-full flex items-center rounded-md bg-white/10 px-2 py-1.5 text-white text-[12px]"
        >
          <span className="truncate" style={{ fontFamily: fontStack(curFamily) }}>{fontLabel}</span>
          <ChevronDown className="ml-auto w-3.5 h-3.5 text-white/55 shrink-0" />
        </button>
        {open === "font" && (
          <div className="absolute left-0 top-full mt-1 z-20 rounded-md p-1.5" style={{ width: 236, ...menuStyle }}>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search fonts…"
              className="w-full px-2 py-1 rounded-md bg-white/10 text-white text-[12px] placeholder:text-white/40 outline-none"
            />
            <div className="nowheel mt-1" style={{ maxHeight: 200, overflowY: "auto" }}>
              {!q && PRESET_OPTIONS.map(([label, val]) => fontRow(label, val))}
              {!q && <div className="h-px my-1 bg-white/10" />}
              {fonts.map((f) => fontRow(f, f))}
              {!fonts.length && <div className="px-2 py-1 text-[12px] text-white/40">No match</div>}
            </div>
          </div>
        )}
      </div>

      {/* ── SIZE + WEIGHT ── */}
      <div className="flex items-start gap-1.5 pt-1.5">
        <div className="relative" style={{ flex: "0 0 96px" }}>
          <div className="flex items-center rounded-md bg-white/10">
            <input
              type="text"
              inputMode="numeric"
              value={sizeInput}
              onChange={(e) => setSizeInput(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
              onBlur={() => commitSize(sizeInput)}
              onKeyDown={(e) => { if (e.key === "Enter") { commitSize(sizeInput); e.currentTarget.blur(); } }}
              className="w-9 bg-transparent px-2 py-1 text-white text-[12px] outline-none"
            />
            <span className="text-[11px] text-white/40">px</span>
            <button type="button" title="Preset sizes" onClick={() => toggle("size")} className="ml-auto px-1.5 py-1 text-white/55 hover:text-white">
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
          {open === "size" && (
            <div className="absolute left-0 top-full mt-1 z-20 rounded-md py-1 nowheel" style={{ minWidth: 132, maxHeight: 220, overflowY: "auto", ...menuStyle }}>
              {NAMED_SIZES.map((f) => (
                <Opt key={f.v} active={curSize === f.v} onClick={() => { commitSize(f.v); setOpen(null); }}>
                  <span className="inline-flex items-baseline gap-2">
                    <span>{f.v}px</span>
                    {f.label && <span className="text-white/45 text-[11px]">{f.label}</span>}
                  </span>
                </Opt>
              ))}
            </div>
          )}
        </div>
        <div className="relative flex-1">
          <button type="button" title="Font weight" onClick={() => toggle("weight")} className="w-full flex items-center rounded-md bg-white/10 px-2 py-1 text-white text-[12px]">
            <span style={{ fontWeight: curWeight }} className="truncate">{weightLabel}</span>
            <ChevronDown className="ml-auto w-3.5 h-3.5 text-white/55 shrink-0" />
          </button>
          {open === "weight" && (
            <div className="absolute right-0 top-full mt-1 z-20 rounded-md py-1 nowheel" style={{ minWidth: 128, maxHeight: 220, overflowY: "auto", ...menuStyle }}>
              {WEIGHTS.map(([v, l]) => (
                <Opt key={v} active={curWeight === v} onClick={() => { patchNodeData({ fontWeight: v }); setOpen(null); }}>
                  <span style={{ fontWeight: v }}>{l}</span>
                </Opt>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── STYLE (italic / underline / strike) + Advanced toggle ── */}
      <div className="flex items-center gap-1 pt-1.5">
        {styleBtn("italic", Italic, "Italic")}
        {styleBtn("underline", Underline, "Underline")}
        {styleBtn("strikethrough", Strikethrough, "Strikethrough")}
        <button
          type="button"
          onClick={() => setAdv((a) => !a)}
          className="ml-auto flex items-center gap-0.5 text-[11px] text-white/55 hover:text-white pr-0.5"
        >
          Advanced <ChevronDown className={`w-3 h-3 transition-transform ${adv ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* ── ADVANCED (line height + kerning) ── */}
      {adv && (
        <div className="pt-1.5 space-y-1.5">
          <Stepper
            label="Line"
            display={curLine.toFixed(2)}
            dec={() => patchNodeData({ lineHeight: clamp(Math.round((curLine - 0.1) * 100) / 100, 0.6, 3) })}
            inc={() => patchNodeData({ lineHeight: clamp(Math.round((curLine + 0.1) * 100) / 100, 0.6, 3) })}
          />
          <Stepper
            label="Kern"
            display={`${curKern}px`}
            dec={() => patchNodeData({ letterSpacing: clamp(Math.round((curKern - 0.5) * 10) / 10, -3, 20) })}
            inc={() => patchNodeData({ letterSpacing: clamp(Math.round((curKern + 0.5) * 10) / 10, -3, 20) })}
          />
        </div>
      )}

      {/* ── COLOUR (single button → swatch submenu) ── */}
      <div className="relative pt-1.5">
        <button type="button" title="Text colour" onClick={() => toggle("colour")} className="w-full flex items-center gap-2 rounded-md bg-white/10 px-2 py-1.5 text-white text-[12px]">
          <span className="w-4 h-4 rounded-full border border-white/30 shrink-0" style={{ background: curColor || RAINBOW }} />
          <span className="truncate">{curColor ? curColor.toUpperCase() : "Auto (contrast)"}</span>
          <ChevronDown className="ml-auto w-3.5 h-3.5 text-white/55 shrink-0" />
        </button>
        {open === "colour" && (
          <div className="absolute left-0 top-full mt-1 z-20 rounded-md p-1" style={{ minWidth: 210, ...menuStyle }}>
            <Opt active={!curColor} onClick={() => { patchNodeData({ textColor: null }); setOpen(null); }}>Auto (contrast)</Opt>
            <SwatchGrid value={curColor} onPick={(c) => { patchNodeData({ textColor: c }); }} onLive={(c) => patchNodeData({ textColor: c })} />
          </div>
        )}
      </div>
    </div>
  );
}
