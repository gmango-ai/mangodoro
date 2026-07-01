import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALARM_CLAIM_LS_KEY,
  ALARM_CLAIM_TTL_MS,
  derivePhaseEndEvent,
  phaseAlarmKey,
  tryClaimPhaseAlarm,
} from "./phaseAlarm.js";

function mockLocalStorage() {
  const store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  });
  return store;
}

describe("phaseAlarm", () => {
  let store;

  beforeEach(() => {
    store = mockLocalStorage();
  });

  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  it("derives work-end and break-end events from mode transitions", () => {
    expect(derivePhaseEndEvent("work", "shortBreak", null)).toBe("work");
    expect(derivePhaseEndEvent("work", "work", "shortBreak")).toBe("work");
    expect(derivePhaseEndEvent("shortBreak", "work", null)).toBe("break");
    expect(derivePhaseEndEvent("work", "work", null)).toBe(null);
  });

  it("rings the work-end chime once across a two-step focus→break transition", () => {
    // Step 1 — focus ends, the auto-transition is announced (pendingMode set).
    // prevPending is null here, so the chime fires.
    expect(derivePhaseEndEvent("work", "work", "shortBreak", null)).toBe("work");
    // Step 2 — ~5s later that pending resolves into the break. prevPending was
    // already set, so we must NOT ring again (this was the double-alert bug).
    expect(derivePhaseEndEvent("work", "shortBreak", null, "shortBreak")).toBe(null);
    // A direct switch with no prior pending still rings once.
    expect(derivePhaseEndEvent("work", "shortBreak", null, null)).toBe("work");
    // break→work is unaffected by prevPending (single by construction).
    expect(derivePhaseEndEvent("shortBreak", "work", null, "work")).toBe("break");
  });

  it("builds stable alarm keys", () => {
    expect(phaseAlarmKey("work-0-none-paused", "work")).toBe(
      "work-0-none-paused-work",
    );
  });

  it("dedupes alarm claims within TTL", () => {
    const key = "work-0-none-123-work";
    expect(tryClaimPhaseAlarm(key)).toBe(true);
    expect(tryClaimPhaseAlarm(key)).toBe(false);
  });

  it("allows reclaim after TTL expires", () => {
    const key = "work-0-none-456-work";
    expect(tryClaimPhaseAlarm(key)).toBe(true);
    localStorage.setItem(
      ALARM_CLAIM_LS_KEY,
      JSON.stringify({ key, ts: Date.now() - ALARM_CLAIM_TTL_MS - 1 }),
    );
    expect(tryClaimPhaseAlarm(key)).toBe(true);
  });
});
