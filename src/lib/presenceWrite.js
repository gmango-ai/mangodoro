// When to persist a resolved status to user_presence — pure + testable.
//
// The resolver runs often (any signal tick), but we don't want a DB write on
// every tick. The rule (plan §3.3 / Q1): an availability *transition* — or any
// change the notification router must see promptly (override, location) —
// writes IMMEDIATELY so the server snapshot stays fresh; low-signal activity
// churn (a task label edit) is throttled.

export const ACTIVITY_THROTTLE_MS = 30 * 1000;

// A compact comparable fingerprint of the fields we persist.
export function presenceSignature(s = {}) {
  return {
    availability: s.availability ?? null,
    overrideAvailability: s.override?.availability ?? null,
    overrideExpiresAt: s.override?.expiresAt ?? null,
    locationKind: s.location?.kind ?? "none",
    locationRoomId: s.location?.roomId ?? null,
    activityLabel: s.activity?.label ?? null,
    activityLink: s.activity?.link ?? null,
    activityPrivate: s.activity?.private ?? false,
  };
}

// Decide whether to write, given the last-written signature.
// @returns {{ write: boolean, reason: string }}
export function shouldWritePresence(prevSig, nextSig, lastWriteAt, now) {
  if (!prevSig) return { write: true, reason: "first" };

  // Transitions bypass the throttle — the router reads these off the snapshot.
  const transition =
    prevSig.availability !== nextSig.availability ||
    prevSig.overrideAvailability !== nextSig.overrideAvailability ||
    prevSig.overrideExpiresAt !== nextSig.overrideExpiresAt ||
    prevSig.locationKind !== nextSig.locationKind ||
    prevSig.locationRoomId !== nextSig.locationRoomId ||
    prevSig.activityPrivate !== nextSig.activityPrivate;
  if (transition) return { write: true, reason: "transition" };

  // Activity label/link churn is throttled.
  const activityChanged =
    prevSig.activityLabel !== nextSig.activityLabel ||
    prevSig.activityLink !== nextSig.activityLink;
  if (activityChanged) {
    if (lastWriteAt == null || now - lastWriteAt >= ACTIVITY_THROTTLE_MS)
      return { write: true, reason: "activity" };
    return { write: false, reason: "throttled" };
  }

  return { write: false, reason: "unchanged" };
}
