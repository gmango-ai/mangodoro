import { describe, it, expect } from "vitest";
import { reducer } from "./LocalPomodoroProvider";
import { DEFAULT_DURATIONS } from "./constants";

const base = {
  mode: "work",
  sessions: 0,
  isRunning: false,
  deadline: null,
  remaining: DEFAULT_DURATIONS.work,
  completedDeadline: 0,
};

describe("LocalPomodoroProvider reducer (cross-window timer)", () => {
  it("start sets an absolute deadline from the remaining seconds", () => {
    const s = reducer(base, { type: "toggle", now: 1000 });
    expect(s.isRunning).toBe(true);
    expect(s.deadline).toBe(1000 + DEFAULT_DURATIONS.work * 1000);
  });

  it("pause stores the seconds left, derived from the deadline", () => {
    const running = { ...base, isRunning: true, deadline: 100000 };
    const s = reducer(running, { type: "toggle", now: 100000 - 60 * 1000 }); // 60s left
    expect(s.isRunning).toBe(false);
    expect(s.deadline).toBe(null);
    expect(s.remaining).toBe(60);
  });

  it("complete advances work → short break, increments sessions, tags the deadline", () => {
    const running = { ...base, mode: "work", sessions: 0, isRunning: true, deadline: 5000 };
    const s = reducer(running, { type: "complete", deadline: 5000 });
    expect(s.mode).toBe("shortBreak");
    expect(s.sessions).toBe(1);
    expect(s.isRunning).toBe(false);
    expect(s.completedDeadline).toBe(5000);
    expect(s.remaining).toBe(DEFAULT_DURATIONS.shortBreak);
  });

  it("complete is idempotent — a repeat for the cleared deadline is a no-op", () => {
    const running = { ...base, mode: "work", sessions: 0, isRunning: true, deadline: 5000 };
    const once = reducer(running, { type: "complete", deadline: 5000 });
    const twice = reducer(once, { type: "complete", deadline: 5000 });
    expect(twice).toBe(once); // same reference → no second advance
    expect(twice.sessions).toBe(1); // not 2, even if two windows both fire
  });

  it("every 4th work completion is a long break", () => {
    const running = { ...base, mode: "work", sessions: 3, isRunning: true, deadline: 5000 };
    const s = reducer(running, { type: "complete", deadline: 5000 });
    expect(s.sessions).toBe(4);
    expect(s.mode).toBe("longBreak");
  });

  it("adopt mirrors another window's running state", () => {
    const s = reducer(base, {
      type: "adopt",
      payload: { mode: "shortBreak", sessions: 2, running: true, deadline: 9000, remaining: 300 },
    });
    expect(s.mode).toBe("shortBreak");
    expect(s.sessions).toBe(2);
    expect(s.isRunning).toBe(true);
    expect(s.deadline).toBe(9000);
  });

  it("adopt is a no-op when nothing changed (prevents broadcast feedback loops)", () => {
    const running = { ...base, mode: "work", sessions: 1, isRunning: true, deadline: 9000, remaining: 1500 };
    const s = reducer(running, {
      type: "adopt",
      payload: { mode: "work", sessions: 1, running: true, deadline: 9000, remaining: 1500 },
    });
    expect(s).toBe(running); // same reference → no re-render, no re-broadcast
  });
});
