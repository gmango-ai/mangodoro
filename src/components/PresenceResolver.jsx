import { useCallback, useEffect, useRef } from "react";
import { useResolvedSelf } from "../hooks/useResolvedSelf";
import { useApp } from "../context/AppContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { usePresenceLeader } from "../hooks/usePresenceLeader";
import { presenceSignature, shouldWritePresence } from "../lib/presenceWrite";
import { upsertUserPresence, touchPresenceHeartbeat } from "../lib/userPresence";
import { recordPresenceSample } from "../hooks/usePresenceTimeline";
import { AVAIL_TO_LEGACY } from "../lib/statusActions";

// Seam ① persistence — the app's SINGLE, leader-owned status writer.
//
// Every tab computes the resolved status locally (useResolvedSelf) for its own
// UI, but only the LEADER tab (usePresenceLeader / Web Locks) persists it, so N
// open tabs no longer redundantly write user_presence. The leader:
//   • writes the user_presence snapshot (throttled; availability transitions
//     bypass the throttle), stamping last_seen_at;
//   • HEARTBEATS last_seen_at between snapshot writes so the server sweep (P3)
//     can flip a dead client to 'offline' — a closed tab can't self-clear;
//   • still mirrors to the legacy surfaces (user_settings.presence_state via
//     updateStatus, sync_session_participants via setStatus) until P4 migrates
//     those consumers onto user_presence.
// Retries: the snapshot signature is only advanced on a successful write, so a
// transient error re-attempts on the next tick instead of stranding the row.
const HEARTBEAT_MS = 45_000;

export default function PresenceResolver() {
  const { resolved, userId, teamId } = useResolvedSelf();
  const { updateStatus } = useApp();
  const { syncSession, setStatus } = useSyncSession();
  const isLeader = usePresenceLeader();

  const ref = useRef({});
  ref.current = { resolved, userId, teamId, syncSession, updateStatus, setStatus, isLeader };

  const wr = useRef({ prevSig: null, lastWriteAt: null, lastBeatAt: 0, legacySig: null });
  const overrideSigRef = useRef(null);

  const tick = useCallback(async (force = false) => {
    const s = ref.current;
    if (!s.userId || !s.resolved) return;
    const now = Date.now();

    // Device-local active/away/offline timeline (verification tool) — recorded
    // in every tab regardless of leadership (it's per-device localStorage).
    recordPresenceSample(s.resolved.availability, now);

    // Only the leader persists to the shared DB.
    if (!s.isLeader) return;

    // Write-through to the legacy surfaces, deduped on the mapped value so we
    // don't re-hit the RPCs every tick. (Manual set/clear already mirror
    // immediately via statusActions; this covers auto-derived changes.)
    const legacy = AVAIL_TO_LEGACY[s.resolved.availability] || "available";
    const statusText = s.resolved.override?.message || "";
    const roomId = s.syncSession?.id || null;
    const legacySig = `${legacy}|${statusText}|${roomId}`;
    if (legacySig !== wr.current.legacySig) {
      wr.current.legacySig = legacySig;
      try { s.updateStatus?.({ presenceState: legacy, status: statusText }); } catch { /* */ }
      if (s.syncSession) { try { s.setStatus?.({ presenceState: legacy, status: statusText }); } catch { /* */ } }
    }

    // user_presence snapshot (throttled / transition-bypass) or, if nothing
    // changed, a lightweight heartbeat so last_seen_at stays fresh.
    const nextSig = presenceSignature(s.resolved);
    const { write } = shouldWritePresence(wr.current.prevSig, nextSig, wr.current.lastWriteAt, now);
    if (force || write) {
      try {
        const { error } = await upsertUserPresence({
          userId: s.userId,
          teamId: s.teamId,
          availability: s.resolved.availability,
          since: s.resolved.since,
          activity: s.resolved.activity,
          location: s.resolved.location,
        });
        // Advance the signature only on SUCCESS — a transient DB error must
        // retry next tick, not be treated as written and stranded.
        if (!error) {
          wr.current.prevSig = nextSig;
          wr.current.lastWriteAt = now;
          wr.current.lastBeatAt = now; // a full write also refreshes last_seen_at
        }
      } catch {
        /* leave prevSig/lastWriteAt so the next tick retries */
      }
    } else if (now - wr.current.lastBeatAt >= HEARTBEAT_MS) {
      try {
        const { error } = await touchPresenceHeartbeat(s.userId);
        if (!error) wr.current.lastBeatAt = now;
      } catch { /* retry next tick */ }
    }
  }, []);

  useEffect(() => {
    if (!userId) return undefined;
    // Force a write on mount and whenever leadership changes (a freshly-elected
    // leader should publish immediately rather than wait out the throttle).
    tick(true);
    const id = setInterval(() => tick(), 15000);
    return () => clearInterval(id);
  }, [tick, userId, isLeader]);

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
