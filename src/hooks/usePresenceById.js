import { useMemo } from "react";
import { useOfficePresence } from "./useOfficePresence";

// userId -> resolved availability, from the single source (user_presence via
// useOfficePresence + realtime liveness). For occupant / participant surfaces
// migrating off the legacy participant `presence_state`. useOfficePresence is a
// refcounted singleton, so many callers share one subscription.
export function usePresenceById() {
  const people = useOfficePresence();
  return useMemo(() => {
    const m = new Map();
    for (const p of people) m.set(p.userId, p.availability);
    return m;
  }, [people]);
}
