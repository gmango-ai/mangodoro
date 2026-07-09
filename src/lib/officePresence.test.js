import { describe, it, expect } from "vitest";
import { mergeOfficePresence } from "./officePresence";

const row = (o = {}) => ({
  user_id: "u",
  availability: "focusing",
  activity_private: false,
  activity_label: "PR #1",
  activity_link: "url",
  location_kind: "room",
  location_room_id: "r",
  since: null,
  ...o,
});
const live = (o = {}) => ({ user_id: "u", presence_state: "active", name: "Al", avatar_url: "a.png", ...o });

describe("mergeOfficePresence", () => {
  it("uses the snapshot availability when the person is live", () => {
    const [m] = mergeOfficePresence([row()], [live()]);
    expect(m.availability).toBe("focusing");
    expect(m.online).toBe(true);
    expect(m.name).toBe("Al");
    expect(m.activity).toEqual({ label: "PR #1", link: "url" });
  });

  it("forces offline when the person has no live socket", () => {
    const [m] = mergeOfficePresence([row({ availability: "focusing" })], []);
    expect(m.online).toBe(false);
    expect(m.availability).toBe("offline");
  });

  it("redacts a private activity", () => {
    const [m] = mergeOfficePresence([row({ activity_private: true })], [live()]);
    expect(m.activity).toBeNull();
  });

  it("an online person with no snapshot row shows online", () => {
    const [m] = mergeOfficePresence([], [live({ user_id: "x", name: "Bo" })]);
    expect(m.userId).toBe("x");
    expect(m.availability).toBe("online");
    expect(m.online).toBe(true);
  });

  it("does not duplicate a person present in both sets", () => {
    expect(mergeOfficePresence([row()], [live()])).toHaveLength(1);
  });

  it("uses identity for name/avatar of an offline person and hides their stale room", () => {
    const [m] = mergeOfficePresence([row({ user_id: "u" })], [], { u: { name: "Ida", avatar: "i.png" } });
    expect(m.online).toBe(false);
    expect(m.name).toBe("Ida");
    expect(m.avatar).toBe("i.png");
    expect(m.locationRoomId).toBeNull(); // a snapshot's room shouldn't show once offline
  });

  it("includes identity members with no presence at all, as offline", () => {
    const list = mergeOfficePresence([], [], { z: { name: "Zed" } });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ userId: "z", online: false, availability: "offline", name: "Zed" });
  });
});
