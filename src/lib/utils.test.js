import { describe, it, expect } from "vitest";
import { formatSince } from "./utils";

const NOW = 1_800_000_000_000;

describe("formatSince", () => {
  it("under a minute → 'just now'", () => expect(formatSince(NOW - 30_000, NOW)).toBe("just now"));
  it("minutes", () => expect(formatSince(NOW - 47 * 60000, NOW)).toBe("47m"));
  it("hours and minutes", () => expect(formatSince(NOW - (2 * 60 + 15) * 60000, NOW)).toBe("2h 15m"));
  it("accepts an ISO string", () => expect(formatSince(new Date(NOW - 5 * 60000).toISOString(), NOW)).toBe("5m"));
  it("null / invalid → empty string", () => {
    expect(formatSince(null, NOW)).toBe("");
    expect(formatSince("nope", NOW)).toBe("");
  });
});
