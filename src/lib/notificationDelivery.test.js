import { describe, it, expect } from "vitest";
import { deliveryAction, availabilityBucket } from "./notificationDelivery";

describe("availabilityBucket", () => {
  it("maps availability to free / dnd / away", () => {
    expect(availabilityBucket("online")).toBe("free");
    expect(availabilityBucket("focusing")).toBe("dnd");
    expect(availabilityBucket("meeting")).toBe("dnd");
    expect(availabilityBucket("away")).toBe("away");
    expect(availabilityBucket("lunch")).toBe("away");
    expect(availabilityBucket("offline")).toBe("away");
    expect(availabilityBucket("???")).toBe("free");
  });
});

describe("deliveryAction — the §7.3 matrix", () => {
  it("free: everything delivers in full", () => {
    for (const pr of ["low", "normal", "high", "urgent"]) {
      expect(deliveryAction(pr, "online")).toEqual({ banner: true, sound: true, push: true, hold: false });
    }
  });

  it("focusing: low/normal held, high silent, urgent breaks through", () => {
    expect(deliveryAction("low", "focusing")).toEqual({ banner: false, sound: false, push: false, hold: true });
    expect(deliveryAction("normal", "focusing")).toEqual({ banner: false, sound: false, push: false, hold: true });
    expect(deliveryAction("high", "focusing")).toEqual({ banner: true, sound: false, push: false, hold: false });
    expect(deliveryAction("urgent", "focusing")).toEqual({ banner: true, sound: true, push: true, hold: false });
  });

  it("meeting behaves like focusing (dnd)", () => {
    expect(deliveryAction("normal", "meeting").hold).toBe(true);
    expect(deliveryAction("urgent", "meeting")).toEqual({ banner: true, sound: true, push: true, hold: false });
  });

  it("away: low/normal inbox-only, high reaches (no sound), urgent full", () => {
    expect(deliveryAction("normal", "away")).toEqual({ banner: false, sound: false, push: false, hold: true });
    expect(deliveryAction("high", "away")).toEqual({ banner: true, sound: false, push: true, hold: false });
    expect(deliveryAction("urgent", "away")).toEqual({ banner: true, sound: true, push: true, hold: false });
  });

  it("defaults: normal priority + online", () => {
    expect(deliveryAction()).toEqual({ banner: true, sound: true, push: true, hold: false });
  });
});
