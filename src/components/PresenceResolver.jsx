import { useEffect, useRef } from "react";
import { useResolvedSelf } from "../hooks/useResolvedSelf";
import { presenceSignature, shouldWritePresence } from "../lib/presenceWrite";
import { upsertUserPresence } from "../lib/userPresence";
import { recordPresenceSample } from "../hooks/usePresenceTimeline";

// Seam ① persistence: take the live resolved status (useResolvedSelf) and write
// it to user_presence — throttled, with availability transitions bypassing the
// throttle so the notification router's snapshot stays fresh (plan §3.3).
//
// A mount-once effect component, like IdlePresence / PresenceSync. All the
// resolution logic lives in useResolvedSelf + the pure modules it composes;
// this is just the write cadence + decision.
//
// NOT YET RENDERED in App.jsx — inert until the user_presence migration reaches
// the shared DB + a reader exists, so it can go live and be observed together.

export default function PresenceResolver() {
  const { resolved, userId, teamId } = useResolvedSelf();

  const ref = useRef({});
  ref.current = { resolved, userId, teamId };

  const wr = useRef({ prevSig: null, lastWriteAt: null });

  useEffect(() => {
    if (!userId) return undefined;

    const tick = async () => {
      const s = ref.current;
      if (!s.userId || !s.resolved) return;
      const now = Date.now();

      // Device-local active/away/offline timeline (verification tool) — DB-free,
      // so it works even before the migration lands.
      recordPresenceSample(s.resolved.availability, now);

      const nextSig = presenceSignature(s.resolved);
      const { write } = shouldWritePresence(wr.current.prevSig, nextSig, wr.current.lastWriteAt, now);
      if (!write) return;

      wr.current.prevSig = nextSig;
      wr.current.lastWriteAt = now;
      try {
        await upsertUserPresence({
          userId: s.userId,
          teamId: s.teamId,
          availability: s.resolved.availability,
          since: s.resolved.since,
          activity: s.resolved.activity,
          location: s.resolved.location,
        });
      } catch {
        /* best-effort; next tick retries */
      }
    };

    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, [userId]);

  return null;
}
