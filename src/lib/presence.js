// THE single presence vocabulary for the whole app.
//
// The status resolver (src/lib/statusResolver.js) collapses every signal into
// ONE of these 7 coarse states — the projection stored on
// `user_presence.availability` — and every surface (nav chip, roster, room
// sidebar, avatars, chat dots) renders from this one table so a glance reads
// the same everywhere. Keeping the dot / ring / label / light maps here is why
// we don't drift half a dozen slightly-different color tables (we used to).
//
// `light` is the interruptibility traffic-signal that answers the real
// question — "can I ping them right now?":
//   green = free · yellow = busy but reachable · red = do-not-disturb ·
//   grey  = away / offline.
// Dot + ring hues stay distinct per state for readability, but every state
// collapses to one of those four lights (which also drives notification DND).
export const AVAILABILITY = {
  online:    { label: "Online",       dot: "bg-emerald-500", ring: "ring-emerald-500", light: "green" },
  focusing:  { label: "Focusing",     dot: "bg-violet-500",  ring: "ring-violet-500",  light: "red" },
  meeting:   { label: "In a meeting", dot: "bg-rose-500",    ring: "ring-rose-500",    light: "red" },
  lunch:     { label: "On lunch",     dot: "bg-orange-400",  ring: "ring-orange-400",  light: "grey" },
  commuting: { label: "Commuting",    dot: "bg-cyan-500",    ring: "ring-cyan-500",    light: "grey" },
  away:      { label: "Away",         dot: "bg-slate-400",   ring: "ring-slate-400",   light: "grey" },
  offline:   { label: "Offline",      dot: "bg-slate-300",   ring: "ring-slate-300",   light: "grey" },
};

// Canonical order for pickers / legends.
export const AVAILABILITY_ORDER = ["online", "focusing", "meeting", "lunch", "commuting", "away", "offline"];

// Fold the OLD availability vocabulary (available/pairing/in_meeting/off) onto
// the new 7 during the transition. `pairing` collapses to `online` — the
// "pairing with X" detail rides on activity_label now, not the coarse state.
const AVAILABILITY_ALIAS = {
  available:  "online",
  active:     "online",
  pairing:    "online",
  in_meeting: "meeting",
  off:        "offline",
};

// Normalize any availability value (new key, old alias, or junk) to a valid
// 7-state key. Everything below funnels through this, so mixed old/new rows
// during the migration still render correctly.
export const normAvailability = (a) => {
  if (a && AVAILABILITY[a]) return a;
  return (a && AVAILABILITY_ALIAS[a]) || "offline";
};

// ── Availability lookups (accept a new key OR an old alias) ────────────────
export const availabilityMeta  = (a) => AVAILABILITY[normAvailability(a)];
export const availabilityDot   = (a) => availabilityMeta(a).dot;
export const availabilityRing  = (a) => availabilityMeta(a).ring;
export const availabilityLabel = (a) => availabilityMeta(a).label;
export const availabilityLight = (a) => availabilityMeta(a).light;

// The availability to SHOW for an occupant/participant: the canonical
// user_presence value (from a userId->availability map, e.g. usePresenceById).
// A missing row OR a lagging 'offline' falls back to `fallback` (default
// 'online') — an occupant is definitionally present, so it shouldn't be hidden
// by a not-yet-written or stale-offline snapshot.
export function shownAvailability(userId, presenceById, fallback = "online") {
  const a = presenceById && typeof presenceById.get === "function" ? presenceById.get(userId)?.availability : null;
  return a && a !== "offline" ? a : fallback;
}
