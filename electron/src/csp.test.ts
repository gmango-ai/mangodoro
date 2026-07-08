import { describe, expect, test } from "vitest";
import { buildContentSecurityPolicy } from "./csp";

describe("buildContentSecurityPolicy", () => {
  test("allows LiveKit in Electron", () => {
    const csp = buildContentSecurityPolicy("capacitor-electron", false);

    expect(csp).toContain("connect-src");
    expect(csp).toContain("https://*.livekit.cloud");
    expect(csp).toContain("wss://*.livekit.cloud");
    expect(csp).toContain("frame-src");
  });

  test("no longer allows Jitsi/8x8 domains", () => {
    const csp = buildContentSecurityPolicy("capacitor-electron", false);

    expect(csp).not.toContain("jit.si");
    expect(csp).not.toContain("8x8.vc");
  });
});
