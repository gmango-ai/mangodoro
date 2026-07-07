import { useState } from "react";
import { Plus } from "lucide-react";
import { EMOTES, PRESET_GLYPHS } from "./presets";
import FullEmojiPicker from "./FullEmojiPicker";

// The grow + amber glow on the button currently being charge-held.
function chargeStyleFor(charge, glyph) {
  if (charge?.glyph !== glyph) return undefined;
  const l = charge.level;
  return {
    transform: `scale(${1 + 0.45 * l})`,
    boxShadow: `0 0 ${10 + 28 * l}px rgba(250,204,21,${0.4 + 0.5 * l})`,
    transition: "transform 60ms linear, box-shadow 60ms linear",
    position: "relative",
    zIndex: 1,
  };
}

// The ONE reactions bar, shared by every surface (whiteboard, video call
// toolbar, Jitsi floating bar). It is purely presentational: the charge /
// send / channel engine lives in EmoteOverlay and is handed in via props, so
// the six presets, recents, the "+ more" picker, and the charge glow are
// identical everywhere and only have to be maintained once.
//
// Props:
//   recents     glyph[]  — recently-used emojis (insertion/first-use order)
//   charge      { glyph, level } | null — current hold-charge, for the glow
//   onEmit(glyph, ev, key)  — pointer-down; drives tap / hold-burst / stream
//   onPick(glyph)           — a single emoji chosen from the full picker
//   orientation "row" | "column"
//   btn         number     — button size in px (presets row scales to it)
//   dark        boolean    — picker theme
export default function EmoteBar({
  recents = [],
  charge,
  onEmit,
  onPick,
  orientation = "row",
  btn = 40,
  dark = false,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const column = orientation === "column";

  const quick = [
    ...EMOTES.map((e) => ({ glyph: e.glyph, key: e.key, label: e.key })),
    ...recents
      .filter((g) => !PRESET_GLYPHS.has(g))
      .slice(0, 6)
      .map((g) => ({ glyph: g, key: undefined, label: g })),
  ];
  const fontSize = Math.round(btn * 0.55);
  const plus = Math.round(btn * 0.42);

  return (
    <div
      // select-none + touch-callout:none so long-pressing an emote (to charge
      // a burst) doesn't select the glyph as text or pop the iOS callout menu.
      className={`relative inline-flex ${column ? "flex-col" : "items-center"} gap-0.5 p-1.5 rounded-full select-none [-webkit-touch-callout:none]`}
      style={{ background: "#0f172a", boxShadow: "0 16px 36px -12px rgba(0,0,0,.5)" }}
    >
      {quick.map((emo) => (
        <button
          key={emo.glyph}
          type="button"
          onPointerDown={(e) => onEmit?.(emo.glyph, e, emo.key)}
          title={`${emo.label} — tap, hold for a burst, keep holding for a stream`}
          aria-label={`Send ${emo.label} emote`}
          className="rounded-full flex items-center justify-center hover:bg-white/15 touch-none"
          style={{ width: btn, height: btn, fontSize, ...chargeStyleFor(charge, emo.glyph) }}
        >
          <span>{emo.glyph}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        className="rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/15"
        style={{ width: btn, height: btn }}
        title="More emojis"
        aria-label="Pick any emoji"
        aria-expanded={pickerOpen}
      >
        <Plus style={{ width: plus, height: plus }} />
      </button>

      {pickerOpen && (
        <>
          <div className="fixed inset-0 z-10" onPointerDown={() => setPickerOpen(false)} />
          <div
            className="absolute z-20 rounded-xl overflow-hidden"
            style={{
              boxShadow: "0 16px 36px -12px rgba(0,0,0,.5)",
              ...(column
                ? { right: "100%", marginRight: 8, bottom: 0 }
                : { left: "50%", transform: "translateX(-50%)", bottom: "100%", marginBottom: 8 }),
            }}
          >
            <FullEmojiPicker dark={dark} onPick={(g) => { onPick?.(g); setPickerOpen(false); }} />
          </div>
        </>
      )}
    </div>
  );
}
