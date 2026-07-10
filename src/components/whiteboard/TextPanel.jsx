import { useEffect, useMemo, useState } from "react";
import { AlignLeft, AlignCenter, AlignRight, Bold, Italic, ChevronDown } from "lucide-react";
import { SwatchGrid, Opt } from "./toolbarUI";
import { wrapActiveSelection } from "./nodes";
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

// Toggle a markdown marker around the WHOLE text — fallback when nothing is
// being edited (so B / I work on a selected-but-not-editing node too).
function toggleWhole(text, marker) {
  const t = text || "";
  if (!t.trim()) return t;
  const ml = marker.length;
  if (t.length >= 2 * ml && t.startsWith(marker) && t.endsWith(marker)) return t.slice(ml, t.length - ml);
  return marker + t + marker;
}

// Compact inline label — sits to the LEFT of a control row (not a tall block
// header), so the panel stays short and reads like a conventional format bar.
function Row({ label, children }) {
  return (
    <div className="flex items-center gap-2 pt-1.5">
      <span className="text-[10px] uppercase tracking-wide text-white/40 w-11 shrink-0">{label}</span>
      <div className="flex items-center gap-1 min-w-0 flex-1">{children}</div>
    </div>
  );
}

// The single, merged text-editing panel. Lives inside the Inspector's "Text"
// dropdown. Grouped top→bottom: FONT (family) · SIZE & WEIGHT · ALIGNMENT ·
// EMPHASIS · COLOUR. Google font rows preview in their own font, loaded lazily
// on hover so opening the list stays cheap.
export default function TextPanel({ node, patchNodeData, forDefaults }) {
  const { theme } = useTheme();
  // Nested flyouts (size / weight) set their bg inline, so theme them here —
  // the .wb-toolpill--light CSS only remaps utility classes, not inline styles.
  const menuBg = theme === "dark" ? "#1f2937" : "#ffffff";
  const menuBorder = theme === "dark" ? "1px solid rgba(255,255,255,.1)" : "1px solid rgb(226, 232, 240)";
  const menuStyle = { background: menuBg, border: menuBorder };

  const [q, setQ] = useState("");
  const data = node.data || {};
  const isText = node.type === "text";
  const withVAlign = node.type === "sticky" || ["shape", "rect", "ellipse", "diamond"].includes(node.type);
  const curFamily = data.fontFamily || "sans";
  const curSize = data.fontSize || (isText || node.type === "sticky" ? 16 : 13);
  const curWeight = data.fontWeight ?? (isText ? 700 : 600);
  const curColor = data.textColor || null;
  const curAlign = data.textAlign || (isText ? "left" : "center");
  const curV = data.vAlign || "middle";

  // Size is a type-or-pick field: keep a local draft, commit on blur / Enter /
  // an exact preset pick (a datalist selection lands on an exact value).
  const [sizeInput, setSizeInput] = useState(String(curSize));
  const [sizeOpen, setSizeOpen] = useState(false);
  const [weightOpen, setWeightOpen] = useState(false);
  useEffect(() => { setSizeInput(String(curSize)); }, [curSize]);
  const commitSize = (v) => {
    const n = Math.max(4, Math.min(400, Math.round(Number(v) || 0)));
    if (n) patchNodeData({ fontSize: n });
  };
  const weightLabel = WEIGHTS.find(([v]) => v === curWeight)?.[1] || `${curWeight}`;

  const fonts = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return ql ? GOOGLE_FONTS.filter((f) => f.toLowerCase().includes(ql)) : GOOGLE_FONTS;
  }, [q]);

  const fontRow = (label, val) => (
    <button
      key={val}
      type="button"
      onMouseEnter={() => ensureGoogleFont(val)}
      onClick={() => patchNodeData({ fontFamily: val === "sans" ? null : val })}
      style={{ fontFamily: fontStack(val) }}
      className={`block w-full text-left px-2 py-1 rounded text-[12px] truncate ${
        curFamily === val ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/10"
      }`}
    >
      {label}
    </button>
  );

  const mdBtn = (Icon, marker, title) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); if (!wrapActiveSelection(marker)) patchNodeData({ text: toggleWhole(data.text, marker) }); }}
      className="h-7 w-7 rounded-md flex items-center justify-center text-white/75 hover:bg-white/10"
    >
      <Icon className="w-4 h-4" />
    </button>
  );

  const alignBtn = (v, Icon) => (
    <button
      key={v}
      type="button"
      onClick={() => patchNodeData({ textAlign: v })}
      className={`h-7 w-7 rounded-md flex items-center justify-center transition-colors ${
        curAlign === v ? "bg-white/20 text-white" : "text-white/70 hover:bg-white/10"
      }`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );

  return (
    <div className="p-1.5" style={{ width: 246 }}>
      {/* ── FONT ── family search + compact preview list ── */}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search fonts…"
        className="w-full px-2 py-1 rounded-md bg-white/10 text-white text-[12px] placeholder:text-white/40 outline-none"
      />
      <div className="nowheel mt-1" style={{ maxHeight: 108, overflowY: "auto" }}>
        {!q && PRESET_OPTIONS.map(([label, val]) => fontRow(label, val))}
        {!q && <div className="h-px my-1 bg-white/10" />}
        {fonts.map((f) => fontRow(f, f))}
        {!fonts.length && <div className="px-2 py-1 text-[12px] text-white/40">No match</div>}
      </div>

      {/* ── SIZE + WEIGHT (one row) ── */}
      <Row label="Size">
        <div className="relative" style={{ flex: "0 0 92px" }}>
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
            <button
              type="button"
              title="Preset sizes"
              onClick={() => { setSizeOpen((o) => !o); setWeightOpen(false); }}
              className="ml-auto px-1.5 py-1 text-white/55 hover:text-white"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
          {sizeOpen && (
            <div
              className="absolute left-0 top-full mt-1 z-10 rounded-md py-1 nowheel"
              style={{ minWidth: 132, maxHeight: 220, overflowY: "auto", ...menuStyle }}
            >
              {NAMED_SIZES.map((f) => (
                <Opt key={f.v} active={curSize === f.v} onClick={() => { commitSize(f.v); setSizeOpen(false); }}>
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
          <button
            type="button"
            title="Font weight"
            onClick={() => { setWeightOpen((o) => !o); setSizeOpen(false); }}
            className="w-full flex items-center rounded-md bg-white/10 px-2 py-1 text-white text-[12px]"
          >
            <span style={{ fontWeight: curWeight }} className="truncate">{weightLabel}</span>
            <ChevronDown className="ml-auto w-3.5 h-3.5 text-white/55 shrink-0" />
          </button>
          {weightOpen && (
            <div
              className="absolute right-0 top-full mt-1 z-10 rounded-md py-1 nowheel"
              style={{ minWidth: 128, maxHeight: 220, overflowY: "auto", ...menuStyle }}
            >
              {WEIGHTS.map(([v, l]) => (
                <Opt key={v} active={curWeight === v} onClick={() => { patchNodeData({ fontWeight: v }); setWeightOpen(false); }}>
                  <span style={{ fontWeight: v }}>{l}</span>
                </Opt>
              ))}
            </div>
          )}
        </div>
      </Row>

      {/* ── ALIGN (horizontal + vertical, one row) ── */}
      <Row label="Align">
        {alignBtn("left", AlignLeft)}
        {alignBtn("center", AlignCenter)}
        {alignBtn("right", AlignRight)}
        {withVAlign && <div className="w-px h-5 bg-white/10 mx-0.5" />}
        {withVAlign && [["top", "Top"], ["middle", "Mid"], ["bottom", "Bot"]].map(([v, l]) => (
          <button
            key={v}
            type="button"
            title={`Vertical ${l}`}
            onClick={() => patchNodeData({ vAlign: v })}
            className={`h-7 px-1.5 rounded-md text-[11px] font-semibold transition-colors ${
              curV === v ? "bg-white/20 text-white" : "text-white/70 hover:bg-white/10"
            }`}
          >{l}</button>
        ))}
      </Row>

      {/* ── STYLE (markdown bold / italic on the selection) ── */}
      {!forDefaults && (
        <Row label="Style">
          {mdBtn(Bold, "**", "Bold (selection, or whole text)")}
          {mdBtn(Italic, "_", "Italic (selection, or whole text)")}
        </Row>
      )}

      {/* ── COLOUR (Auto toggle inline; swatches below) ── */}
      <Row label="Colour">
        <button
          type="button"
          onClick={() => patchNodeData({ textColor: null })}
          className={`h-7 px-2 rounded-md text-[11px] transition-colors ${
            !curColor ? "bg-white/20 text-white" : "text-white/70 hover:bg-white/10"
          }`}
        >Auto</button>
      </Row>
      <SwatchGrid value={curColor} onPick={(c) => patchNodeData({ textColor: c })} onLive={(c) => patchNodeData({ textColor: c })} />
    </div>
  );
}
