import { legacyToAvailability } from "./presence";

// Merge user_presence snapshot rows with the live team-presence roster into one
// office-wide status list. PURE (no I/O) so it's unit-testable; useOfficePresence
// supplies the live inputs.
//
//   • availability = the person's resolved snapshot WHEN live, but forced to
//     'offline' when their socket is gone (a snapshot can't self-clear on a
//     closed tab — liveness is the source of truth for online/offline);
//   • name/avatar come from the liveness roster;
//   • an online person with no snapshot row yet falls back to their legacy
//     presence_state, bridged onto the new vocabulary.
export function mergeOfficePresence(rows = [], online = []) {
  const onlineById = new Map(online.map((o) => [o.user_id, o]));
  const byId = new Map();

  for (const r of rows) {
    const live = onlineById.get(r.user_id);
    byId.set(r.user_id, {
      userId: r.user_id,
      online: !!live,
      availability: live ? r.availability : "offline",
      activity:
        r.activity_private || !r.activity_label
          ? null
          : { label: r.activity_label, link: r.activity_link },
      locationKind: r.location_kind,
      locationRoomId: r.location_room_id,
      since: r.since,
      name: live?.name || "",
      avatar: live?.avatar_url || "",
    });
  }

  for (const o of online) {
    if (byId.has(o.user_id)) continue;
    byId.set(o.user_id, {
      userId: o.user_id,
      online: true,
      availability: legacyToAvailability(o.presence_state),
      activity: null,
      locationKind: "none",
      locationRoomId: null,
      since: null,
      name: o.name || "",
      avatar: o.avatar_url || "",
    });
  }

  return [...byId.values()];
}
