import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tabLeaderMock = {
  start: vi.fn(),
  stop: vi.fn(),
  broadcastState: vi.fn(),
  sendCommand: vi.fn(),
  getIsLeader: vi.fn(() => false),
  forceLeader: vi.fn(),
  forceFollower: vi.fn(),
};

vi.mock("./tabLeader.js", () => ({
  createTabLeader: vi.fn(() => tabLeaderMock),
}));

vi.mock("./electronTimerBridge.js", () => ({
  createElectronTimerBridge: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    broadcastState: vi.fn(),
    sendCommand: vi.fn(() => false),
    isSlave: false,
    isMain: false,
  })),
  isElectronPopover: vi.fn(() => false),
}));

vi.mock("../../supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    rpc: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

import { supabase } from "../../supabase.js";
import { destroyEngine, getEngine } from "./createEngine.js";
import { PomodoroEngine } from "./PomodoroEngine.js";

function mockSyncSessionSelect(row) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  const eqStatus = vi.fn().mockReturnValue({ maybeSingle });
  const eqId = vi.fn().mockReturnValue({ eq: eqStatus });
  const select = vi.fn().mockReturnValue({ eq: eqId });
  supabase.from.mockReturnValue({ select });
  return { select, eqId, eqStatus, maybeSingle };
}

const freshDbRow = {
  id: "session-1",
  mode: "work",
  sessions: 2,
  is_running: true,
  remaining_seconds: 900,
  pending_mode: null,
  ends_at: new Date(Date.now() + 900_000).toISOString(),
  updated_at: new Date().toISOString(),
};

const staleReactRow = {
  id: "session-1",
  mode: "shortBreak",
  sessions: 0,
  is_running: false,
  remaining_seconds: 300,
  pending_mode: null,
};

describe("PomodoroEngine wire snapshot", () => {
  it("is structuredClone-safe with no function values", () => {
    const engine = new PomodoroEngine("test-user-id");
    const wire = engine._getWireSnapshot();

    for (const value of Object.values(wire)) {
      expect(typeof value).not.toBe("function");
    }

    expect(() => structuredClone(wire)).not.toThrow();
  });

  it("full getSnapshot includes command methods not present on wire snapshot", () => {
    const engine = new PomodoroEngine("test-user-id");
    const full = engine.getSnapshot();
    const wire = engine._getWireSnapshot();

    expect(typeof full.toggleRun).toBe("function");
    expect(wire.toggleRun).toBeUndefined();
  });
});

describe("PomodoroEngine sync hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tabLeaderMock.getIsLeader.mockReturnValue(false);
  });

  it("_hydrateSync fetches from DB instead of applying stale React syncSession", async () => {
    mockSyncSessionSelect(freshDbRow);
    const engine = new PomodoroEngine("test-user-id");
    engine.configure({ syncSession: staleReactRow });

    await engine._hydrateSync();

    expect(supabase.from).toHaveBeenCalledWith("sync_sessions");
    expect(engine._state.mode).toBe("work");
    expect(engine._state.sessions).toBe(2);
    expect(engine._state.isRunning).toBe(true);
  });

  it("configure hydrates follower when sync session appears after attach", async () => {
    mockSyncSessionSelect(freshDbRow);
    const engine = new PomodoroEngine("test-user-id");
    engine.attach({ forceSlave: true });
    tabLeaderMock.getIsLeader.mockReturnValue(false);

    engine.configure({ syncSession: staleReactRow });
    await vi.waitFor(() => {
      expect(supabase.from).toHaveBeenCalledWith("sync_sessions");
    });

    engine.detach();
  });
});

describe("PomodoroEngine leader lifecycle", () => {
  let setIntervalSpy;
  let clearIntervalSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    tabLeaderMock.getIsLeader.mockReturnValue(true);
    mockSyncSessionSelect(null);
    vi.stubGlobal("document", {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("starts sync tick poll only when leader lifecycle is active", () => {
    const engine = new PomodoroEngine("test-user-id");
    engine.configure({ syncSession: { id: "session-1", controller_id: "test-user-id" } });
    engine.attach();

    const pollCallsBefore = setIntervalSpy.mock.calls.length;
    expect(pollCallsBefore).toBeGreaterThan(0);

    engine._stopLeaderLifecycle();
    expect(clearIntervalSpy).toHaveBeenCalled();
    engine.detach();
  });

  it("follower attach does not start sync tick poll before leader promotion", () => {
    tabLeaderMock.getIsLeader.mockReturnValue(false);
    const engine = new PomodoroEngine("test-user-id");
    engine.configure({ syncSession: { id: "session-1" } });

    setIntervalSpy.mockClear();
    engine.attach({ forceSlave: true });

    expect(setIntervalSpy).not.toHaveBeenCalled();
    engine.detach();
  });
});

describe("PomodoroEngine attach/detach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tabLeaderMock.getIsLeader.mockReturnValue(false);
    destroyEngine();
  });

  it("detach tears down tab leader and resets refCount", () => {
    const engine = getEngine("user-a");
    engine.attach({ forceSlave: true });
    expect(engine._refCount).toBe(1);

    engine.detach();
    expect(engine._refCount).toBe(0);
    expect(tabLeaderMock.stop).toHaveBeenCalled();
  });

  it("destroyEngine clears the singleton after detach", () => {
    const engine = getEngine("user-a");
    engine.attach({ forceSlave: true });
    engine.detach();
    destroyEngine();

    const next = getEngine("user-a");
    expect(next).not.toBe(engine);
    expect(next._refCount).toBe(0);
  });
});
