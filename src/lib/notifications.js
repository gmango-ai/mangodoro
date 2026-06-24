import { supabase } from "../supabase";

// Notification type registry — single source of truth for the Settings UI
// (per-type toggles) and the default channel set. Mirrors the SQL defaults in
// notif_type_default_channels (migration 20260623170000). All types default
// enabled; they differ only in default channels.
export const NOTIFICATION_TYPES = [
  { type: "session_started", label: "Teammate started focusing", description: "Someone on your team starts a focus session.", channels: ["inapp", "desktop"] },
  { type: "follow_focus", label: "Someone you follow is focusing", description: "A person you follow starts a focus session.", channels: ["inapp", "desktop"] },
  { type: "mention", label: "Mentions", description: "You're @mentioned in room chat or a whiteboard comment.", channels: ["inapp", "desktop"] },
  { type: "room_joined", label: "Someone joined your room", description: "A teammate joins a room you're in.", channels: ["inapp"] },
  { type: "lunch_return", label: "Back from lunch", description: "A teammate is back from lunch.", channels: ["inapp"] },
  { type: "reminder_daily", label: "Daily log reminder", description: "A nudge if you haven't logged hours by your reminder time.", channels: ["inapp", "desktop"] },
];

export const typeMeta = (type) => NOTIFICATION_TYPES.find((t) => t.type === type) || null;
export const typeLabel = (type) => typeMeta(type)?.label || type;

// Client-side emit — for app-open, single-recipient cases (e.g. @mentions, where
// the sender already knows the recipient). Server triggers cover multi-recipient
// awareness. Mirrors the emit_notification RPC signature.
export async function emitNotification(args) {
  const { error, data } = await supabase.rpc("emit_notification", {
    p_recipient: args.recipient,
    p_type: args.type,
    p_title: args.title,
    p_body: args.body ?? null,
    p_payload: args.payload ?? {},
    p_actor: args.actor ?? null,
    p_team_id: args.teamId ?? null,
    p_entity_type: args.entityType ?? null,
    p_entity_id: args.entityId ?? null,
    p_dedupe_key: args.dedupeKey ?? null,
    p_dedupe_window_minutes: args.dedupeWindowMinutes ?? 60,
  });
  if (error) { console.warn("emit_notification:", error.message); return null; }
  return data;
}

export async function listNotifications(limit = 40) {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) { console.warn("listNotifications:", error.message); return []; }
  return data || [];
}

export async function markRead(id) {
  if (!id) return;
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
}

export async function markAllRead() {
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
}

// ── Follows ("notify me when [X] starts focusing") ──
export async function listFollows(kind = "focus_start") {
  const { data } = await supabase.from("notification_follows").select("target_user_id, kind").eq("kind", kind);
  return (data || []).map((r) => r.target_user_id);
}

export async function followUser(followerId, targetUserId, kind = "focus_start") {
  if (!followerId || !targetUserId) return;
  await supabase
    .from("notification_follows")
    .upsert({ follower_user_id: followerId, target_user_id: targetUserId, kind }, { onConflict: "follower_user_id,target_user_id,kind", ignoreDuplicates: true });
}

export async function unfollowUser(targetUserId, kind = "focus_start") {
  if (!targetUserId) return;
  await supabase.from("notification_follows").delete().eq("target_user_id", targetUserId).eq("kind", kind);
}
