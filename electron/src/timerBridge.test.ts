import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipcHandlers = new Map<string, (...args: any[]) => any>();
const ipcListeners = new Map<string, (...args: any[]) => any>();

vi.mock("electron", () => ({
  BrowserWindow: class BrowserWindow {},
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      ipcHandlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, listener: (...args: any[]) => any) => {
      ipcListeners.set(channel, listener);
    }),
  },
}));

import { installTimerBridge } from "./timerBridge";

function createWindow(id: number) {
  return {
    isDestroyed: () => false,
    webContents: {
      id,
      isDestroyed: () => false,
      send: vi.fn(),
    },
  } as any;
}

describe("installTimerBridge command relay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ipcHandlers.clear();
    ipcListeners.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("waits for the main renderer to acknowledge a popover command", async () => {
    const main = createWindow(1);
    installTimerBridge({
      getMainWindow: () => main,
      getPopoverWindow: () => null,
    });

    const command = ipcHandlers.get("mangodoro:timer:command");
    const resultPromise = command?.({ sender: { id: 2 } }, { method: "toggleRun" });

    expect(main.webContents.send).toHaveBeenCalledWith(
      "mangodoro:timer:command-relay",
      expect.objectContaining({ id: expect.any(String), method: "toggleRun" })
    );
    const relayed = main.webContents.send.mock.calls[0][1];
    ipcListeners.get("mangodoro:timer:command-result")?.(
      { sender: { id: main.webContents.id } },
      { id: relayed.id, ok: true }
    );

    await expect(resultPromise).resolves.toEqual({ ok: true });
  });

  it("reports a timeout when the main renderer does not acknowledge a command", async () => {
    const main = createWindow(1);
    installTimerBridge({
      getMainWindow: () => main,
      getPopoverWindow: () => null,
    });

    const command = ipcHandlers.get("mangodoro:timer:command");
    const resultPromise = command?.({ sender: { id: 2 } }, { method: "toggleRun" });

    await vi.advanceTimersByTimeAsync(1001);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      reason: "main-handler-timeout",
    });
  });
});
