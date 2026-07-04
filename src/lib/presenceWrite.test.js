import { describe, it, expect } from "vitest";
import { presenceSignature, shouldWritePresence, ACTIVITY_THROTTLE_MS } from "./presenceWrite";

const T = 1_800_000_000_000;

const resolved = (over = {}) => ({
  availability: "available",
  location: { kind: "none" },
  activity: null,
  override: null,
  ...over,
});

const sig = (over) => presenceSignature(resolved(over));

describe("presenceSignature", () => {
  it("captures availability, location, override, and activity fields", () => {
    const s = presenceSignature({
      availability: "focusing",
      location: { kind: "room", roomId: "r1" },
      activity: { label: "PR #1", link: "u", private: true },
      override: { availability: "lunch", expiresAt: T },
    });
    expect(s).toEqual({
      availability: "focusing",
      overrideAvailability: "lunch",
      overrideExpiresAt: T,
      locationKind: "room",
      locationRoomId: "r1",
      activityLabel: "PR #1",
      activityLink: "u",
      activityPrivate: true,
    });
  });
});

describe("shouldWritePresence", () => {
  it("always writes the first time (no prev)", () => {
    expect(shouldWritePresence(null, sig(), null, T)).toEqual({ write: true, reason: "first" });
  });

  it("writes immediately on an availability transition", () => {
    const prev = sig({ availability: "available" });
    const next = sig({ availability: "focusing" });
    expect(shouldWritePresence(prev, next, T, T + 10)).toEqual({ write: true, reason: "transition" });
  });

  it("writes immediately on a location change", () => {
    const prev = sig({ location: { kind: "none" } });
    const next = sig({ location: { kind: "room", roomId: "r1" } });
    expect(shouldWritePresence(prev, next, T, T + 10).write).toBe(true);
  });

  it("writes immediately when an override appears or expires", () => {
    const prev = sig({ override: null });
    const next = sig({ override: { availability: "lunch", expiresAt: T + 5000 } });
    expect(shouldWritePresence(prev, next, T, T + 10).reason).toBe("transition");
  });

  it("writes immediately when the privacy flag flips", () => {
    const prev = sig({ activity: { label: "x", private: false } });
    const next = sig({ activity: { label: "x", private: true } });
    expect(shouldWritePresence(prev, next, T, T + 10).reason).toBe("transition");
  });

  it("throttles a pure activity-label change within the window", () => {
    const prev = sig({ activity: { label: "Task A" } });
    const next = sig({ activity: { label: "Task B" } });
    expect(shouldWritePresence(prev, next, T, T + 1000)).toEqual({ write: false, reason: "throttled" });
  });

  it("writes an activity change once the throttle window passes", () => {
    const prev = sig({ activity: { label: "Task A" } });
    const next = sig({ activity: { label: "Task B" } });
    const now = T + ACTIVITY_THROTTLE_MS;
    expect(shouldWritePresence(prev, next, T, now)).toEqual({ write: true, reason: "activity" });
  });

  it("skips when nothing changed", () => {
    expect(shouldWritePresence(sig(), sig(), T, T + 999999)).toEqual({ write: false, reason: "unchanged" });
  });
});
