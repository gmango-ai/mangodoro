import { writeOverride, clearOverride } from "./statusOverride";
import { setPresenceOverride, clearPresenceOverride } from "./userPresence";

// New availability → legacy presence_state (the vocabulary the DB CHECK
// constraint + existing room/hallway surfaces still use). Keeps write-through
// within the allowed enum: active/available/heads_down/in_meeting/away/
// out_to_lunch/commuting.
export const AVAIL_TO_LEGACY = {
  available: "available",
  pairing: "available",
  focusing: "heads_down",
  in_meeting: "in_meeting",
  away: "away",
  lunch: "out_to_lunch",
  commuting: "commuting",
  off: "away",
  offline: "away",
};

// Set a manual status override and mirror it everywhere IMMEDIATELY: localStorage
// (instant, offline) + user_presence + the legacy user_settings / sync-participant
// surfaces. The resolver (PresenceResolver) keeps all of it fresh afterwards; the
// immediate mirror just avoids a tick of lag. Pass the context fns.
export function applyStatusOverride({
  availability,
  message = null,
  expiresAt = null,
  userId,
  syncSession,
  updateStatus,
  setStatus,
}) {
  writeOverride({ availability, message, expiresAt });
  if (userId) setPresenceOverride({ userId, availability, message, expiresAt });
  const legacy = AVAIL_TO_LEGACY[availability] || "active";
  updateStatus?.({ presenceState: legacy, status: message || "" });
  if (syncSession) setStatus?.({ presenceState: legacy, status: message || "" });
}

// Clear the override (back to auto-derived) and return the legacy surfaces to
// neutral so the resolver's derivation takes back over.
export function clearStatusOverride({ userId, syncSession, updateStatus, setStatus }) {
  clearOverride();
  if (userId) clearPresenceOverride(userId);
  updateStatus?.({ presenceState: "active", status: "" });
  if (syncSession) setStatus?.({ presenceState: "active", status: "" });
}
