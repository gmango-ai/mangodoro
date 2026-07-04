import { supabase } from "../supabase";

// user_presence — read/write layer over the resolved status snapshot (seam ①).
// The client resolves status (src/lib/statusResolver.js), decides when to write
// (src/lib/presenceWrite.js), and persists here. Teammates + the notification
// router read it. See docs/plans/status-notification-integration.md §3.

const toIso = (v) =>
  v == null ? null : typeof v === "number" ? new Date(v).toISOString() : v;

const PRESENCE_COLUMNS =
  "user_id, team_id, availability, since, activity_label, activity_link, " +
  "activity_since, activity_private, location_kind, location_room_id, " +
  "override_availability, override_message, override_expires_at, updated_at";

// Persist my resolved snapshot.
//
// Private activity detail is REDACTED here, at write time — RLS lets teammates
// read the row, so hiding it can't be a client-render concern (Q4). Availability
// and `since` are never hidden. The override_* columns are intentionally NOT
// written here, so an automatic snapshot never clobbers a manual override
// (see setPresenceOverride / clearPresenceOverride).
export async function upsertUserPresence({
  userId,
  teamId = null,
  availability,
  since = null,
  activity = null, // { label, link, since, private } | null (resolver output)
  location = null, // { kind, roomId } | null
}) {
  if (!userId) return { error: { message: "no user" } };
  const isPrivate = !!activity?.private;
  return supabase.from("user_presence").upsert(
    {
      user_id: userId,
      team_id: teamId,
      availability,
      since: toIso(since),
      activity_label: isPrivate ? null : activity?.label ?? null,
      activity_link: isPrivate ? null : activity?.link ?? null,
      activity_since: toIso(activity?.since),
      activity_private: isPrivate,
      location_kind: location?.kind || "none",
      location_room_id: location?.roomId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
}

// Set a manual override (touches only the override_* columns — never the
// derived snapshot). The resolver reads it back on its next tick and it wins.
export async function setPresenceOverride({ userId, availability, message = null, expiresAt = null }) {
  if (!userId) return { error: { message: "no user" } };
  return supabase.from("user_presence").upsert(
    {
      user_id: userId,
      override_availability: availability,
      override_message: message,
      override_expires_at: toIso(expiresAt),
      override_set_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
}

export async function clearPresenceOverride(userId) {
  if (!userId) return { error: { message: "no user" } };
  return supabase.from("user_presence").upsert(
    {
      user_id: userId,
      override_availability: null,
      override_message: null,
      override_expires_at: null,
      override_set_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
}

// My own row (with override_* so the resolver can read its own override back).
export async function getMyPresence(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from("user_presence")
    .select(PRESENCE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("getMyPresence:", error.message);
    return null;
  }
  return data;
}

// Everyone I'm allowed to see (RLS = own + teammates). Powers the office-wide
// roster; realtime liveness (online/offline) is overlaid from useTeamPresence.
export async function listTeamPresence() {
  const { data, error } = await supabase.from("user_presence").select(PRESENCE_COLUMNS);
  if (error) {
    console.warn("listTeamPresence:", error.message);
    return [];
  }
  return data || [];
}
