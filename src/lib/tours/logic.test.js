import { describe, it, expect } from "vitest";
import {
  evalPrerequisite,
  isTourAvailable,
  tourStatus,
  shouldAutoOffer,
  computeAnnouncements,
  deriveChecklist,
  checklistComplete,
} from "./logic";

// A tour whose prerequisite needs an org, with a deep-link remedy — mirrors the
// real room/call tour so the ordering guarantee is what's under test.
const orgTour = {
  id: "room-and-call",
  prerequisite: (ctx) => (ctx.activeTeam
    ? { ok: true }
    : { ok: false, reason: "Join or create an org first.", remedy: { type: "deep-link", to: "/team" } }),
};
const soloTour = { id: "meet-pomodoro" }; // no prerequisite

describe("prerequisite evaluation", () => {
  it("treats a tour with no prerequisite as available", () => {
    expect(evalPrerequisite(soloTour, {})).toEqual({ ok: true });
    expect(isTourAvailable(soloTour, {})).toBe(true);
  });

  it("blocks an org tour with a deep-link remedy when there's no org", () => {
    const res = evalPrerequisite(orgTour, { activeTeam: null });
    expect(res.ok).toBe(false);
    expect(res.remedy).toEqual({ type: "deep-link", to: "/team" });
    expect(isTourAvailable(orgTour, { activeTeam: null })).toBe(false);
  });

  it("unblocks the org tour once an org exists", () => {
    expect(isTourAvailable(orgTour, { activeTeam: { id: "t1" } })).toBe(true);
  });

  it("never wedges open on a throwing predicate (treated as available)", () => {
    const bad = { id: "x", prerequisite: () => { throw new Error("boom"); } };
    expect(evalPrerequisite(bad, {})).toEqual({ ok: true });
  });
});

describe("tourStatus + auto-offer gating", () => {
  const ctx = { activeTeam: null };
  it("reports locked + reason + remedy for an unmet prerequisite", () => {
    const st = tourStatus(orgTour, ctx, {});
    expect(st).toMatchObject({ id: "room-and-call", locked: true, completed: false, dismissed: false });
    expect(st.remedy.to).toBe("/team");
  });

  it("does not auto-offer a locked, completed, or dismissed tour", () => {
    expect(shouldAutoOffer(orgTour, ctx, {})).toBe(false); // locked
    expect(shouldAutoOffer(soloTour, {}, { completedTours: ["meet-pomodoro"] })).toBe(false);
    expect(shouldAutoOffer(soloTour, {}, { dismissedTours: ["meet-pomodoro"] })).toBe(false);
  });

  it("auto-offers an available, unseen tour unless already offered on this device", () => {
    expect(shouldAutoOffer(soloTour, {}, {})).toBe(true);
    expect(shouldAutoOffer(soloTour, {}, {}, { autoOfferedLocally: true })).toBe(false);
  });
});

describe("announcements (WhatsNew-style markers)", () => {
  const tours = [
    { id: "a", announce: { marker: "2026-07-01-a" } },
    { id: "b", announce: { marker: "2026-08-01-b" } },
    { id: "c" }, // not announceable
  ];

  it("seeds the newest marker silently on a first-ever load (no toast)", () => {
    const res = computeAnnouncements(tours, null, {});
    expect(res.seedMarker).toBe("2026-08-01-b");
    expect(res.announceTours).toEqual([]);
  });

  it("surfaces only newer-than-seen, available tours", () => {
    const res = computeAnnouncements(tours, "2026-07-01-a", {});
    expect(res.seedMarker).toBeNull();
    expect(res.announceTours.map((t) => t.id)).toEqual(["b"]);
  });

  it("shows nothing when already caught up", () => {
    expect(computeAnnouncements(tours, "2026-08-01-b", {})).toEqual({ seedMarker: null, announceTours: [] });
  });

  it("no-ops when no tour declares a marker", () => {
    expect(computeAnnouncements([{ id: "x" }], null, {})).toEqual({ seedMarker: null, announceTours: [] });
  });
});

describe("getting-started checklist derivation", () => {
  it("hides org-gated + teammate-gated items until unlocked", () => {
    const ids = deriveChecklist({ name: "Jo" }).map((i) => i.id);
    // "org" always shows (it's the join/create step); room/goal/message stay hidden.
    expect(ids).toEqual(["name", "org", "focus"]);
  });

  it("shows org items in an org, and teammate items only with teammates", () => {
    const solo = deriveChecklist({ hasOrg: true }).map((i) => i.id);
    expect(solo).toEqual(["name", "org", "room", "focus", "goal"]); // message hidden (no teammates)
    const withMates = deriveChecklist({ hasOrg: true, hasTeammates: true }).map((i) => i.id);
    expect(withMates).toContain("message");
  });

  it("marks items done from real facts, and completes only when all visible are done", () => {
    const facts = { name: "Jo", hasOrg: true, enteredRoom: true, startedFocus: true, hasGoal: true };
    expect(deriveChecklist(facts).find((i) => i.id === "room").done).toBe(true);
    expect(checklistComplete(facts)).toBe(true); // message hidden (no teammates) ⇒ all visible done
    expect(checklistComplete({ name: "Jo", hasOrg: true })).toBe(false); // room/focus/goal undone
  });

  it("is incomplete when the list is empty", () => {
    expect(checklistComplete({})).toBe(false);
  });
});
