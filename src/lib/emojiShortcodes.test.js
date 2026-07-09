import { describe, it, expect } from "vitest";
import { expandEmojiShortcodes, expandShortcodesAtCaret, searchShortcodes } from "./emojiShortcodes";

describe("expandEmojiShortcodes", () => {
  it("replaces known :codes: and leaves unknown ones", () => {
    expect(expandEmojiShortcodes("hi :smile: there")).toBe("hi 🙂 there");
    expect(expandEmojiShortcodes(":+1: :fire:")).toBe("👍 🔥");
    expect(expandEmojiShortcodes(":notacode: ok")).toBe(":notacode: ok");
  });
  it("no-ops when there's no colon", () => {
    expect(expandEmojiShortcodes("plain text")).toBe("plain text");
  });
});

describe("expandShortcodesAtCaret", () => {
  it("expands what's completed before the caret and shifts the caret", () => {
    const s = "yo :fire:";
    const { value, caret } = expandShortcodesAtCaret(s, s.length);
    expect(value).toBe("yo 🔥");
    expect(caret).toBe(value.length);
  });
  it("leaves an unclosed code alone", () => {
    const s = "yo :fir";
    expect(expandShortcodesAtCaret(s, s.length)).toEqual({ value: s, caret: s.length });
  });
});

describe("searchShortcodes", () => {
  it("returns matches, prefix-first, de-duped by glyph", () => {
    const r = searchShortcodes("fire");
    expect(r[0]).toEqual({ code: "fire", emoji: "🔥" });
    expect(searchShortcodes("")).toEqual([]);
  });
});
