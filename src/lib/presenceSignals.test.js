import { describe, it, expect } from "vitest";
import { buildSignals } from "./presenceSignals";
import { resolveStatus } from "./statusResolver";

const NOW = 1_800_000_000_000;

describe("buildSignals", () => {
  it("maps a clocked-in lunch break", () => {
    const sig = buildSignals({
      clockIn: { start: "09:00", activeBreak: { start: "12:00", kind: "lunch" } },
      now: NOW,
    });
    expect(sig.clock).toEqual({ clockedIn: true, onBreak: true, breakKind: "lunch" });
  });

  it("maps currentTask to a task activity with an epoch since", () => {
    const sig = buildSignals({
      currentTask: { id: "t1", description: "Fix auth bug", started_at: "2027-01-15T09:00:00.000Z" },
      now: NOW,
    });
    expect(sig.activity).toMatchObject({ kind: "task", label: "Fix auth bug" });
    expect(sig.activity.since).toBe(Date.parse("2027-01-15T09:00:00.000Z"));
  });

  it("null clock / no task / no room produce nulls", () => {
    const sig = buildSignals({ now: NOW });
    expect(sig.clock).toBeNull();
    expect(sig.activity).toBeNull();
    expect(sig.room).toBeNull();
  });

  it("computes idleMs from lastActivityMs", () => {
    const sig = buildSignals({ lastActivityMs: NOW - 60_000, now: NOW });
    expect(sig.idleMs).toBe(60_000);
  });

  it("passes room kind through", () => {
    const sig = buildSignals({ room: { id: "r", name: "Standup", kind: "meeting" }, now: NOW });
    expect(sig.room).toEqual({ id: "r", name: "Standup", kind: "meeting" });
  });

  // Composition: buildSignals → resolveStatus end-to-end.
  it("end-to-end: meeting room resolves to in_meeting", () => {
    const sig = buildSignals({ room: { id: "r", name: "Standup", kind: "meeting" }, online: true, now: NOW });
    expect(resolveStatus(sig).availability).toBe("in_meeting");
  });

  it("end-to-end: pomodoro work sprint in a general room resolves to focusing", () => {
    const sig = buildSignals({
      room: { id: "g", name: "General", kind: "general" },
      pomodoro: { isRunning: true, mode: "work" },
      online: true,
      now: NOW,
    });
    expect(resolveStatus(sig).availability).toBe("focusing");
  });

  it("end-to-end: clocked in, idle past ambient threshold resolves to away", () => {
    const sig = buildSignals({
      clockIn: { start: "09:00" },
      lastActivityMs: NOW - 6 * 60 * 1000, // 6m idle
      online: true,
      now: NOW,
    });
    expect(resolveStatus(sig).availability).toBe("away");
  });
});
