import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { expandShortcodesAtCaret, searchShortcodes } from "../lib/emojiShortcodes";

// Drop-in <input>/<textarea> with Discord-style :emoji: shortcodes everywhere:
//   • live expansion the moment you close a known :code: (caret preserved),
//   • an autocomplete popover as you type ":sm…" (Enter / click to insert).
//
// It's a near-transparent replacement for a native field:
//   • pass `multiline` for a <textarea>, otherwise it's an <input>;
//   • `onChange` is called with a synthetic { target: { value } } so existing
//     `(e) => setX(e.target.value)` handlers work unchanged;
//   • the popover is PORTALED and positioned off the field's rect, so wrapping
//     this around any field never disturbs the surrounding layout.
//
// Set `disableAutocomplete` to keep only the live/paste expansion (e.g. tight
// fields where a popover would be noise) — expansion on send should also be done
// with expandEmojiShortcodes(value) at the call site as a safety net.
const EMOJI_RE = /:([a-z0-9_+-]{2,})$/i;

const EmojiTextField = forwardRef(function EmojiTextField(
  { value, onChange, onKeyDown, onBlur, multiline = false, component, disableAutocomplete = false, popoverWidth = 224, ...rest },
  ref,
) {
  const innerRef = useRef(null);
  const activeItemRef = useRef(null);
  useImperativeHandle(ref, () => innerRef.current, []);
  const [emojiQ, setEmojiQ] = useState(null);
  const [rect, setRect] = useState(null);
  const [activeIdx, setActiveIdx] = useState(0);

  // Show ALL matches (the list scrolls); no artificial cap.
  const matches = useMemo(
    () => (disableAutocomplete || emojiQ == null ? [] : searchShortcodes(emojiQ, Infinity)),
    [emojiQ, disableAutocomplete],
  );

  // Restart the highlight at the top whenever the query changes.
  useEffect(() => { setActiveIdx(0); }, [emojiQ]);
  // Keep the highlighted row visible as you arrow through a long list.
  useEffect(() => { activeItemRef.current?.scrollIntoView({ block: "nearest" }); }, [activeIdx]);

  useLayoutEffect(() => {
    if (matches.length && innerRef.current) setRect(innerRef.current.getBoundingClientRect());
    else setRect(null);
  }, [matches.length, emojiQ]);

  // Synthetic event carries selectionStart too, so callers doing @-mention /
  // caret work off e.target keep working through this wrapper.
  const emit = (v, sel) => onChange?.({ target: { value: v, selectionStart: sel } });

  const handleChange = (e) => {
    const raw = e.target.value;
    const caret = e.target.selectionStart ?? raw.length;
    const { value: v, caret: c } = expandShortcodesAtCaret(raw, caret);
    if (v !== raw && innerRef.current) {
      requestAnimationFrame(() => { try { innerRef.current.setSelectionRange(c, c); } catch { /* */ } });
    }
    emit(v, c);
    if (!disableAutocomplete) {
      const upto = v.slice(0, c);
      const m = upto.match(/(?:^|\s):([a-z0-9_+-]{2,})$/i);
      setEmojiQ(m ? m[1] : null);
    }
  };

  const pick = (emoji) => {
    const el = innerRef.current;
    const caret = el?.selectionStart ?? (value || "").length;
    const before = (value || "").slice(0, caret).replace(EMOJI_RE, `${emoji} `);
    const next = before + (value || "").slice(caret);
    emit(next, before.length);
    setEmojiQ(null);
    requestAnimationFrame(() => { try { el?.focus(); const p = before.length; el?.setSelectionRange(p, p); } catch { /* */ } });
  };

  const handleKeyDown = (e) => {
    if (matches.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => (i + 1) % matches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => (i - 1 + matches.length) % matches.length); return; }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") { e.preventDefault(); pick(matches[activeIdx]?.emoji || matches[0].emoji); return; }
      if (e.key === "Escape") { e.preventDefault(); setEmojiQ(null); return; }
    }
    onKeyDown?.(e);
  };

  // Render a native field by default, or wrap a passed component (e.g. the app's
  // <Input>/<Textarea>) so their styling is preserved — they forward the ref to
  // the DOM node, which is what we need for caret handling.
  const Tag = component || (multiline ? "textarea" : "input");

  // Flip below the field when it sits too near the top of the viewport.
  const below = rect && rect.top < 240;
  const left = rect ? Math.max(8, Math.min(rect.left, window.innerWidth - popoverWidth - 8)) : 0;

  return (
    <>
      <Tag
        ref={innerRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={(e) => { setTimeout(() => setEmojiQ(null), 120); onBlur?.(e); }}
        {...rest}
      />
      {rect && matches.length > 0 && createPortal(
        <div
          style={{
            position: "fixed",
            left,
            top: below ? rect.bottom + 4 : rect.top - 4,
            transform: below ? "none" : "translateY(-100%)",
            width: popoverWidth,
            zIndex: 1000,
          }}
          className="max-h-52 overflow-y-auto rounded-xl border shadow-lg bg-white dark:bg-[var(--color-surface)] border-slate-200 dark:border-[var(--color-border)]"
        >
          {matches.map((em, i) => (
            <button
              key={em.code}
              ref={i === activeIdx ? activeItemRef : null}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(em.emoji); }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm ${
                i === activeIdx ? "bg-slate-100 dark:bg-white/10" : ""
              } text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10`}
            >
              <span className="text-base leading-none">{em.emoji}</span>
              <span className="text-slate-400">:{em.code}:</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
});

export default EmojiTextField;
