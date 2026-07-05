import { describe, it, expect } from "vitest";
import { notificationSurfaces } from "./notificationSurfaces";

const push = { banner: true, sound: true, push: true, hold: false }; // full delivery
const muted = { banner: true, sound: false, push: false, hold: false }; // focus-muted

describe("notificationSurfaces — multi-tab consolidation", () => {
  const base = {
    channels: ["inapp", "desktop"],
    action: push,
    wantsDesktop: true,
    isLeader: true,
    isVisible: true,
    permissionGranted: true,
    quietHours: false,
  };

  it("leader + visible + granted: toast, sound, and OS all fire", () => {
    expect(notificationSurfaces(base)).toEqual({ toast: true, sound: true, os: true });
  });

  it("toast/sound only on the VISIBLE tab (hidden tab stays quiet)", () => {
    expect(notificationSurfaces({ ...base, isVisible: false })).toMatchObject({ toast: false, sound: false });
  });

  it("OS banner only on the LEADER tab (non-leader never fires it)", () => {
    expect(notificationSurfaces({ ...base, isLeader: false }).os).toBe(false);
  });

  it("the hidden leader still fires the OS banner (covers app-backgrounded)", () => {
    // No tab visible → no toast anywhere, but the leader still surfaces the OS notif.
    expect(notificationSurfaces({ ...base, isVisible: false })).toEqual({ toast: false, sound: false, os: true });
  });

  it("a visible non-leader shows the toast but NOT the OS banner (dedup across tabs)", () => {
    expect(notificationSurfaces({ ...base, isLeader: false, isVisible: true })).toEqual({
      toast: true,
      sound: true,
      os: false,
    });
  });

  it("no inapp channel → no toast/sound even when visible", () => {
    expect(notificationSurfaces({ ...base, channels: ["desktop"] })).toMatchObject({ toast: false, sound: false });
  });

  it("focus-muted action: toast still shows but without sound, OS suppressed", () => {
    expect(notificationSurfaces({ ...base, action: muted })).toEqual({ toast: true, sound: false, os: false });
  });

  it("OS requires desktop routing", () => {
    expect(notificationSurfaces({ ...base, wantsDesktop: false }).os).toBe(false);
  });

  it("OS requires granted permission", () => {
    expect(notificationSurfaces({ ...base, permissionGranted: false }).os).toBe(false);
  });

  it("quiet hours suppress the OS banner (inbox/toast unaffected)", () => {
    expect(notificationSurfaces({ ...base, quietHours: true })).toEqual({ toast: true, sound: true, os: false });
  });

  it("is defensive about missing args", () => {
    expect(notificationSurfaces()).toEqual({ toast: false, sound: false, os: false });
    expect(notificationSurfaces({ channels: ["inapp"], isVisible: true })).toEqual({
      toast: true,
      sound: false,
      os: false,
    });
  });
});
