import { describe, expect, it, vi } from "vitest";

// tileChrome pulls in LiveKit's React + client SDK (DOM-bound) for its tile
// components. The grid-ordering helpers under test are pure, so stub those
// modules out — we only need Track.Source values.
vi.mock("@livekit/components-react", () => ({
  ParticipantTile: () => null,
  useIsSpeaking: () => false,
  useConnectionQualityIndicator: () => ({ quality: "excellent" }),
}));
vi.mock("livekit-client", () => ({
  Track: { Source: { Camera: "camera", ScreenShare: "screen_share", Microphone: "microphone" } },
  ConnectionQuality: { Excellent: "excellent", Good: "good", Poor: "poor", Unknown: "unknown" },
}));

import { orderTilesStable, surfaceOverflowSpeakers } from "./tileChrome";

const CAMERA = "camera";
const SCREEN = "screen_share";

function tile(identity, { source = CAMERA, camOn = true, name, joinedMs = 0 } = {}) {
  return {
    source,
    participant: { identity, name: name ?? identity, joinedAt: new Date(joinedMs) },
    // Screen shares are always "live"; a camera tile is muted when the cam is off.
    publication: { isMuted: source === SCREEN ? false : !camOn },
  };
}
const ids = (list) => list.map((t) => t.participant.identity);

describe("orderTilesStable — grid order never depends on who's talking", () => {
  it("sorts by join time and takes no speaking input at all", () => {
    const a = tile("a", { joinedMs: 300 });
    const b = tile("b", { joinedMs: 100 });
    const c = tile("c", { joinedMs: 200 });
    expect(ids(orderTilesStable([a, b, c], { sortBy: "join" }))).toEqual(["b", "c", "a"]);
    // The function's signature has no `speaking`/`featuredId` — there is no input
    // by which a speaker could reorder the grid. Order is a pure function of the
    // tiles + sort key, so a mid-call speaker cannot move anyone.
  });

  it("sorts by name (A–Z) when asked", () => {
    const zoe = tile("x", { name: "Zoe", joinedMs: 100 });
    const amy = tile("y", { name: "Amy", joinedMs: 200 });
    expect(ids(orderTilesStable([zoe, amy], { sortBy: "name" }))).toEqual(["y", "x"]);
  });

  it("floats screen shares first and sinks camera-off tiles last", () => {
    const cam = tile("cam");
    const off = tile("off", { camOn: false });
    const scr = tile("scr", { source: SCREEN });
    expect(ids(orderTilesStable([off, cam, scr], { sortBy: "join" }))).toEqual(["scr", "cam", "off"]);
  });

  it("floats the global pin to the front", () => {
    const a = tile("a");
    const b = tile("b");
    const p = tile("pinme");
    expect(ids(orderTilesStable([a, b, p], { sortBy: "join", globalPinId: "pinme" }))).toEqual([
      "pinme",
      "a",
      "b",
    ]);
  });

  it("is deterministic — same tiles in any input order give the same result", () => {
    const a = tile("a", { joinedMs: 100 });
    const b = tile("b", { joinedMs: 200 });
    const c = tile("c", { joinedMs: 300 });
    const opts = { sortBy: "join" };
    expect(ids(orderTilesStable([c, a, b], opts))).toEqual(ids(orderTilesStable([b, c, a], opts)));
  });
});

describe("surfaceOverflowSpeakers — visible grid holds still; only off-screen speakers surface", () => {
  const visible = () => [tile("a"), tile("b"), tile("c"), tile("d")];
  const overflow = () => [tile("e"), tile("f")];

  it("leaves the visible grid untouched when nobody in overflow is talking", () => {
    const vis = visible();
    const res = surfaceOverflowSpeakers(vis, overflow(), { speakingIds: new Set(), featuredId: null });
    expect(ids(res)).toEqual(["a", "b", "c", "d"]);
  });

  it("pops a talking overflow person into the LAST quiet slot, leaving the rest in place", () => {
    const res = surfaceOverflowSpeakers(visible(), overflow(), {
      speakingIds: new Set(["e"]),
      featuredId: null,
    });
    // e takes d's slot (the last quiet tile); a/b/c never move.
    expect(ids(res)).toEqual(["a", "b", "c", "e"]);
  });

  it("surfaces the held featured speaker even if not in the live speaking set", () => {
    const res = surfaceOverflowSpeakers(visible(), overflow(), {
      speakingIds: new Set(),
      featuredId: "e",
    });
    expect(ids(res)).toEqual(["a", "b", "c", "e"]);
  });

  it("never bumps a pinned visible tile — it takes the next quiet slot instead", () => {
    const vis = [tile("a"), tile("b"), tile("c"), tile("d")];
    const res = surfaceOverflowSpeakers(vis, [tile("e")], {
      speakingIds: new Set(["e"]),
      featuredId: null,
      pinnedTrackKey: "d:camera", // d is pinned → protected
    });
    // c (last non-pinned, non-speaking) is bumped; d stays put.
    expect(ids(res)).toEqual(["a", "b", "e", "d"]);
  });

  it("never bumps a screen-share visible tile", () => {
    const vis = [tile("a"), tile("b"), tile("c"), tile("scr", { source: SCREEN })];
    const res = surfaceOverflowSpeakers(vis, [tile("e")], {
      speakingIds: new Set(["e"]),
      featuredId: null,
    });
    expect(ids(res)).toEqual(["a", "b", "e", "scr"]);
  });
});
