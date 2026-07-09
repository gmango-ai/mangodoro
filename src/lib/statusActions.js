import { writeOverride, clearOverride, writePin, clearPin, writeInvisible } from "./statusOverride";
import { setPresenceOverride, clearPresenceOverride, setPresencePin, setPresenceInvisible } from "./userPresence";
import { normAvailability } from "./presence";

// New 7-state availability → legacy presence_state (the vocabulary the legacy
// user_settings / sync-participant RPCs still require, until P2/P5 retire them).
// Keyed on the normalized 7-state names; old aliases fold via normAvailability.
export const AVAIL_TO_LEGACY = {
  online:    "available",
  focusing:  "heads_down",
  meeting:   "in_meeting",
  lunch:     "out_to_lunch",
  commuting: "commuting",
  away:      "away",
  offline:   "away",
};

// Set a manual status override and mirror it everywhere IMMEDIATELY: localStorage
// (instant, offline) + user_presence + the legacy user_settings / sync-participant
// surfaces. The resolver (PresenceResolver) keeps all of it fresh afterwards; the
// immediate mirror just avoids a tick of lag. Pass the context fns.
export function applyStatusOverride({
  availability,
  message = null,
  emoji = null,
  expiresAt = null,
  userId,
  syncSession,
  updateStatus,
  setStatus,
}) {
  const a = normAvailability(availability);
  writeOverride({ availability: a, message, emoji, expiresAt });
  if (userId) setPresenceOverride({ userId, availability: a, message, emoji, expiresAt });
  const legacy = AVAIL_TO_LEGACY[a] || "available";
  updateStatus?.({ presenceState: legacy, status: message || "" });
  if (syncSession) setStatus?.({ presenceState: legacy, status: message || "" });
}

// Pin ("keep my status" through idle) for 24h; auto re-enables after that.
const PIN_MS = 24 * 60 * 60 * 1000;
export function setStatusPin({ userId, on, now = Date.now() }) {
  const until = on ? now + PIN_MS : null;
  if (on) writePin(until); else clearPin();
  if (userId) setPresencePin(userId, until);
}

// "Appear offline" — self keeps its real state; teammates see offline.
export function setStatusInvisible({ userId, on }) {
  writeInvisible(on);
  if (userId) setPresenceInvisible(userId, on);
}

// Clear the override (back to auto-derived) and return the legacy surfaces to
// neutral so the resolver's derivation takes back over.
export function clearStatusOverride({ userId, syncSession, updateStatus, setStatus }) {
  clearOverride();
  if (userId) clearPresenceOverride(userId);
  updateStatus?.({ presenceState: "active", status: "" });
  if (syncSession) setStatus?.({ presenceState: "active", status: "" });
}
