import { describe, expect, it } from "vitest";
import { evaluateRemoteRow } from "./applyRemoteRow.js";

describe("evaluateRemoteRow", () => {
  it("skips when inside suppress window", () => {
    const result = evaluateRemoteRow({
      row: { mode: "work", sessions: 0, is_running: false, remaining_seconds: 100 },
      suppressUntilMs: Date.now() + 10_000,
    });
    expect(result.action).toBe("skip");
  });

  it("derives secondsLeft from ends_at when running", () => {
    const endsAt = new Date(Date.now() + 90_000).toISOString();
    const result = evaluateRemoteRow({
      row: {
        mode: "work",
        sessions: 0,
        is_running: true,
        remaining_seconds: 1500,
        ends_at: endsAt,
        updated_at: new Date().toISOString(),
      },
      suppressUntilMs: 0,
    });
    expect(result.action).toBe("apply");
    expect(result.patch.secondsLeft).toBeGreaterThanOrEqual(89);
    expect(result.patch.secondsLeft).toBeLessThanOrEqual(91);
  });
});
