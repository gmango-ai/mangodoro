import { describe, it, expect } from "vitest";
import { resolveStatus, AMBIENT_IDLE_MS, FOCUS_IDLE_MS } from "./statusResolver";

const NOW = 1_800_000_000_000; // fixed epoch for determinism

// Convenience: resolve with a fixed `now` unless overridden.
const r = (sig) => resolveStatus({ now: NOW, ...sig });

describe("resolveStatus — environmental priority stack", () => {
  it("a meeting-mode room reads as in_meeting", () => {
    const s = r({ room: { id: "r1", name: "Standup", kind: "meeting" }, online: true });
    expect(s.availability).toBe("in_meeting");
    expect(s.light).toBe("red");
    expect(s.location).toEqual({ kind: "room", roomId: "r1", roomName: "Standup", roomKind: "meeting" });
  });

  it("calendar meeting outranks a general room", () => {
    const s = r({ calendar: { title: "Design review" }, room: { kind: "general" } });
    expect(s.availability).toBe("in_meeting");
  });

  it("car Bluetooth reads as commuting", () => {
    expect(r({ carBluetooth: true, online: true }).availability).toBe("commuting");
  });

  it("lunch break reads as lunch; other breaks read as away", () => {
    expect(r({ clock: { onBreak: true, breakKind: "lunch" } }).availability).toBe("lunch");
    expect(r({ clock: { onBreak: true } }).availability).toBe("away");
  });

  it("clocked out reads as off", () => {
    expect(r({ clock: { clockedOut: true }, online: true }).availability).toBe("off");
  });

  it("an active pomodoro work sprint reads as focusing", () => {
    const s = r({ pomodoro: { running: true, mode: "work" }, room: { kind: "general" }, online: true });
    expect(s.availability).toBe("focusing");
    expect(s.light).toBe("red");
  });

  it("a pomodoro break does NOT force focusing", () => {
    const s = r({ pomodoro: { running: true, mode: "shortBreak" }, room: { kind: "general" }, online: true });
    expect(s.availability).toBe("available");
  });

  it("a focus-mode room reads as focusing", () => {
    expect(r({ room: { kind: "focus" }, online: true }).availability).toBe("focusing");
  });

  it("break / social rooms bias to available", () => {
    expect(r({ room: { kind: "break" }, online: true }).availability).toBe("available");
    expect(r({ room: { kind: "social" }, online: true }).availability).toBe("available");
  });

  it("no signal at all is offline", () => {
    expect(r({}).availability).toBe("offline");
    expect(r({ online: false }).availability).toBe("offline");
  });

  it("bare online (tab open, nothing else) is available", () => {
    expect(r({ online: true }).availability).toBe("available");
  });
});

describe("resolveStatus — general-room per-person ladder (Q3)", () => {
  const room = { id: "g", name: "General", kind: "general" };

  it("pomodoro > pairing > available", () => {
    expect(r({ room, pomodoro: { running: true, mode: "work" }, pairingWith: { name: "Al" } }).availability).toBe("focusing");
    expect(r({ room, pairingWith: { name: "Al" } }).availability).toBe("pairing");
    expect(r({ room, clock: { clockedIn: true } }).availability).toBe("available");
  });

  it("pairing is yellow and carries a 'Pairing with X' activity", () => {
    const s = r({ room, pairingWith: { name: "Alice", since: NOW - 1000 } });
    expect(s.availability).toBe("pairing");
    expect(s.light).toBe("yellow");
    expect(s.activity).toMatchObject({ kind: "pairing", label: "Pairing with Alice" });
  });
});

describe("resolveStatus — manual override wins", () => {
  it("override beats every derived signal", () => {
    const s = r({
      override: { availability: "focusing", message: "Deep work til 3" },
      room: { kind: "meeting" },
      calendar: { title: "x" },
    });
    expect(s.availability).toBe("focusing");
    expect(s.source).toBe("override");
    expect(s.override).toMatchObject({ availability: "focusing", message: "Deep work til 3" });
  });

  it("an expired override is ignored", () => {
    const s = r({
      override: { availability: "lunch", expiresAt: NOW - 1 },
      room: { kind: "meeting" },
    });
    expect(s.availability).toBe("in_meeting");
    expect(s.source).toBe("derived");
  });

  it("an unexpired override with a future expiry still wins", () => {
    const s = r({ override: { availability: "commuting", expiresAt: NOW + 60_000 }, online: true });
    expect(s.availability).toBe("commuting");
  });

  it("override survives even when offline (closed-tab note)", () => {
    const s = r({ override: { availability: "lunch" }, online: false });
    expect(s.availability).toBe("lunch");
  });
});

describe("resolveStatus — idle overlay stickiness (Q2)", () => {
  it("ambient available idles to away at the short threshold", () => {
    expect(r({ online: true, idleMs: AMBIENT_IDLE_MS - 1 }).availability).toBe("available");
    expect(r({ online: true, idleMs: AMBIENT_IDLE_MS }).availability).toBe("away");
  });

  it("a meeting NEVER idles to away", () => {
    const s = r({ room: { kind: "meeting" }, idleMs: FOCUS_IDLE_MS * 10 });
    expect(s.availability).toBe("in_meeting");
  });

  it("derived focus idles to away only after the long threshold", () => {
    const base = { room: { kind: "focus" } };
    expect(r({ ...base, idleMs: AMBIENT_IDLE_MS }).availability).toBe("focusing");
    expect(r({ ...base, idleMs: FOCUS_IDLE_MS - 1 }).availability).toBe("focusing");
    expect(r({ ...base, idleMs: FOCUS_IDLE_MS }).availability).toBe("away");
  });

  it("a manual override is sticky against idle", () => {
    const s = r({ override: { availability: "focusing" }, idleMs: FOCUS_IDLE_MS * 10 });
    expect(s.availability).toBe("focusing");
  });

  it("already-grey states are untouched by idle", () => {
    expect(r({ carBluetooth: true, idleMs: FOCUS_IDLE_MS * 10 }).availability).toBe("commuting");
  });
});

describe("resolveStatus — activity + privacy passthrough (Q4)", () => {
  it("passes a task-link activity through with a 'task' kind", () => {
    const s = r({ online: true, activity: { label: "PR #123", link: "https://x/pr/123", since: NOW } });
    expect(s.activity).toMatchObject({ kind: "task", label: "PR #123", link: "https://x/pr/123", private: false });
  });

  it("preserves the private flag (redaction happens at write time, not here)", () => {
    const s = r({ online: true, activity: { label: "Comp review", private: true } });
    expect(s.activity.private).toBe(true);
    expect(s.availability).toBe("available"); // availability itself is never hidden
  });

  it("no activity when none supplied", () => {
    expect(r({ online: true }).activity).toBeNull();
  });
});

describe("resolveStatus — legacy presence bridge", () => {
  it("honors a legacy deliberate busy state during transition", () => {
    expect(r({ online: true, legacyPresenceState: "heads_down" }).availability).toBe("focusing");
    expect(r({ online: true, legacyPresenceState: "out_to_lunch" }).availability).toBe("lunch");
  });

  it("lets ambient legacy states fall through to derivation", () => {
    // legacy 'active' is ambient → resolves to available via the ladder
    expect(r({ online: true, legacyPresenceState: "active" }).availability).toBe("available");
  });
});
