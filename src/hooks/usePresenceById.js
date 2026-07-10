import { useMemo } from "react";
import { useOfficePresence } from "./useOfficePresence";

// userId -> { availability, message, activity }, from the single source
// (user_presence via useOfficePresence + realtime liveness). THE presence lookup
// for occupant / participant surfaces (they read .availability and .message).
// useOfficePresence is a refcounted singleton, so callers share one subscription.
export function usePresenceById() {
  const people = useOfficePresence();
  return useMemo(() => {
    const m = new Map();
    for (const p of people) m.set(p.userId, { availability: p.availability, message: p.message || null, activity: p.activity || null });
    return m;
  }, [people]);
}
