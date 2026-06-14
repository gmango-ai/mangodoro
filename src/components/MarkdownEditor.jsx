import { useEffect, useRef } from "react";
import { EditorView, keymap, drawSelection, highlightActiveLine } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle, defaultHighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// Markdown editor that renders syntax inline as you type — similar to
// Obsidian's "Source mode". Bold appears bolder, headings get larger,
// links and code are styled distinctly. We don't hide the syntax
// characters (Obsidian Live Preview does this via decorations) because
// that's a much bigger investment; this stays clearly an "editor" while
// communicating the formatting visually.
//
// CodeMirror 6 stack — heavier than a textarea but tree-shaken to ~30KB
// gz for what we use. No preview pane needed.

// Custom highlight: scale + weight tweaks so the formatting reads
// inline. Light + dark theming handled separately below.
const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.6em", fontWeight: "700", lineHeight: 1.3 },
  { tag: t.heading2, fontSize: "1.35em", fontWeight: "700", lineHeight: 1.3 },
  { tag: t.heading3, fontSize: "1.15em", fontWeight: "600" },
  { tag: t.heading4, fontSize: "1.05em", fontWeight: "600" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, textDecoration: "underline" },
  { tag: t.url, opacity: 0.7 },
  { tag: t.monospace, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.92em" },
  { tag: t.quote, fontStyle: "italic", opacity: 0.85 },
  // Syntax marks (the * # etc.) — keep them visible but muted.
  { tag: t.processingInstruction, opacity: 0.45 },
  { tag: t.contentSeparator, opacity: 0.4 },
]);

function makeTheme(dark) {
  return EditorView.theme(
    {
      "&": {
        background: "transparent",
        color: dark ? "#e2e8f0" : "#1e293b",
        fontSize: "14px",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto",
      },
      ".cm-scroller": {
        fontFamily: "inherit",
        lineHeight: "1.55",
      },
      ".cm-content": {
        padding: "10px 12px",
        caretColor: "var(--color-accent)",
      },
      "&.cm-focused": { outline: "none" },
      ".cm-line": { padding: "0" },
      ".cm-activeLine": { background: "transparent" },
      "&.cm-focused .cm-activeLine": {
        background: dark ? "rgba(148, 163, 184, 0.08)" : "rgba(15, 23, 42, 0.03)",
      },
      ".cm-cursor": { borderLeftColor: "var(--color-accent)" },
      "::selection": { background: "color-mix(in srgb, var(--color-accent) 30%, transparent)" },
      ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
        background: "color-mix(in srgb, var(--color-accent) 30%, transparent)",
      },
    },
    { dark }
  );
}

export default function MarkdownEditor({
  value,
  onChange,
  dark = false,
  placeholder = "",
  minHeight = "120px",
  autoFocus = false,
  className = "",
}) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const themeCompartment = useRef(new Compartment());

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // Build the editor once. Value changes are pushed in via the next
  // effect; theme swaps through the compartment so we don't tear it
  // down on theme toggle.
  useEffect(() => {
    if (!hostRef.current) return;
    const state = EditorState.create({
      doc: value || "",
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        markdown({ base: markdownLanguage, addKeymap: true }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        syntaxHighlighting(markdownHighlight),
        themeCompartment.current.of(makeTheme(dark)),
        EditorView.updateListener.of((v) => {
          if (v.docChanged) {
            const next = v.state.doc.toString();
            onChangeRef.current?.(next);
          }
        }),
        EditorView.contentAttributes.of({
          "aria-label": "Markdown editor",
          ...(placeholder ? { "data-placeholder": placeholder } : {}),
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    if (autoFocus) {
      // Defer so the parent container has settled and the focus call
      // actually lands the caret in the visible doc.
      requestAnimationFrame(() => view.focus());
    }
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push external value changes (controlled-ish). We only replace the
  // doc when it actually differs from what the editor holds, so the
  // user's caret position survives every render.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value || "" } });
    }
  }, [value]);

  // Swap theme without rebuilding the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: themeCompartment.current.reconfigure(makeTheme(dark)) });
  }, [dark]);

  return (
    <div
      ref={hostRef}
      className={`rounded-lg border overflow-hidden ${
        dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
      } ${className}`}
      style={{ minHeight }}
    />
  );
}
