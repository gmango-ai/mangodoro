import { describe, it, expect } from "vitest";
import { mergeOfficePresence } from "./officePresence";

const NOW = Date.parse("2026-07-09T12:00:00Z");
const MIN = 60_000;
const HOUR = 3_600_000;
const ago = (ms) => new Date(NOW - ms).toISOString();

const row = (o = {}) => ({
  user_id: "u",
  availability: "focusing",
  activity_private: false,
  activity_label: "PR #1",
  activity_link: "url",
  location_kind: "room",
  location_room_id: "r",
  since: null,
  last_seen_at: ago(30_000), // fresh heartbeat by default
  override_availability: null,
  override_expires_at: null,
  invisible: false,
  ...o,
});
const live = (o = {}) => ({ user_id: "u", name: "Al", avatar_url: "a.png", ...o });
const merge = (rows, online = [], identity = {}) => mergeOfficePresence(rows, online, identity, NOW);

describe("mergeOfficePresence", () => {
  it("shows the snapshot availability + activity when live", () => {
    const [m] = merge([row()], [live()]);
    expect(m.availability).toBe("focusing");
    expect(m.online).toBe(true);
    expect(m.name).toBe("Al");
    expect(m.activity).toEqual({ label: "PR #1", link: "url" });
  });

  it("a fresh heartbeat counts as online even when NOT in the realtime roster", () => {
    // The false-offline fix: liveness is the heartbeat, not the team channel.
    const [m] = merge([row({ availability: "online" })], []);
    expect(m.online).toBe(true);
    expect(m.availability).toBe("online");
  });

  it("a heartbeating client shows online even if its own resolver derived idle 'away'", () => {
    const [m] = merge([row({ availability: "away" })], [live()]);
    expect(m.availability).toBe("online");
  });

  it("a stale/swept 'offline' on a live client is bumped to online", () => {
    const [m] = merge([row({ availability: "offline", last_seen_at: ago(MIN) })], []);
    expect(m.online).toBe(true);
    expect(m.availability).toBe("online");
  });

  it("respects a manual Away override on a live client", () => {
    const [m] = merge([row({ availability: "away", override_availability: "away" })], [live()]);
    expect(m.availability).toBe("away");
  });

  it("respects a manual Offline override on a live client", () => {
    const [m] = merge([row({ availability: "offline", override_availability: "offline" })], [live()]);
    expect(m.availability).toBe("offline");
  });

  it("ignores an EXPIRED override (falls back to the live derivation)", () => {
    const [m] = merge([
      row({ availability: "away", override_availability: "away", override_expires_at: ago(MIN) }),
    ], [live()]);
    expect(m.availability).toBe("online");
  });

  it("shows AWAY (not offline) for the first 12h after the heartbeat stops", () => {
    const [m] = merge([row({ last_seen_at: ago(2 * HOUR) })], []);
    expect(m.online).toBe(false);
    expect(m.availability).toBe("away");
    expect(m.locationRoomId).toBe("r"); // still "in" their room, just not live
  });

  it("keeps the room of an absent person (so they show 'in room, offline')", () => {
    const [m] = merge([row({ last_seen_at: ago(13 * HOUR) })], []);
    expect(m.availability).toBe("offline");
    expect(m.locationKind).toBe("room");
    expect(m.locationRoomId).toBe("r");
  });

  it("hides the room of an absent INVISIBLE person", () => {
    const [m] = merge([row({ last_seen_at: ago(2 * HOUR), invisible: true })], []);
    expect(m.locationKind).toBe("none");
    expect(m.locationRoomId).toBeNull();
  });

  it("shows OFFLINE only after 12h absent", () => {
    const [m] = merge([row({ last_seen_at: ago(13 * HOUR) })], []);
    expect(m.online).toBe(false);
    expect(m.availability).toBe("offline");
  });

  it("redacts a private activity", () => {
    const [m] = merge([row({ activity_private: true })], [live()]);
    expect(m.activity).toBeNull();
  });

  it("'Appear offline' shows offline to teammates even while live", () => {
    const [m] = merge([row({ invisible: true })], [live()]);
    expect(m.online).toBe(false);
    expect(m.availability).toBe("offline");
  });

  it("an in-roster socket with no snapshot row shows online", () => {
    const [m] = merge([], [live({ user_id: "x", name: "Bo" })]);
    expect(m.userId).toBe("x");
    expect(m.availability).toBe("online");
    expect(m.online).toBe(true);
  });

  it("does not duplicate a person present in both sets", () => {
    expect(merge([row()], [live()])).toHaveLength(1);
  });

  it("uses identity for name/avatar of an absent person and keeps their room", () => {
    const [m] = merge([row({ last_seen_at: ago(2 * HOUR) })], [], { u: { name: "Ida", avatar: "i.png" } });
    expect(m.online).toBe(false);
    expect(m.availability).toBe("away");
    expect(m.name).toBe("Ida");
    expect(m.avatar).toBe("i.png");
    expect(m.locationRoomId).toBe("r");
  });

  it("includes identity members never seen at all, as offline", () => {
    const list = merge([], [], { z: { name: "Zed" } });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ userId: "z", online: false, availability: "offline", name: "Zed" });
  });
});
