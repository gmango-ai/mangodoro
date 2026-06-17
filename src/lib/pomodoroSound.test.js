import { describe, expect, it, vi } from "vitest";

const { resumeMock } = vi.hoisted(() => {
  const resumeMock = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("window", {
    AudioContext: vi.fn(function MockAudioContext() {
      this.state = "suspended";
      this.sampleRate = 44100;
      this.currentTime = 0;
      this.destination = {};
      this.resume = resumeMock;
      this.createBuffer = vi.fn(() => ({}));
      this.createBufferSource = vi.fn(() => ({
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        buffer: null,
      }));
      this.createGain = vi.fn(() => ({ gain: { value: 0 }, connect: vi.fn() }));
      this.createOscillator = vi.fn(() => ({
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        frequency: {
          value: 0,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
        },
        type: "triangle",
      }));
    }),
    webkitAudioContext: undefined,
  });
  return { resumeMock };
});

import {
  isCustomPresetId,
  playCompletionSound,
  resolveCustomSound,
  USER_SOUND_PREFIX,
  warmupAudioContext,
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

  it("warms up audio context when playing completion sound", async () => {
    resumeMock.mockClear();
    await warmupAudioContext();
    expect(resumeMock).toHaveBeenCalled();
    resumeMock.mockClear();
    await playCompletionSound();
    expect(resumeMock).toHaveBeenCalled();
  });
});
