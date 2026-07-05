import { describe, expect, test } from "vitest";
import {
  computeAnchoredPopoverPosition,
  computeFallbackPopoverPosition,
  hasUsableBounds,
} from "./pomodoroPopoverPosition";

describe("computeAnchoredPopoverPosition", () => {
  const winBounds = { x: 0, y: 0, width: 380, height: 480 };

  test("centers under a tray icon on the matching secondary display", () => {
    const secondaryWorkArea = { x: 1728, y: 0, width: 1728, height: 1080 };
    const trayBounds = { x: 2460, y: 0, width: 24, height: 24 };

    expect(computeAnchoredPopoverPosition(winBounds, trayBounds, secondaryWorkArea)).toEqual({
      x: 2282,
      y: 30,
    });
  });

  test("clamps horizontally within the selected display work area", () => {
    const secondaryWorkArea = { x: 1728, y: 0, width: 1728, height: 1080 };
    const trayBounds = { x: 1730, y: 0, width: 24, height: 24 };

    expect(computeAnchoredPopoverPosition(winBounds, trayBounds, secondaryWorkArea)).toEqual({
      x: 1736,
      y: 30,
    });
  });

  test("clamps vertically within the selected display work area", () => {
    const lowerDisplayWorkArea = { x: 0, y: 1080, width: 1728, height: 900 };
    const trayBounds = { x: 1000, y: 1950, width: 24, height: 24 };

    expect(computeAnchoredPopoverPosition(winBounds, trayBounds, lowerDisplayWorkArea)).toEqual({
      x: 822,
      y: 1492,
    });
  });
});

describe("computeFallbackPopoverPosition", () => {
  test("uses the top-right of the fallback display", () => {
    expect(
      computeFallbackPopoverPosition(
        { x: 0, y: 0, width: 380, height: 480 },
        { x: 0, y: 25, width: 1440, height: 875 }
      )
    ).toEqual({ x: 1044, y: 41 });
  });
});

describe("hasUsableBounds", () => {
  test("rejects missing and zero-size bounds", () => {
    expect(hasUsableBounds(null)).toBe(false);
    expect(hasUsableBounds({ x: 0, y: 0, width: 0, height: 24 })).toBe(false);
    expect(hasUsableBounds({ x: 0, y: 0, width: 24, height: 24 })).toBe(true);
  });
});
