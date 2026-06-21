import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const playCompletionSoundMock = vi.fn().mockResolvedValue(undefined);
const warmupAudioContextMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../../lib/pomodoroSound.js", () => ({
  loadPomodoroSoundSettings: vi.fn(() => ({
    volume: 0.75,
    workEndPreset: "chime",
    breakEndPreset: "beep",
    pitch: 1,
    repeat: 1,
    repeatGapMs: 600,
  })),
  playCompletionSound: (...args) => playCompletionSoundMock(...args),
  stopCompletionSound: vi.fn(),
  warmupAudioContext: (...args) => warmupAudioContextMock(...args),
}));

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

vi.mock("../../supabase.js", () => {
  function chain() {
    const c = {
      select: vi.fn(),
      eq: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: {}, error: null }),
    };
    c.select.mockReturnValue(c);
    c.eq.mockReturnValue(c);
    c.upsert.mockReturnValue(c);
    c.update.mockReturnValue(c);
    return c;
  }
  return {
    supabase: {
      from: vi.fn(() => chain()),
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
      rpc: vi.fn(),
      removeChannel: vi.fn(),
    },
  };
});

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

describe("PomodoroEngine phase alarms", () => {
  let lsStore;

  beforeEach(() => {
    vi.clearAllMocks();
    lsStore = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k) => lsStore.get(k) ?? null,
      setItem: (k, v) => lsStore.set(k, v),
      removeItem: (k) => lsStore.delete(k),
    });
    tabLeaderMock.getIsLeader.mockReturnValue(false);
  });

  afterEach(() => {
    lsStore.clear();
    vi.unstubAllGlobals();
  });

  it("plays work-end alarm when follower snapshot transitions work to break", async () => {
    const engine = new PomodoroEngine("test-user-id");
    engine.attach({ forceSlave: true });
    engine._state.mode = "work";
    engine._state.sessions = 1;
    engine._state.pendingMode = null;
    engine._refs.endsAtMsRef.current = 1000;

    engine._applyFollowerSnapshot({
      mode: "shortBreak",
      sessions: 1,
      pendingMode: null,
      isRunning: true,
      secondsLeft: 300,
      endsAtMs: 2000,
    });

    await vi.waitFor(() => {
      expect(playCompletionSoundMock).toHaveBeenCalledTimes(1);
    });
    expect(playCompletionSoundMock.mock.calls[0][1]).toMatchObject({ event: "work" });
    engine.detach();
  });

  it("does NOT play alarm on a follower MANUAL switch (deadline still in the future)", async () => {
    const engine = new PomodoroEngine("test-user-id");
    engine.attach({ forceSlave: true });
    engine._state.mode = "work";
    engine._state.sessions = 1;
    engine._state.pendingMode = null;
    // Deadline well in the future → the work timer was still running, so a
    // transition to break is a manual switch, not a completion.
    engine._refs.endsAtMsRef.current = Date.now() + 600000;

    engine._applyFollowerSnapshot({
      mode: "shortBreak",
      sessions: 1,
      pendingMode: null,
      isRunning: false,
      secondsLeft: 300,
      endsAtMs: null,
    });

    await Promise.resolve();
    expect(playCompletionSoundMock).not.toHaveBeenCalled();
    engine.detach();
  });

  it("dedupes alarm when the same key is claimed twice", async () => {
    const engine = new PomodoroEngine("test-user-id");
    const key = "work-1-none-1000-work";
    await engine._tryPlayPhaseAlarm("work", key);
    await engine._tryPlayPhaseAlarm("work", key);
    expect(playCompletionSoundMock).toHaveBeenCalledTimes(1);
  });

  it("plays sync alarm optimistically before sync_tick_if_due", async () => {
    tabLeaderMock.getIsLeader.mockReturnValue(true);
    supabase.rpc.mockResolvedValue({ data: { session: null }, error: null });

    const engine = new PomodoroEngine("test-user-id");
    engine.configure({
      syncSession: { id: "session-1", controller_id: "test-user-id" },
    });
    engine._leaderLifecycleActive = true;
    engine._state.isRunning = true;
    engine._state.secondsLeft = 0;
    engine._state.mode = "work";
    engine._refs.modeRef.current = "work";
    engine._refs.endsAtMsRef.current = Date.now();

    engine._runCompletionCheck();

    expect(playCompletionSoundMock).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("sync_tick_if_due", {
      p_session_id: "session-1",
    });
  });

  it("does not double-play sync alarm after Realtime phase apply", async () => {
    const engine = new PomodoroEngine("test-user-id");
    engine.configure({ syncSession: { id: "session-1" } });
    const prevPhase = "work-0-none-paused";
    engine._refs.lastAlarmKeyPlayedRef.current = `${prevPhase}-work`;
    engine._state.mode = "shortBreak";

    // Expired deadline so the completion gate passes and we actually reach the
    // dedup check (which is what this test asserts).
    await engine._maybePlaySyncPhaseSound("work", prevPhase, Date.now() - 1000);

    expect(playCompletionSoundMock).not.toHaveBeenCalled();
  });
});

describe("PomodoroEngine wall-clock completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    tabLeaderMock.getIsLeader.mockReturnValue(true);
    vi.stubGlobal("document", {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.spyOn(PomodoroEngine.prototype, "_runCompletionCheck").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("schedules and fires wall-clock completion at endsAtMs", () => {
    const engine = new PomodoroEngine("test-user-id");
    engine._leaderLifecycleActive = true;
    engine._state.isRunning = true;
    engine._state.secondsLeft = 5;
    const onDue = vi.spyOn(engine, "_onWallClockDue");
    const t0 = 1_000_000;
    vi.setSystemTime(t0);
    engine._refs.endsAtMsRef.current = t0 + 3000;

    engine._scheduleCompletionTimeout();
    vi.advanceTimersByTime(3000);

    expect(onDue).toHaveBeenCalled();
  });

  it("sets secondsLeft to zero when past deadline", () => {
    const engine = new PomodoroEngine("test-user-id");
    engine._leaderLifecycleActive = true;
    engine._state.isRunning = true;
    engine._state.secondsLeft = 5;
    const setFieldSpy = vi.spyOn(engine, "_setField");
    const t0 = 2_000_000;
    vi.setSystemTime(t0 + 5000);
    engine._refs.endsAtMsRef.current = t0 + 3000;

    engine._onWallClockDue();

    expect(setFieldSpy).toHaveBeenCalledWith("secondsLeft", 0);
  });
});
