import { describe, expect, it } from "vitest";
import {
  isCustomPresetId,
  resolveCustomSound,
  USER_SOUND_PREFIX,
} from "./pomodoroSound.js";

describe("pomodoroSound", () => {
  it("detects custom preset ids", () => {
    expect(isCustomPresetId("custom")).toBe(true);
    expect(isCustomPresetId(`${USER_SOUND_PREFIX}abc`)).toBe(true);
    expect(isCustomPresetId("chime")).toBe(false);
  });

  it("resolves user sound by preset id", () => {
    const map = {
      [`${USER_SOUND_PREFIX}x`]: { url: "https://example.com/a.mp3", name: "Mine" },
    };
    expect(resolveCustomSound(`${USER_SOUND_PREFIX}x`, map, null)?.url).toBe(
      "https://example.com/a.mp3"
    );
  });
});
