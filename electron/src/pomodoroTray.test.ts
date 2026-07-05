import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getAppPath: vi.fn(() => "/tmp/mangodoro"),
    whenReady: vi.fn(() => Promise.resolve()),
  },
  BrowserWindow: class BrowserWindow {},
  Menu: { buildFromTemplate: vi.fn((template) => template) },
  nativeImage: {
    createEmpty: vi.fn(() => ({ isEmpty: () => true })),
    createFromPath: vi.fn(() => ({
      isEmpty: () => false,
      setTemplateImage: vi.fn(),
    })),
  },
  Tray: class Tray {},
  ipcMain: {
    handle: vi.fn(),
  },
}));

import { formatTrayTitle } from "./pomodoroTray";

describe("formatTrayTitle", () => {
  it("prefixes focus and break countdowns with distinct symbols", () => {
    expect(formatTrayTitle("work", 256_000)).toBe("● 4:16");
    expect(formatTrayTitle("shortBreak", 256_000)).toBe("○ 4:16");
    expect(formatTrayTitle("longBreak", 856_000)).toBe("○ 14:16");
  });
});
