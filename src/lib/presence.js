// Shared presence vocabulary for occupant avatars across the office.
//
// `presence_state` rides along on each participant row (auto-derived
// from pomodoro + video state) and is rendered in several places — room
// tiles, the hallway presence bar, participant lists. Keeping the dot /
// ring / label maps here means a glance reads the same everywhere and we
// don't drift three slightly-different copies of the color table.
export const PRESENCE_DOT = {
  active: "bg-emerald-500",
  available: "bg-sky-500",
  heads_down: "bg-violet-500",
  in_meeting: "bg-rose-500",
  away: "bg-amber-500",
};

export const PRESENCE_RING = {
  active: "ring-emerald-500",
  available: "ring-sky-500",
  heads_down: "ring-violet-500",
  in_meeting: "ring-rose-500",
  away: "ring-amber-500",
};

export const PRESENCE_LABEL = {
  active: "Active",
  available: "Available",
  heads_down: "Heads down",
  in_meeting: "In a meeting",
  away: "Away",
};

// Unknown / missing states fall back to "active" — the neutral
// in-a-session default the participant query already applies.
export const presenceDot = (state) => PRESENCE_DOT[state] || PRESENCE_DOT.active;
export const presenceRing = (state) => PRESENCE_RING[state] || PRESENCE_RING.active;
export const presenceLabel = (state) => PRESENCE_LABEL[state] || PRESENCE_LABEL.active;
