import { useCallback, useEffect, useRef } from "react";
import { useResolvedSelf } from "../hooks/useResolvedSelf";
import { useApp } from "../context/AppContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { presenceSignature, shouldWritePresence } from "../lib/presenceWrite";
import { upsertUserPresence } from "../lib/userPresence";
import { recordPresenceSample } from "../hooks/usePresenceTimeline";
import { AVAIL_TO_LEGACY } from "../lib/statusActions";

// Seam ① persistence + the app's SINGLE status writer. Takes the live resolved
// status (useResolvedSelf) and writes it everywhere:
//   • user_presence — the new snapshot (throttled; transitions bypass);
//   • user_settings.presence_state (+ status) via updateStatus — which also
//     feeds the realtime team-presence channel through PresenceSync;
//   • sync_session_participants status via setStatus, when in a room.
// Because the resolver owns these, the old competing writers are retired:
// IdlePresence no longer writes status, and the in-room StatusSetter now sets
// the manual override (which the resolver reads). Legacy writes are deduped on
// the mapped value. Mount-once, like IdlePresence / PresenceSync.

export default function PresenceResolver() {
  const { resolved, userId, teamId } = useResolvedSelf();
  const { updateStatus } = useApp();
  const { syncSession, setStatus } = useSyncSession();

  const ref = useRef({});
  ref.current = { resolved, userId, teamId, syncSession, updateStatus, setStatus };

  const wr = useRef({ prevSig: null, lastWriteAt: null, legacySig: null });
  const overrideSigRef = useRef(null);

  const tick = useCallback(async (force = false) => {
    const s = ref.current;
    if (!s.userId || !s.resolved) return;
    const now = Date.now();

    // Device-local active/away/offline timeline (verification tool).
    recordPresenceSample(s.resolved.availability, now);

    // Write-through to the legacy surfaces, deduped on the mapped value so we
    // don't re-hit the RPCs every tick. (Manual set/clear already mirror
    // immediately via statusActions; this covers auto-derived changes.)
    const legacy = AVAIL_TO_LEGACY[s.resolved.availability] || "active";
    const statusText = s.resolved.override?.message || "";
    const roomId = s.syncSession?.id || null;
    const legacySig = `${legacy}|${statusText}|${roomId}`;
    if (legacySig !== wr.current.legacySig) {
      wr.current.legacySig = legacySig;
      try { s.updateStatus?.({ presenceState: legacy, status: statusText }); } catch { /* */ }
      if (s.syncSession) { try { s.setStatus?.({ presenceState: legacy, status: statusText }); } catch { /* */ } }
    }

    // user_presence snapshot (throttled / transition-bypass).
    const nextSig = presenceSignature(s.resolved);
    const { write } = shouldWritePresence(wr.current.prevSig, nextSig, wr.current.lastWriteAt, now);
    if (!force && !write) return;
    try {
      const { error } = await upsertUserPresence({
        userId: s.userId,
        teamId: s.teamId,
        availability: s.resolved.availability,
        since: s.resolved.since,
        activity: s.resolved.activity,
        location: s.resolved.location,
      });
      // Only mark the snapshot persisted on SUCCESS — otherwise a transient DB
      // error would be treated as written and never retried, leaving the row
      // stale until availability/activity changes again.
      if (!error) {
        wr.current.prevSig = nextSig;
        wr.current.lastWriteAt = now;
      }
    } catch {
      /* leave prevSig/lastWriteAt so the next tick retries */
    }
  }, []);

  useEffect(() => {
    if (!userId) return undefined;

    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, [tick, userId]);

  useEffect(() => {
    if (!userId) {
      overrideSigRef.current = null;
      return;
    }
    const overrideSig = `${resolved?.override?.availability ?? ""}|${resolved?.override?.expiresAt ?? ""}`;
    if (overrideSigRef.current == null) {
      overrideSigRef.current = overrideSig;
      return;
    }
    if (overrideSigRef.current === overrideSig) return;
    overrideSigRef.current = overrideSig;

    // Manual set/clear writes can make the DB differ from prevSig before the
    // interval sees the override transition, so force the current snapshot out.
    wr.current.prevSig = null;
    tick(true);
  }, [resolved?.override?.availability, resolved?.override?.expiresAt, tick, userId]);

  return null;
}
