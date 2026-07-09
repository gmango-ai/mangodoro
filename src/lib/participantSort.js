// Shared, stable ordering for the room / sync-session participant list.
//
// The list shuffled because the participant rows arrive in no fixed order
// (the DB query has no ORDER BY, and a row jumps position whenever someone's
// presence/status updates → refetch). This module gives every list that
// renders `syncParticipants` ONE deterministic order, plus a per-user choice
// of sort key that is shared across all those lists in the tab (and persisted).
//
// "You" is always first and the leader second; everyone else is sorted by the
// chosen key with join-time + user_id tiebreakers, so the order never changes
// on a refetch.

const STORAGE_KEY = "ql_participant_sort_v1";

export const PARTICIPANT_SORTS = [
  { key: "join", label: "Join time" },
  { key: "name", label: "Name (A–Z)" },
  { key: "presence", label: "Presence" },
];
const VALID = new Set(PARTICIPANT_SORTS.map((s) => s.key));
export const DEFAULT_SORT = "join";

// Grouping order for the "presence" sort — the 7-state availability vocabulary
// (most-present first). Resolved per user via the availabilityOf lookup.
const PRESENCE_RANK = {
  online: 0,
  focusing: 1,
  meeting: 2,
  lunch: 3,
  commuting: 3,
  away: 4,
  offline: 5,
};

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && VALID.has(v) ? v : DEFAULT_SORT;
  } catch {
    return DEFAULT_SORT;
  }
}

// Tiny external store so every participant list in the tab reflects the same
// choice the instant it changes, without prop-drilling through three trees.
let current = readStored();
const listeners = new Set();

export function getParticipantSort() {
  return current;
}

export function setParticipantSort(mode) {
  if (!VALID.has(mode) || mode === current) return;
  current = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore unavailable storage */
  }
  listeners.forEach((l) => l());
}

export function subscribeParticipantSort(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Cross-tab: adopt a choice made in another tab/window.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    const next = e.newValue && VALID.has(e.newValue) ? e.newValue : DEFAULT_SORT;
    if (next !== current) {
      current = next;
      listeners.forEach((l) => l());
    }
  });
}

function joinedTime(p) {
  const t = p?.joined_at ? new Date(p.joined_at).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
}

// Total-order comparator for the un-pinned "rest". Join time is the primary
// key for "join" and the tiebreaker for the other modes; user_id is the final,
// never-changing tiebreaker so the order is fully deterministic.
function comparator(mode, availabilityOf) {
  return (a, b) => {
    if (mode === "name") {
      const c = (a.display_name || "").localeCompare(b.display_name || "", undefined, {
        sensitivity: "base",
      });
      if (c) return c;
    } else if (mode === "presence") {
      const ar = PRESENCE_RANK[availabilityOf?.(a.user_id)] ?? 99;
      const br = PRESENCE_RANK[availabilityOf?.(b.user_id)] ?? 99;
      if (ar !== br) return ar - br;
    }
    const at = joinedTime(a);
    const bt = joinedTime(b);
    if (at !== bt) return at - bt;
    return String(a.user_id).localeCompare(String(b.user_id));
  };
}

// Stable ordering: `you` first, then the `leader`, then the rest by `mode`.
// Returns a new array; never mutates the input.
export function sortParticipants(list, { mode = DEFAULT_SORT, userId, leaderId, availabilityOf } = {}) {
  let self = null;
  let leader = null;
  const rest = [];
  for (const p of list || []) {
    if (userId && p.user_id === userId) self = p;
    else if (leaderId && p.user_id === leaderId) leader = p;
    else rest.push(p);
  }
  rest.sort(comparator(VALID.has(mode) ? mode : DEFAULT_SORT, availabilityOf));
  const out = [];
  if (self) out.push(self);
  if (leader) out.push(leader);
  return out.concat(rest);
}
