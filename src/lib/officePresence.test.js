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

  it("falls back to legacy presence_state for an online person with no row", () => {
    const [m] = mergeOfficePresence([], [live({ user_id: "x", presence_state: "heads_down", name: "Bo" })]);
    expect(m.userId).toBe("x");
    expect(m.availability).toBe("focusing"); // heads_down → focusing
    expect(m.online).toBe(true);
  });

  it("does not duplicate a person present in both sets", () => {
    expect(mergeOfficePresence([row()], [live()])).toHaveLength(1);
  });
});
