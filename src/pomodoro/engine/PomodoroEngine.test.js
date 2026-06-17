import { describe, expect, it, vi } from "vitest";

vi.mock("../../supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    rpc: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

import { PomodoroEngine } from "./PomodoroEngine.js";

describe("PomodoroEngine wire snapshot", () => {
  it("is structuredClone-safe with no function values", () => {
    const engine = new PomodoroEngine("test-user-id");
    const wire = engine._getWireSnapshot();

    for (const value of Object.values(wire)) {
      expect(typeof value).not.toBe("function");
    }

    expect(() => structuredClone(wire)).not.toThrow();
  });

  it("full getSnapshot includes command methods not present on wire snapshot", () => {
    const engine = new PomodoroEngine("test-user-id");
    const full = engine.getSnapshot();
    const wire = engine._getWireSnapshot();

    expect(typeof full.toggleRun).toBe("function");
    expect(wire.toggleRun).toBeUndefined();
  });
});
