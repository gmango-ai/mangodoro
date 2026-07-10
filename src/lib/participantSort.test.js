import { describe, it, expect, beforeEach } from "vitest";
import { sortParticipants } from "./participantSort";

const p = (id, over = {}) => ({
  user_id: id,
  display_name: id,
  joined_at: over.joined_at ?? "2026-06-22T09:00:00Z",
  presence_state: over.presence_state ?? "active",
  ...over,
});

describe("sortParticipants", () => {
  const me = p("me", { display_name: "Zoe", joined_at: "2026-06-22T09:10:00Z" });
  const leader = p("lead", { display_name: "Yan", joined_at: "2026-06-22T09:05:00Z" });
  const alex = p("alex", { display_name: "Alex", joined_at: "2026-06-22T09:01:00Z", presence_state: "away" });
  const priya = p("priya", { display_name: "Priya", joined_at: "2026-06-22T09:04:00Z", presence_state: "available" });

  const ctx = { userId: "me", leaderId: "lead" };

  it("pins you first and the leader second regardless of sort key", () => {
    for (const mode of ["join", "name", "presence"]) {
      const out = sortParticipants([alex, priya, leader, me], { ...ctx, mode });
      expect(out.slice(0, 2).map((x) => x.user_id)).toEqual(["me", "lead"]);
    }
  });

  it("orders the rest by join time for mode=join", () => {
    const out = sortParticipants([priya, alex, leader, me], { ...ctx, mode: "join" });
    expect(out.map((x) => x.user_id)).toEqual(["me", "lead", "alex", "priya"]); // alex 09:01 < priya 09:04
  });

  it("orders the rest alphabetically for mode=name", () => {
    const out = sortParticipants([priya, alex, leader, me], { ...ctx, mode: "name" });
    expect(out.map((x) => x.user_id)).toEqual(["me", "lead", "alex", "priya"]); // Alex < Priya
  });

  it("groups the rest by presence for mode=presence", () => {
    // Availability comes from user_presence via availabilityOf now.
    const availabilityOf = (uid) => ({ priya: "online", alex: "away" }[uid] || "online");
    const out = sortParticipants([alex, priya, leader, me], { ...ctx, mode: "presence", availabilityOf });
    // online(0) before away(4); you/leader still pinned.
    expect(out.map((x) => x.user_id)).toEqual(["me", "lead", "priya", "alex"]);
  });

  it("is stable: same input in any order yields the same result", () => {
    const a = sortParticipants([alex, priya, leader, me], { ...ctx, mode: "join" });
    const b = sortParticipants([me, leader, priya, alex], { ...ctx, mode: "join" });
    const c = sortParticipants([priya, me, alex, leader], { ...ctx, mode: "join" });
    expect(a.map((x) => x.user_id)).toEqual(b.map((x) => x.user_id));
    expect(b.map((x) => x.user_id)).toEqual(c.map((x) => x.user_id));
  });

  it("ties on join time break deterministically by user_id (never reshuffles)", () => {
    const x = p("xxx", { display_name: "Same", joined_at: "2026-06-22T09:00:00Z" });
    const y = p("aaa", { display_name: "Same", joined_at: "2026-06-22T09:00:00Z" });
    const out = sortParticipants([x, y], { mode: "join" });
    expect(out.map((r) => r.user_id)).toEqual(["aaa", "xxx"]); // aaa < xxx
  });

  it("does not mutate the input array", () => {
    const input = [alex, priya, leader, me];
    const copy = input.slice();
    sortParticipants(input, { ...ctx, mode: "name" });
    expect(input).toEqual(copy);
  });
});
