import { describe, it, expect } from "vitest";
import { deliveryAction, availabilityBucket } from "./notificationDelivery";

describe("availabilityBucket", () => {
  it("maps availability to free / dnd / away", () => {
    expect(availabilityBucket("available")).toBe("free");
    expect(availabilityBucket("pairing")).toBe("free");
    expect(availabilityBucket("focusing")).toBe("dnd");
    expect(availabilityBucket("in_meeting")).toBe("dnd");
    expect(availabilityBucket("away")).toBe("away");
    expect(availabilityBucket("lunch")).toBe("away");
    expect(availabilityBucket("offline")).toBe("away");
    expect(availabilityBucket("???")).toBe("free");
  });
});

describe("deliveryAction — the §7.3 matrix", () => {
  it("free: everything delivers in full", () => {
    for (const pr of ["low", "normal", "high", "urgent"]) {
      expect(deliveryAction(pr, "available")).toEqual({ banner: true, sound: true, push: true, hold: false });
    }
  });

  it("focusing: low/normal held, high silent, urgent breaks through", () => {
    expect(deliveryAction("low", "focusing")).toEqual({ banner: false, sound: false, push: false, hold: true });
    expect(deliveryAction("normal", "focusing")).toEqual({ banner: false, sound: false, push: false, hold: true });
    expect(deliveryAction("high", "focusing")).toEqual({ banner: true, sound: false, push: false, hold: false });
    expect(deliveryAction("urgent", "focusing")).toEqual({ banner: true, sound: true, push: true, hold: false });
  });

  it("in_meeting behaves like focusing (dnd)", () => {
    expect(deliveryAction("normal", "in_meeting").hold).toBe(true);
    expect(deliveryAction("urgent", "in_meeting")).toEqual({ banner: true, sound: true, push: true, hold: false });
  });

  it("away: low/normal inbox-only, high reaches (no sound), urgent full", () => {
    expect(deliveryAction("normal", "away")).toEqual({ banner: false, sound: false, push: false, hold: true });
    expect(deliveryAction("high", "away")).toEqual({ banner: true, sound: false, push: true, hold: false });
    expect(deliveryAction("urgent", "away")).toEqual({ banner: true, sound: true, push: true, hold: false });
  });

  it("defaults: normal priority + available", () => {
    expect(deliveryAction()).toEqual({ banner: true, sound: true, push: true, hold: false });
  });
});
