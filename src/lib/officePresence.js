import { legacyToAvailability } from "./presence";

// Merge user_presence snapshot rows with the live team-presence roster into one
// office-wide status list. PURE (no I/O) so it's unit-testable; useOfficePresence
// supplies the live inputs.
//
//   • availability = the person's resolved snapshot WHEN live, but forced to
//     'offline' when their socket is gone (a snapshot can't self-clear on a
//     closed tab — liveness is the source of truth for online/offline);
//   • name/avatar come from the liveness roster, then the identity map (so
//     OFFLINE people — absent from the live roster — still have a name/avatar);
//   • an online person with no snapshot row yet falls back to their legacy
//     presence_state, bridged onto the new vocabulary;
//   • any identity member not otherwise present is included as offline, so the
//     roster shows the whole team, not just who's been seen recently.
//
// `identity` is { userId: { name, avatar } } (e.g. from team members / profiles).
export function mergeOfficePresence(rows = [], online = [], identity = {}) {
  const onlineById = new Map(online.map((o) => [o.user_id, o]));
  const byId = new Map();
  const nameOf = (id, ...fallbacks) => fallbacks.find(Boolean) || identity[id]?.name || "";
  const avatarOf = (id, ...fallbacks) => fallbacks.find(Boolean) || identity[id]?.avatar || "";

  for (const r of rows) {
    // "Appear offline" — teammates see them offline regardless of liveness.
    const live = r.invisible ? null : onlineById.get(r.user_id);
    byId.set(r.user_id, {
      userId: r.user_id,
      online: !!live,
      availability: live ? r.availability : "offline",
      activity:
        r.activity_private || !r.activity_label
          ? null
          : { label: r.activity_label, link: r.activity_link },
      locationKind: live ? r.location_kind : "none",
      locationRoomId: live ? r.location_room_id : null,
      since: r.since,
      name: nameOf(r.user_id, live?.name),
      avatar: avatarOf(r.user_id, live?.avatar_url),
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
      name: nameOf(o.user_id, o.name),
      avatar: avatarOf(o.user_id, o.avatar_url),
    });
  }

  for (const id of Object.keys(identity)) {
    if (byId.has(id)) continue;
    byId.set(id, {
      userId: id,
      online: false,
      availability: "offline",
      activity: null,
      locationKind: "none",
      locationRoomId: null,
      since: null,
      name: identity[id]?.name || "",
      avatar: identity[id]?.avatar || "",
    });
  }

  return [...byId.values()];
}
