import { normAvailability } from "./presence";

// Merge user_presence snapshot rows with the live team-presence roster into one
// office-wide status list. PURE (no I/O) so it's unit-testable; useOfficePresence
// supplies the live inputs.
//
// LIVENESS is keyed on last_seen_at (the leader tab heartbeats it every ≤45s
// while the app is open, foreground OR background) — NOT on tab focus. So
// "online" means "the app is open and the PC is awake", exactly what the user
// expects. The realtime roster is an extra instant-online signal (a live socket),
// OR'd in so a heartbeat that briefly lags doesn't blink someone offline.
//
//   • LIVE (fresh heartbeat within ONLINE_GRACE, or in the realtime roster):
//       show their status. A manual override wins (incl. a chosen Away/Offline);
//       otherwise environmental states (focusing/meeting/lunch/commuting) show,
//       but a self-derived idle 'away' or a swept/stale 'offline' is bumped to
//       'online' — a heartbeating client is AT the PC even if idle in our tab.
//   • ABSENT (no heartbeat): 'away' for the first 12h, then 'offline'. A person
//       who closed the app is "away" for the workday, not instantly "offline".
//   • "Appear offline" (invisible): teammates always see 'offline'.
//   • an in-roster socket with no snapshot row yet → 'online';
//   • any identity member never seen → 'offline'.
//
// `identity` is { userId: { name, avatar } } (e.g. from team members / profiles).
// `now` is injectable for deterministic tests.
const ONLINE_GRACE_MS = 5 * 60 * 1000;        // heartbeat recency = "at the PC"
const OFFLINE_AFTER_MS = 12 * 60 * 60 * 1000; // absent this long → offline; below → away

// What a LIVE (heartbeating) person should show.
function liveAvailability(r, now) {
  const ovValid =
    r.override_availability &&
    (!r.override_expires_at || Date.parse(r.override_expires_at) > now);
  if (ovValid) return normAvailability(r.override_availability); // manual choice wins
  const a = normAvailability(r.availability);
  // They're heartbeating, so they're at the PC — a self-idle 'away' or a
  // sweep/stale 'offline' must not show while they're live. Real environmental
  // states (focusing/meeting/lunch/commuting) still show through.
  return a === "away" || a === "offline" ? "online" : a;
}

export function mergeOfficePresence(rows = [], online = [], identity = {}, now = Date.now()) {
  const onlineById = new Map(online.map((o) => [o.user_id, o]));
  const byId = new Map();
  const nameOf = (id, ...fallbacks) => fallbacks.find(Boolean) || identity[id]?.name || "";
  const avatarOf = (id, ...fallbacks) => fallbacks.find(Boolean) || identity[id]?.avatar || "";

  for (const r of rows) {
    const lastSeen = r.last_seen_at ? Date.parse(r.last_seen_at) : 0;
    const age = lastSeen > 0 ? now - lastSeen : Infinity;
    // "Appear offline" hides liveness from teammates entirely.
    const live = !r.invisible && (onlineById.has(r.user_id) || age < ONLINE_GRACE_MS);
    const roster = onlineById.get(r.user_id);

    if (live) {
      byId.set(r.user_id, {
        userId: r.user_id,
        online: true,
        availability: liveAvailability(r, now),
        activity:
          r.activity_private || !r.activity_label
            ? null
            : { label: r.activity_label, link: r.activity_link },
        message: r.override_message || null,
        locationKind: r.location_kind,
        locationRoomId: r.location_room_id,
        since: r.since,
        name: nameOf(r.user_id, roster?.name),
        avatar: avatarOf(r.user_id, roster?.avatar_url),
      });
    } else {
      // Absent: away for the first 12h, then offline. (Invisible collapses
      // straight to offline — age is irrelevant when hiding.)
      const availability = r.invisible ? "offline" : age < OFFLINE_AFTER_MS ? "away" : "offline";
      byId.set(r.user_id, {
        userId: r.user_id,
        online: false,
        availability,
        activity: null,
        message: null,
        locationKind: "none",
        locationRoomId: null,
        since: r.since,
        name: nameOf(r.user_id),
        avatar: avatarOf(r.user_id),
      });
    }
  }

  for (const o of online) {
    if (byId.has(o.user_id)) continue;
    byId.set(o.user_id, {
      userId: o.user_id,
      online: true,
      availability: "online", // live socket, no snapshot row yet
      activity: null,
      message: null,
      locationKind: "none",
      locationRoomId: null,
      since: null,
      name: nameOf(o.user_id, o.name),
      avatar: avatarOf(o.user_id, o.avatar_url),
    });
  }

  for (const id of Object.keys(identity)) {
    if (byId.has(id)) continue;
    byId.set(id, {
      userId: id,
      online: false,
      availability: "offline", // never seen
      activity: null,
      message: null,
      locationKind: "none",
      locationRoomId: null,
      since: null,
      name: identity[id]?.name || "",
      avatar: identity[id]?.avatar || "",
    });
  }

  return [...byId.values()];
}
