import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { availability } from "./timezone";

// availability() reads "now" via Intl in the profile's timezone; pin the clock
// and use a UTC profile so minutes-into-the-day are deterministic.
const at = (iso) => vi.setSystemTime(new Date(iso));

// Same window every weekday, so boundary tests never turn into day-off results.
const utcSchedule = (start, end) => ({
  timezone: "UTC",
  work_schedule: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), { start, end }])),
});

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

// 2026-07-06 is a Monday.
describe("availability — normal window (09:00–17:00)", () => {
  const p = utcSchedule("09:00", "17:00");

  it("no badge during working hours", () => {
    at("2026-07-06T10:00:00Z");
    expect(availability(p).badge).toBe(null);
  });

  it("off hours before start", () => {
    at("2026-07-06T08:59:00Z");
    expect(availability(p).badge).toBe("off hours");
  });

  it("start boundary minute is working", () => {
    at("2026-07-06T09:00:00Z");
    expect(availability(p).badge).toBe(null);
  });

  it("end boundary minute is off hours", () => {
    at("2026-07-06T17:00:00Z");
    expect(availability(p).badge).toBe("off hours");
  });

  it("wrapping up inside the last 30 minutes", () => {
    at("2026-07-06T16:40:00Z");
    expect(availability(p).badge).toBe("wrapping up");
  });

  it("wrapping up at exactly 30 minutes to end", () => {
    at("2026-07-06T16:30:00Z");
    expect(availability(p).badge).toBe("wrapping up");
  });

  it("no wrap-up at 31 minutes to end", () => {
    at("2026-07-06T16:29:00Z");
    expect(availability(p).badge).toBe(null);
  });
});

describe("availability — overnight window (22:00–06:00)", () => {
  const p = utcSchedule("22:00", "06:00");

  it("working before midnight", () => {
    at("2026-07-06T23:00:00Z");
    expect(availability(p).badge).toBe(null);
  });

  it("working after midnight", () => {
    at("2026-07-06T03:00:00Z");
    expect(availability(p).badge).toBe(null);
  });

  it("off hours mid-day", () => {
    at("2026-07-06T12:00:00Z");
    expect(availability(p).badge).toBe("off hours");
  });

  it("start boundary minute is working", () => {
    at("2026-07-06T22:00:00Z");
    expect(availability(p).badge).toBe(null);
  });

  it("end boundary minute is off hours", () => {
    at("2026-07-06T06:00:00Z");
    expect(availability(p).badge).toBe("off hours");
  });

  it("shortly before the start is off hours, not wrapping up", () => {
    at("2026-07-06T21:50:00Z");
    expect(availability(p).badge).toBe("off hours");
  });

  it("wrapping up near the (post-midnight) end", () => {
    at("2026-07-06T05:40:00Z");
    expect(availability(p).badge).toBe("wrapping up");
  });
});

describe("availability — wrap-up across midnight (09:00–00:15)", () => {
  const p = utcSchedule("09:00", "00:15");

  it("wrapping up before midnight when the end is past midnight", () => {
    at("2026-07-06T23:55:00Z"); // 20 minutes to the 00:15 end
    expect(availability(p).badge).toBe("wrapping up");
  });

  it("wrapping up after midnight, before the end", () => {
    at("2026-07-06T00:10:00Z"); // 5 minutes to the 00:15 end
    expect(availability(p).badge).toBe("wrapping up");
  });

  it("no wrap-up while the end is still far away", () => {
    at("2026-07-06T23:00:00Z"); // 75 minutes to the end
    expect(availability(p).badge).toBe(null);
  });
});

describe("availability — schedule shapes", () => {
  it("a day without a schedule entry is a day off (off hours, no loc)", () => {
    // Monday-only schedule, checked on Tuesday.
    const p = { timezone: "UTC", work_schedule: { 1: { start: "09:00", end: "17:00" } } };
    at("2026-07-07T10:00:00Z");
    expect(availability(p)).toMatchObject({ badge: "off hours", loc: null });
  });

  it("legacy single hours: working + wrapping up", () => {
    const p = { timezone: "UTC", work_start: "09:00", work_end: "17:00" };
    at("2026-07-06T10:00:00Z");
    expect(availability(p).badge).toBe(null);
    at("2026-07-06T16:45:00Z");
    expect(availability(p).badge).toBe("wrapping up");
  });

  it("no schedule at all yields no badge", () => {
    at("2026-07-06T03:00:00Z");
    expect(availability({ timezone: "UTC" }).badge).toBe(null);
  });
});
