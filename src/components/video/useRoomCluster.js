import { useCallback, useEffect, useMemo, useReducer } from "react";
import { useLocalParticipant, useParticipants, useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";

// In-room audio clustering — "companion mode" for people who share a physical
// room. When several participants are together in person, ONE device acts as
// the room's mic + speaker (the leader) and the others join as muted,
// video-only "followers". That kills the echo/feedback you'd get from multiple
// live mics and speakers in the same space, while remote participants still
// hear the room (via the leader's mic) and see everyone's individual tile.
//
// State lives entirely in LiveKit participant attributes — no DB, ephemeral
// like the call itself (mirrors useRoomCallPresence's reasoning):
//   cluster          — opaque group id (the founding leader's identity)
//   clusterLeaderId  — SELF-CLAIM: a member sets this to its own identity to
//                      lead; followers leave it empty
//   roomDevice       — "1" on the org device locked to this room; it's the
//                      canonical, sticky leader (humans never lead its room)
// setAttributes does a partial merge, so these coexist with the `role`
// (publisher/spectator) attribute PublishController already sets.
//
// Leadership is SELF-CLAIMED rather than pointed-at: the effective leader is
// the cluster member whose clusterLeaderId equals its own identity (a present
// room device wins; otherwise the lowest-identity claimer). Deriving it from
// each member's own attribute — instead of copying a leader pointer at join
// time — means handoff can't leave stale pointers behind, and a device's
// claim always takes precedence.
//
// Pass { manage: true } in exactly ONE mounted instance. That instance runs:
//   • handoff — if no one leads (leader dropped), the lowest-identity survivor
//     claims leadership;
//   • yield   — if a room device is present, any human who self-claimed gives
//     it up, so the device is the sole leader.
// Read-only callers (suppression checks, UI) omit it.

export const ATTR_CLUSTER = "cluster";
export const ATTR_LEADER = "clusterLeaderId";
export const ATTR_ROOM_DEVICE = "roomDevice";

export function useRoomCluster({ manage = false } = {}) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const [, bump] = useReducer((n) => (n + 1) % 1e9, 0);

  // useParticipants re-renders on roster changes but not on attribute edits, so
  // membership/leadership would go stale when someone joins/leaves or claims a
  // room. Bump on every attribute change to keep derived state live.
  useEffect(() => {
    if (!room) return undefined;
    room.on(RoomEvent.ParticipantAttributesChanged, bump);
    return () => {
      room.off(RoomEvent.ParticipantAttributesChanged, bump);
    };
  }, [room]);

  const myId = localParticipant?.identity || null;
  const myAttrs = localParticipant?.attributes || {};
  const cluster = myAttrs[ATTR_CLUSTER] || null;

  const members = useMemo(
    () => (cluster ? participants.filter((p) => (p.attributes?.[ATTR_CLUSTER] || null) === cluster) : []),
    [participants, cluster],
  );

  // Effective leader of my cluster: a present room device wins; otherwise the
  // lowest-identity self-claimer. Derived (not stored) so it's always consistent.
  const leaderId = useMemo(() => {
    if (!cluster) return null;
    const claimers = members.filter((p) => p.attributes?.[ATTR_LEADER] === p.identity);
    const device = claimers.find((p) => p.attributes?.[ATTR_ROOM_DEVICE] === "1");
    if (device) return device.identity;
    return claimers.map((p) => p.identity).sort()[0] || null;
  }, [cluster, members]);

  const isLeader = !!cluster && leaderId === myId;
  const isFollower = !!cluster && leaderId !== myId;

  // The room a non-member would join. Prefer the locked device's cluster (the
  // canonical physical room) over an ad-hoc human one. Covers the common case
  // of one physical room per call; multiple distinct in-room groups would need
  // a picker, which we can add later.
  const existingCluster = useMemo(() => {
    if (cluster) return null;
    const others = participants.filter((p) => !p.isLocal && p.attributes?.[ATTR_CLUSTER]);
    if (others.length === 0) return null;
    const deviceHost = others.find((p) => p.attributes?.[ATTR_ROOM_DEVICE] === "1");
    const host = deviceHost || others[0];
    const id = host.attributes[ATTR_CLUSTER];
    const claimers = participants.filter(
      (p) => p.attributes?.[ATTR_CLUSTER] === id && p.attributes?.[ATTR_LEADER] === p.identity,
    );
    const leaderP = claimers.find((p) => p.attributes?.[ATTR_ROOM_DEVICE] === "1") || claimers[0] || host;
    const leaderName = (leaderP?.name || leaderP?.identity || "").replace(/\s*·\s*Portal$/i, "");
    return { id, leaderId: leaderP?.identity || id, leaderName, isDevice: !!deviceHost };
  }, [participants, cluster]);

  const setAttrs = useCallback(
    (delta) => (localParticipant ? localParticipant.setAttributes(delta).catch(() => {}) : Promise.resolve()),
    [localParticipant],
  );

  // Become this room's speaker (claim leadership: mic + audio for everyone here).
  const startRoom = useCallback(() => {
    if (!myId) return;
    setAttrs({ [ATTR_CLUSTER]: myId, [ATTR_LEADER]: myId }).then(bump);
  }, [myId, setAttrs]);

  // Join an existing room as a muted follower (no leadership claim).
  const joinRoom = useCallback(
    (target) => {
      if (!target?.id) return;
      setAttrs({ [ATTR_CLUSTER]: target.id, [ATTR_LEADER]: "" }).then(bump);
    },
    [setAttrs],
  );

  // Drop back to solo (empty string deletes the attribute).
  const leaveRoom = useCallback(() => {
    setAttrs({ [ATTR_CLUSTER]: "", [ATTR_LEADER]: "" }).then(bump);
  }, [setAttrs]);

  // Handoff + yield — manager instance only.
  useEffect(() => {
    if (!manage || !cluster || !myId) return;
    const deviceMember = members.find((p) => p.attributes?.[ATTR_ROOM_DEVICE] === "1");
    const iClaim = myAttrs[ATTR_LEADER] === myId;
    if (deviceMember) {
      // A locked room device is the rightful, sticky leader. If I (a human)
      // self-claimed — e.g. I was promoted while it was briefly offline — yield.
      if (iClaim && deviceMember.identity !== myId) setAttrs({ [ATTR_LEADER]: "" }).then(bump);
      return;
    }
    // No device: if nobody leads, the lowest-identity survivor claims it.
    const someoneLeads = members.some((p) => p.attributes?.[ATTR_LEADER] === p.identity);
    if (someoneLeads) return;
    const heir = members.map((p) => p.identity).sort()[0];
    if (heir === myId) setAttrs({ [ATTR_LEADER]: myId }).then(bump);
  }, [manage, cluster, myId, members, myAttrs, setAttrs]);

  return { cluster, leaderId, isLeader, isFollower, members, existingCluster, startRoom, joinRoom, leaveRoom };
}
