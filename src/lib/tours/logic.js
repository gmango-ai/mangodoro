// Pure tour logic — no DOM, no React, no driver.js. Everything here is a plain
// function of (tour | registry, ctx, onboarding-state) so it's unit-testable in
// the node test env. The DOM/driver orchestration lives in engine.js; the
// wiring lives in TourContext.jsx.
//
// `ctx` is the live app snapshot a prerequisite reads, assembled by TourContext:
//   { navigate, waitFor, teams, activeTeam, isAdmin, canManageRooms,
//     teamMembers, visibleRooms, rooms, hasJoinedRoomEver, hasGoals, settings }
// `onboarding` is settings.onboarding:
//   { welcomeDone, completedTours[], dismissedTours[], checklist{}, seenTourMarker }

// Evaluate a tour's prerequisite. No `prerequisite` fn ⇒ always available.
// A prerequisite returns { ok:true } or { ok:false, reason, remedy }.
export function evalPrerequisite(tour, ctx) {
  if (!tour || typeof tour.prerequisite !== "function") return { ok: true };
  try {
    return tour.prerequisite(ctx) || { ok: true };
  } catch {
    // A throwing predicate must never wedge a tour open — treat as available.
    return { ok: true };
  }
}

export function isTourAvailable(tour, ctx) {
  return evalPrerequisite(tour, ctx).ok;
}

// Full status for the Help center / offer logic.
export function tourStatus(tour, ctx, onboarding = {}) {
  const completed = (onboarding.completedTours || []).includes(tour.id);
  const dismissed = (onboarding.dismissedTours || []).includes(tour.id);
  const pre = evalPrerequisite(tour, ctx);
  return {
    id: tour.id,
    completed,
    dismissed,
    locked: !pre.ok,
    reason: pre.reason || "",
    remedy: pre.remedy || null,
  };
}

// Should a surface's tour be auto-offered right now? Offer only when it's
// runnable (prereq met), not already completed/dismissed, and not already
// auto-offered on this device (localStorage — passed in so this stays pure).
export function shouldAutoOffer(tour, ctx, onboarding = {}, { autoOfferedLocally = false } = {}) {
  if (!tour) return false;
  const st = tourStatus(tour, ctx, onboarding);
  return !st.completed && !st.dismissed && !st.locked && !autoOfferedLocally;
}

// "New feature" announcements, mirroring WhatsNew's single-marker approach.
// Markers are date-prefixed strings (e.g. "2026-07-tours-v1") compared
// lexicographically. On a user's FIRST-EVER load (no seenTourMarker) we seed to
// the newest marker silently so existing users aren't blasted with the backlog.
// Otherwise, any announceable + available tour whose marker is newer than the
// last acknowledged one is surfaced.
export function computeAnnouncements(tours, seenMarker, ctx) {
  const markers = (tours || []).map((t) => t.announce?.marker).filter(Boolean);
  if (!markers.length) return { seedMarker: null, announceTours: [] };
  const newest = markers.slice().sort().at(-1);
  if (seenMarker == null) return { seedMarker: newest, announceTours: [] }; // silent first-run seed
  if (seenMarker >= newest) return { seedMarker: null, announceTours: [] };
  const announceTours = (tours || []).filter(
    (t) => t.announce?.marker && t.announce.marker > seenMarker && isTourAvailable(t, ctx),
  );
  return { seedMarker: null, announceTours };
}

// Getting-started checklist, derived from real app facts (not tour completion).
// Org-gated items are hidden until the user is in an org; teammate-gated items
// until the org has other members — so the list never shows an impossible step.
export function deriveChecklist(facts = {}) {
  const items = [
    { id: "name", label: "Set your name & avatar", done: !!facts.name },
    { id: "org", label: "Join or create an org", done: !!facts.hasOrg },
    { id: "room", label: "Enter a room", done: !!facts.enteredRoom, requiresOrg: true },
    { id: "focus", label: "Start a focus session", done: !!facts.startedFocus },
    { id: "goal", label: "Set a goal", done: !!facts.hasGoal, requiresOrg: true },
    { id: "message", label: "Message a teammate", done: !!facts.messagedTeammate, requiresTeammate: true },
  ];
  return items.filter(
    (it) => (!it.requiresOrg || facts.hasOrg) && (!it.requiresTeammate || facts.hasTeammates),
  );
}

export function checklistComplete(facts = {}) {
  const items = deriveChecklist(facts);
  return items.length > 0 && items.every((it) => it.done);
}
