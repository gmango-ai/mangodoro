import { writeOverride, clearOverride, writePin, clearPin, writeInvisible } from "./statusOverride";
import { setPresenceOverride, clearPresenceOverride, setPresencePin, setPresenceInvisible } from "./userPresence";
import { normAvailability } from "./presence";

// Smart default expiry so the user never has to pick a "clear after": a manual
// override just clears overnight. End of the local day — but if that's less than
// 4h away, roll to the next night so a late-evening status still lasts the
// evening instead of vanishing at midnight. The resolver ignores an expired
// override and the server sweep (sweep_presence) clears it for teammates too, so
// stale statuses can't carry into the next day even with the tab closed.
export function defaultOverrideExpiry(now = Date.now()) {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  if (d.getTime() - now < 4 * 60 * 60 * 1000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

// Set a manual status override and mirror it everywhere IMMEDIATELY: localStorage
// (instant, offline) + user_presence (teammates) + the free-text status message
// on user_settings (org/profile surfaces). The resolver (PresenceResolver) keeps
// it fresh afterwards; the immediate mirror just avoids a tick of lag. Availability
// lives ONLY in user_presence now — no legacy presence_state anywhere. `expiresAt`
// defaults to "clears overnight"; pass an explicit time (e.g. lunch end) to
// override, or `null` to persist until manually cleared.
export function applyStatusOverride({
  availability,
  message = null,
  emoji = null,
  expiresAt,
  userId,
  updateStatus,
}) {
  const a = normAvailability(availability);
  const exp = expiresAt === undefined ? defaultOverrideExpiry() : expiresAt;
  writeOverride({ availability: a, message, emoji, expiresAt: exp });
  if (userId) setPresenceOverride({ userId, availability: a, message, emoji, expiresAt: exp });
  updateStatus?.({ status: message || "" });
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

// Clear the override (back to auto-derived) and clear the free-text status
// message so the resolver's derivation takes back over.
export function clearStatusOverride({ userId, updateStatus }) {
  clearOverride();
  if (userId) clearPresenceOverride(userId);
  updateStatus?.({ status: "" });
}
