import { useEffect, useMemo, useState } from "react";
import { AlignLeft, AlignCenter, AlignRight, Bold, Italic, ChevronDown } from "lucide-react";
import { SwatchGrid, Opt } from "./toolbarUI";
import { wrapActiveSelection } from "./nodes";
import { GOOGLE_FONTS, PRESET_OPTIONS, fontStack, ensureGoogleFont } from "../../lib/whiteboardFonts";

// Named size presets — a few common ones carry a friendly label.
const NAMED_SIZES = [
  { v: 12 }, { v: 14, label: "Small" }, { v: 16, label: "Normal" },
  { v: 20 }, { v: 24, label: "Large" }, { v: 32 }, { v: 48, label: "Heading" },
  { v: 64 }, { v: 72 }, { v: 96 },
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

function Label({ children }) {
  return <div className="text-[10px] uppercase tracking-wide text-white/40 px-0.5 pb-1 pt-2">{children}</div>;
}

// The single, merged text-editing panel — font · size · style · align · colour.
// Lives inside the Inspector's "Text" dropdown. Google font rows preview in
// their own font, loaded lazily on hover so opening the list stays cheap.
export default function TextPanel({ node, patchNodeData }) {
  const [q, setQ] = useState("");
  const data = node.data || {};
  const isText = node.type === "text";
  const withVAlign = node.type === "sticky" || ["shape", "rect", "ellipse", "diamond"].includes(node.type);
  const curFamily = data.fontFamily || "sans";
  const curSize = data.fontSize || (isText || node.type === "sticky" ? 16 : 13);
  const curColor = data.textColor || null;
  const curAlign = data.textAlign || (isText ? "left" : "center");
  const curV = data.vAlign || "middle";

  // Size is a type-or-pick field: keep a local draft, commit on blur / Enter /
  // an exact preset pick (a datalist selection lands on an exact value).
  const [sizeInput, setSizeInput] = useState(String(curSize));
  const [sizeOpen, setSizeOpen] = useState(false);
  useEffect(() => { setSizeInput(String(curSize)); }, [curSize]);
  const commitSize = (v) => {
    const n = Math.max(4, Math.min(400, Math.round(Number(v) || 0)));
    if (n) patchNodeData({ fontSize: n });
  };

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

  return (
    <div className="p-1.5" style={{ width: 234 }}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search fonts…"
        className="w-full px-2 py-1 rounded-md bg-white/10 text-white text-[12px] placeholder:text-white/40 outline-none"
      />
      <div className="nowheel mt-1" style={{ maxHeight: 150, overflowY: "auto" }}>
        {!q && PRESET_OPTIONS.map(([label, val]) => fontRow(label, val))}
        {!q && <div className="h-px my-1 bg-white/10" />}
        {fonts.map((f) => fontRow(f, f))}
        {!fonts.length && <div className="px-2 py-1 text-[12px] text-white/40">No match</div>}
      </div>

      <Label>Size</Label>
      <div className="relative" style={{ width: 118 }}>
        <div className="flex items-center rounded-md bg-white/10">
          <input
            type="text"
            inputMode="numeric"
            value={sizeInput}
            onChange={(e) => setSizeInput(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
            onBlur={() => commitSize(sizeInput)}
            onKeyDown={(e) => { if (e.key === "Enter") { commitSize(sizeInput); e.currentTarget.blur(); } }}
            className="w-12 bg-transparent px-2 py-1 text-white text-[12px] outline-none"
          />
          <span className="text-[11px] text-white/40">px</span>
          <button
            type="button"
            title="Preset sizes"
            onClick={() => setSizeOpen((o) => !o)}
            className="ml-auto px-1.5 py-1 text-white/55 hover:text-white"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
        {sizeOpen && (
          <div
            className="absolute left-0 top-full mt-1 z-10 rounded-md py-1 nowheel"
            style={{ minWidth: 132, maxHeight: 220, overflowY: "auto", background: "#1f2937", border: "1px solid rgba(255,255,255,.1)" }}
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

      <Label>Style &amp; align</Label>
      <div className="flex items-center gap-1">
        {mdBtn(Bold, "**", "Bold (selection, or whole text)")}
        {mdBtn(Italic, "_", "Italic (selection, or whole text)")}
        <div className="w-px h-5 bg-white/10 mx-0.5" />
        {[["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]].map(([v, Icon]) => (
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
        ))}
      </div>

      {withVAlign && (
        <>
          <Label>Vertical</Label>
          <div className="flex gap-1">
            {[["top", "Top"], ["middle", "Mid"], ["bottom", "Bot"]].map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => patchNodeData({ vAlign: v })}
                className={`h-7 flex-1 rounded-md text-[11px] font-semibold transition-colors ${
                  curV === v ? "bg-white/20 text-white" : "text-white/70 hover:bg-white/10"
                }`}
              >{l}</button>
            ))}
          </div>
        </>
      )}

      <Label>Colour</Label>
      <Opt active={!curColor} onClick={() => patchNodeData({ textColor: null })}>Auto (contrast)</Opt>
      <SwatchGrid value={curColor} onPick={(c) => patchNodeData({ textColor: c })} onLive={(c) => patchNodeData({ textColor: c })} />
    </div>
  );
}
