import { describe, expect, test } from "vitest";
import { buildContentSecurityPolicy } from "./csp";

describe("buildContentSecurityPolicy", () => {
  test("allows video conferencing providers in Electron", () => {
    const csp = buildContentSecurityPolicy("capacitor-electron", false);

    expect(csp).toContain("connect-src");
    expect(csp).toContain("https://*.livekit.cloud");
    expect(csp).toContain("wss://*.livekit.cloud");
    expect(csp).toContain("https://meet.jit.si");
    expect(csp).toContain("wss://meet.jit.si");
    expect(csp).toContain("https://8x8.vc");
    expect(csp).toContain("wss://8x8.vc");
    expect(csp).toContain("frame-src");
    expect(csp).toContain("https://meet.jit.si");
    expect(csp).toContain("https://8x8.vc");
  });
});
