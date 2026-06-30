import { useCallback, useEffect, useMemo, useReducer } from "react";
import { useLocalParticipant, useParticipants, useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";

// In-room audio clustering — "companion mode" for people who share a physical
// room. When several participants are together in person, the room has ONE
// mic + ONE set of speakers; everyone else stays muted and silent so the space
// doesn't echo. Remote participants still hear the room and see every tile.
//
// Two roles per cluster, deliberately split so a person can upgrade the room's
// mic without stealing its speakers:
//   • MIC SOURCE — whose mic represents the room to remotes.
//   • AUDIO SINK — whose speakers play the call aloud for the room.
// Default: the locked room DEVICE is both. A person can "take over" the mic
// (a closer/better mic) — they become the mic source while the device stays the
// audio sink (keeps its good speakers, mutes its own mic). No device → the one
// speaker is both. Everyone else: mic off, audio off/unsubscribed.
//
// State lives entirely in LiveKit participant attributes (no DB, ephemeral):
//   cluster         — group id (the founding member / device identity)
//   clusterLeaderId — SELF-CLAIM for the mic role (set to own identity to claim)
//   speakerOverride — "1" when a human DELIBERATELY took the mic from the device
//                     (so an auto-promotion during a device blip doesn't, and
//                     the device reclaims as default when it returns)
//   roomDevice      — "1" on the locked device (the sticky default + audio sink)
//
// Mic-source priority: an explicit human override > the room device > any other
// self-claimer (an ad-hoc room's founder, or a lowest-id auto-promotion).
//
// Pass { manage: true } in exactly ONE mounted instance. That instance keeps
// claims tidy: it auto-promotes the lowest-id survivor when no one holds the
// mic, and drops a stale self-claim when it's been out-ranked (so the device
// can reclaim and badges stay correct).

export const ATTR_CLUSTER = "cluster";
export const ATTR_LEADER = "clusterLeaderId";
export const ATTR_OVERRIDE = "speakerOverride";
export const ATTR_ROOM_DEVICE = "roomDevice";
export const ATTR_SINK = "clusterSink"; // self-claim for the speakers (audio sink) role

// Who carries the room's mic, from a cluster's members. Pure.
// Priority: a deliberate manual take-over (sticky) > the most-recent voice-
// activity (auto) take-over > the room device default > any other plain claimer
// (a device-less room's founder, or a lowest-id auto-promotion).
// `speakerOverride` distinguishes them: "manual" | "<timestamp ms>" (auto) | "".
export function pickMicSource(members) {
  const claims = members.filter((p) => p.attributes?.[ATTR_LEADER] === p.identity);
  const humans = claims.filter((p) => p.attributes?.[ATTR_ROOM_DEVICE] !== "1");

  const manual = humans
    .filter((p) => p.attributes?.[ATTR_OVERRIDE] === "manual")
    .map((p) => p.identity)
    .sort();
  if (manual.length) return manual[0];

  const auto = humans
    .map((p) => ({ id: p.identity, ts: Number(p.attributes?.[ATTR_OVERRIDE]) }))
    .filter((x) => Number.isFinite(x.ts) && x.ts > 0)
    .sort((a, b) => b.ts - a.ts || (a.id < b.id ? -1 : 1));
  if (auto.length) return auto[0].id;

  const device = claims
    .filter((p) => p.attributes?.[ATTR_ROOM_DEVICE] === "1")
    .map((p) => p.identity)
    .sort();
  if (device.length) return device[0];

  return humans
    .filter((p) => !p.attributes?.[ATTR_OVERRIDE])
    .map((p) => p.identity)
    .sort()[0] || null;
}

// The sink (speakers): a person who took over the room's speakers wins, else the
// room device, else the mic source. Lets a laptop be the room's speakers while
// the device (or someone else) stays the mic. Pure.
export function pickAudioSink(members, micSourceId) {
  const claimed = members
    .filter((p) => p.attributes?.[ATTR_SINK] === p.identity && p.attributes?.[ATTR_ROOM_DEVICE] !== "1")
    .map((p) => p.identity)
    .sort();
  if (claimed.length) return claimed[0];
  const device = members.find((p) => p.attributes?.[ATTR_ROOM_DEVICE] === "1");
  if (device) return device.identity;
  return micSourceId;
}

// identity -> { inRoom, isMicSource, isAudioSink, isDevice } for ALL clusters in
// the call. Used to badge every tile regardless of which cluster it's in. Pure.
export function clusterRolesOf(participants) {
  const byCluster = new Map();
  for (const p of participants) {
    const c = p.attributes?.[ATTR_CLUSTER];
    if (!c) continue;
    if (!byCluster.has(c)) byCluster.set(c, []);
    byCluster.get(c).push(p);
  }
  const roles = new Map();
  for (const [, members] of byCluster) {
    const micId = pickMicSource(members);
    const sinkId = pickAudioSink(members, micId);
    for (const p of members) {
      roles.set(p.identity, {
        inRoom: true,
        isMicSource: p.identity === micId,
        isAudioSink: p.identity === sinkId,
        isDevice: p.attributes?.[ATTR_ROOM_DEVICE] === "1",
      });
    }
  }
  return roles;
}

// Reactive version of clusterRolesOf for the current room.
export function useClusterRoles() {
  const room = useRoomContext();
  const participants = useParticipants();
  const [, bump] = useReducer((n) => (n + 1) % 1e9, 0);
  useEffect(() => {
    if (!room) return undefined;
    room.on(RoomEvent.ParticipantAttributesChanged, bump);
    return () => {
      room.off(RoomEvent.ParticipantAttributesChanged, bump);
    };
  }, [room]);
  return clusterRolesOf(participants);
}

export function useRoomCluster({ manage = false } = {}) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const [, bump] = useReducer((n) => (n + 1) % 1e9, 0);

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

  const micSourceId = useMemo(() => (cluster ? pickMicSource(members) : null), [cluster, members]);
  const audioSinkId = useMemo(() => (cluster ? pickAudioSink(members, micSourceId) : null), [cluster, members, micSourceId]);
  const isMicSource = !!cluster && micSourceId === myId;
  const isAudioSink = !!cluster && audioSinkId === myId;
  // A "follower" contributes neither: mic off, audio off.
  const isFollower = !!cluster && !isMicSource && !isAudioSink;

  // The room a non-member would join. Prefer the locked device's cluster.
  const existingCluster = useMemo(() => {
    if (cluster) return null;
    const others = participants.filter((p) => !p.isLocal && p.attributes?.[ATTR_CLUSTER]);
    if (others.length === 0) return null;
    const deviceHost = others.find((p) => p.attributes?.[ATTR_ROOM_DEVICE] === "1");
    const host = deviceHost || others[0];
    const id = host.attributes[ATTR_CLUSTER];
    const peers = participants.filter((p) => p.attributes?.[ATTR_CLUSTER] === id);
    const micId = pickMicSource(peers);
    const leaderP = participants.find((p) => p.identity === micId) || host;
    const leaderName = (leaderP?.name || leaderP?.identity || "").replace(/\s*·\s*Portal$/i, "");
    return { id, leaderId: micId || id, leaderName, isDevice: !!deviceHost };
  }, [participants, cluster]);

  // If we FOUNDED a cluster via the entry fallback (cluster === myId) but a real
  // room cluster shows up belatedly — the device beacon landed late, or another
  // co-located joiner started their own within our 900ms blind window — there's a
  // canonical cluster to merge into: the device's, else the lowest-id founder
  // below us (so exactly one founder survives and the rest join it; the id<cluster
  // guard keeps two racers from cross-joining each other). Null when we're not a
  // self-founder, or no better target exists. existingCluster can't serve here:
  // it's null once cluster is set, so a late discovery after founding is invisible.
  const mergeTarget = useMemo(() => {
    if (!cluster || cluster !== myId) return null;
    if (members.length !== 1) return null;
    const others = participants.filter((p) => !p.isLocal && p.attributes?.[ATTR_CLUSTER]);
    if (!others.length) return null;
    const deviceHost = others.find((p) => p.attributes?.[ATTR_ROOM_DEVICE] === "1");
    if (deviceHost) {
      const id = deviceHost.attributes[ATTR_CLUSTER];
      return id && id !== cluster ? id : null;
    }
    const ids = others
      .map((p) => p.attributes?.[ATTR_CLUSTER])
      .filter((id) => id && id !== cluster && id < cluster);
    return ids.length ? ids.sort()[0] : null;
  }, [participants, cluster, myId, members]);

  const setAttrs = useCallback(
    // setAttributes is a signal request — a no-op (and a "cannot send signal
    // request before connected" warning) until the room is connected.
    (delta) =>
      localParticipant && room?.state === "connected"
        ? localParticipant.setAttributes(delta).catch(() => {})
        : Promise.resolve(),
    [localParticipant, room],
  );

  // Found a room (device-less): become its mic + speakers.
  const startRoom = useCallback(() => {
    if (!myId) return;
    setAttrs({ [ATTR_CLUSTER]: myId, [ATTR_LEADER]: myId, [ATTR_OVERRIDE]: "", [ATTR_SINK]: "" }).then(bump);
  }, [myId, setAttrs]);

  // Join an existing room as a muted, silent follower.
  const joinRoom = useCallback(
    (target) => {
      if (!target?.id) return;
      setAttrs({ [ATTR_CLUSTER]: target.id, [ATTR_LEADER]: "", [ATTR_OVERRIDE]: "", [ATTR_SINK]: "" }).then(bump);
    },
    [setAttrs],
  );

  // Deliberately take over the room mic (sticky override of the device default).
  const takeSpeaker = useCallback(() => {
    if (!myId || !cluster) return;
    setAttrs({ [ATTR_LEADER]: myId, [ATTR_OVERRIDE]: "manual" }).then(bump);
  }, [myId, cluster, setAttrs]);

  // Auto mic-switching: claim the mic for the duration of a speaking turn
  // (timestamped so the most-recent speaker wins), and release on silence. We
  // never clobber a deliberate manual take-over.
  const claimAuto = useCallback(() => {
    if (!myId || !cluster) return;
    if (localParticipant?.attributes?.[ATTR_OVERRIDE] === "manual") return;
    setAttrs({ [ATTR_LEADER]: myId, [ATTR_OVERRIDE]: String(Date.now()) }).then(bump);
  }, [myId, cluster, localParticipant, setAttrs]);

  const releaseAuto = useCallback(() => {
    if (localParticipant?.attributes?.[ATTR_OVERRIDE] === "manual") return;
    setAttrs({ [ATTR_LEADER]: "", [ATTR_OVERRIDE]: "" }).then(bump);
  }, [localParticipant, setAttrs]);

  // Give the mic back (to the device / next claimer) but stay in the room.
  const stepDown = useCallback(() => {
    setAttrs({ [ATTR_LEADER]: "", [ATTR_OVERRIDE]: "" }).then(bump);
  }, [setAttrs]);

  // Take over the room's speakers — use my device's audio output for the room
  // (e.g. better speakers) while the device/someone else keeps the mic.
  const takeSink = useCallback(() => {
    if (!myId || !cluster) return;
    setAttrs({ [ATTR_SINK]: myId }).then(bump);
  }, [myId, cluster, setAttrs]);

  // Hand the speakers back to the room device / default.
  const releaseSink = useCallback(() => {
    setAttrs({ [ATTR_SINK]: "" }).then(bump);
  }, [setAttrs]);

  // Leave the room entirely (back to solo).
  const leaveRoom = useCallback(() => {
    setAttrs({ [ATTR_CLUSTER]: "", [ATTR_LEADER]: "", [ATTR_OVERRIDE]: "", [ATTR_SINK]: "" }).then(bump);
  }, [setAttrs]);

  // Tidy claims — manager instance only.
  useEffect(() => {
    if (!manage || !cluster || !myId) return;
    const iClaim = myAttrs[ATTR_LEADER] === myId;
    const myOverride = myAttrs[ATTR_OVERRIDE];
    // Drop only a stale PLAIN claim (an auto-promotion) once out-ranked — e.g. a
    // returning device — so it reclaims and badges stay correct. Manual and auto
    // (voice) take-overs are owned by their holder; clearing them here would
    // stomp an active speaker.
    if (iClaim && !myOverride && micSourceId !== myId) {
      setAttrs({ [ATTR_LEADER]: "" }).then(bump);
      return;
    }
    // Nobody holds the mic → the lowest-id survivor claims it (no override, so a
    // returning device still wins).
    if (micSourceId) return;
    const heir = members.map((p) => p.identity).sort()[0];
    if (heir === myId) setAttrs({ [ATTR_LEADER]: myId }).then(bump);
  }, [manage, cluster, myId, myAttrs, micSourceId, members, setAttrs]);

  return {
    cluster,
    micSourceId,
    audioSinkId,
    isMicSource,
    isAudioSink,
    isFollower,
    members,
    existingCluster,
    mergeTarget,
    startRoom,
    joinRoom,
    takeSpeaker,
    stepDown,
    takeSink,
    releaseSink,
    leaveRoom,
    claimAuto,
    releaseAuto,
  };
}
