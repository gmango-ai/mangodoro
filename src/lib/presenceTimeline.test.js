import { describe, it, expect } from "vitest";
import { appendSample, computeTotals, presenceClass, todayKey, GAP_MS } from "./presenceTimeline";

const T = 1_800_000_000_000;
const M = 60_000;

describe("presenceClass", () => {
  it("maps rich availability onto active/away/offline", () => {
    expect(presenceClass("focusing")).toBe("active");
    expect(presenceClass("in_meeting")).toBe("active");
    expect(presenceClass("available")).toBe("active");
    expect(presenceClass("away")).toBe("away");
    expect(presenceClass("lunch")).toBe("away");
    expect(presenceClass("commuting")).toBe("away");
    expect(presenceClass("offline")).toBe("offline");
    expect(presenceClass("???")).toBe("offline");
  });
});

describe("appendSample", () => {
  it("seeds the first segment", () => {
    expect(appendSample([], "available", T)).toEqual([{ start: T, end: T, a: "available" }]);
  });

  it("extends the current run when the state is unchanged", () => {
    let s = appendSample([], "available", T);
    s = appendSample(s, "available", T + M);
    expect(s).toHaveLength(1);
    expect(s[0]).toEqual({ start: T, end: T + M, a: "available" });
  });

  it("closes and opens on a state change", () => {
    let s = appendSample([], "available", T);
    s = appendSample(s, "focusing", T + M);
    expect(s).toEqual([
      { start: T, end: T + M, a: "available" },
      { start: T + M, end: T + M, a: "focusing" },
    ]);
  });

  it("inserts an offline segment across a large gap (tab closed)", () => {
    let s = appendSample([], "available", T);
    s = appendSample(s, "available", T + GAP_MS + M); // returned after a long absence
    expect(s).toHaveLength(3);
    expect(s[1]).toEqual({ start: T, end: T + GAP_MS + M, a: "offline" });
    expect(s[2].a).toBe("available");
  });

  it("does not mutate the input array", () => {
    const orig = [{ start: T, end: T, a: "available" }];
    const copy = JSON.parse(JSON.stringify(orig));
    appendSample(orig, "available", T + M);
    expect(orig).toEqual(copy);
  });
});

describe("computeTotals", () => {
  it("sums ms per class", () => {
    const segs = [
      { start: T, end: T + 30 * M, a: "focusing" }, // active 30m
      { start: T + 30 * M, end: T + 40 * M, a: "away" }, // away 10m
      { start: T + 40 * M, end: T + 100 * M, a: "offline" }, // offline 60m
    ];
    expect(computeTotals(segs)).toEqual({ active: 30 * M, away: 10 * M, offline: 60 * M });
  });
});

describe("todayKey", () => {
  it("formats a local YYYY-MM-DD", () => {
    expect(todayKey(new Date(2027, 0, 5, 10).getTime())).toBe("2027-01-05");
  });
});
