// Shared presence vocabulary for occupant avatars across the office.
//
// `presence_state` rides along on each participant row (auto-derived
// from pomodoro + video state) and is rendered in several places — room
// tiles, the hallway presence bar, participant lists. Keeping the dot /
// ring / label maps here means a glance reads the same everywhere and we
// don't drift three slightly-different copies of the color table.
// Colors + labels mirror the new availability vocabulary below (the resolver
// write-through maps availability → these legacy keys), so a surface rendering
// via presence_state matches the StatusChip: available = emerald, heads_down/
// focusing = violet, in_meeting = rose, away = slate, lunch = orange.
export const PRESENCE_DOT = {
  active: "bg-emerald-500",
  available: "bg-emerald-500",
  heads_down: "bg-violet-500",
  in_meeting: "bg-rose-500",
  away: "bg-slate-400",
  out_to_lunch: "bg-orange-400",
  commuting: "bg-cyan-500",
};

export const PRESENCE_RING = {
  active: "ring-emerald-500",
  available: "ring-emerald-500",
  heads_down: "ring-violet-500",
  in_meeting: "ring-rose-500",
  away: "ring-slate-400",
  out_to_lunch: "ring-orange-400",
  commuting: "ring-cyan-500",
};

export const PRESENCE_LABEL = {
  active: "Available", // 'active' is unified into 'available' in the new model
  available: "Available",
  heads_down: "Focusing",
  in_meeting: "In a meeting",
  away: "Away",
  out_to_lunch: "On lunch",
  commuting: "Commuting",
};

// Unknown / missing states fall back to "active" — the neutral
// in-a-session default the participant query already applies.
export const presenceDot = (state) => PRESENCE_DOT[state] || PRESENCE_DOT.active;
export const presenceRing = (state) => PRESENCE_RING[state] || PRESENCE_RING.active;
export const presenceLabel = (state) => PRESENCE_LABEL[state] || PRESENCE_LABEL.active;

// ── Unified availability vocabulary (status resolver) ──────────────────
// The resolver (src/lib/statusResolver.js) collapses every signal into ONE of
// these coarse states — the projection stored on `user_presence.availability`.
// It supersedes the legacy presence_state names above during the transition;
// `legacyToAvailability` bridges old writers so mixed rows still render right.
//
// `light` is the interruptibility traffic-signal that actually answers the
// question a teammate has — "can I ping them right now?":
//   green  = free · yellow = busy but reachable (pairing) ·
//   red    = do-not-disturb · grey = away / off / offline.
// Dot + ring hues stay distinct per-state for readability, but every state
// collapses to one of those four lights.
export const AVAILABILITY_LIGHT = {
  available:  "green",
  pairing:    "yellow",
  focusing:   "red",
  in_meeting: "red",
  away:       "grey",
  lunch:      "grey",
  commuting:  "grey",
  off:        "grey",
  offline:    "grey",
};

export const AVAILABILITY_LABEL = {
  available:  "Available",
  pairing:    "Pairing",
  focusing:   "Focusing",
  in_meeting: "In a meeting",
  away:       "Away",
  lunch:      "On lunch",
  commuting:  "Commuting",
  off:        "Off",
  offline:    "Offline",
};

export const AVAILABILITY_DOT = {
  available:  "bg-emerald-500",
  pairing:    "bg-amber-500",
  focusing:   "bg-violet-500",
  in_meeting: "bg-rose-500",
  away:       "bg-slate-400",
  lunch:      "bg-orange-400",
  commuting:  "bg-cyan-500",
  off:        "bg-slate-400",
  offline:    "bg-slate-300",
};

export const AVAILABILITY_RING = {
  available:  "ring-emerald-500",
  pairing:    "ring-amber-500",
  focusing:   "ring-violet-500",
  in_meeting: "ring-rose-500",
  away:       "ring-slate-400",
  lunch:      "ring-orange-400",
  commuting:  "ring-cyan-500",
  off:        "ring-slate-400",
  offline:    "ring-slate-300",
};

// Bridge the legacy presence_state vocab (active/available/heads_down/
// in_meeting/away/out_to_lunch/commuting) onto the new availability names.
export const LEGACY_TO_AVAILABILITY = {
  active:       "available",
  available:    "available",
  heads_down:   "focusing",
  in_meeting:   "in_meeting",
  away:         "away",
  out_to_lunch: "lunch",
  commuting:    "commuting",
};
export const legacyToAvailability = (state) =>
  LEGACY_TO_AVAILABILITY[state] || "available";

export const availabilityLight = (a) => AVAILABILITY_LIGHT[a] || "grey";
export const availabilityLabel = (a) => AVAILABILITY_LABEL[a] || AVAILABILITY_LABEL.offline;
export const availabilityDot = (a) => AVAILABILITY_DOT[a] || AVAILABILITY_DOT.offline;
export const availabilityRing = (a) => AVAILABILITY_RING[a] || AVAILABILITY_RING.offline;
