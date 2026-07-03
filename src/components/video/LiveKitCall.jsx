import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  ParticipantTile,
  TrackToggle,
  DisconnectButton,
  LayoutContextProvider,
  usePinnedTracks,
  useLayoutContext,
  useSpeakingParticipants,
  useMediaDeviceSelect,
  useTracks,
  useParticipants,
  useLocalParticipant,
  useRoomContext,
  useMaybeTrackRefContext,
  useIsSpeaking,
  useConnectionQualityIndicator,
} from "@livekit/components-react";
import { Track, RoomEvent, ConnectionQuality, setLogLevel } from "livekit-client";
import "@livekit/components-styles";
import { Eye, Video, Smile, PhoneOff, LayoutGrid, Presentation, Focus, Waves, ChevronDown, Check, Plus, Users, UsersRound, Mic, MicOff, UserX, X, Volume2, Speaker, Sparkles, Pin, PinOff, Radio, FlipHorizontal2, PictureInPicture2, Minimize2, Maximize2, Hand, Headphones, HeadphoneOff, Expand, Shrink, MoreHorizontal } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { useTeam } from "../../context/TeamContext";
import { useVideoCall } from "../../context/VideoCallContext";
import EmoteBar from "../emotes/EmoteBar";
import { LIVEKIT_URL, fetchLiveKitToken, liveKitRoomName } from "../../lib/livekit";
import { kickFromCall, muteParticipantTrack, setRoomPin, clearRoomPin } from "../../lib/livekitModerate";
import { useRoomCluster, useClusterRoles, ATTR_ROOM_DEVICE } from "./useRoomCluster";
import { PREF, loadPref, savePref } from "./callPrefs";
import { LK_ROOM_OPTIONS, LK_CONNECT_OPTIONS, connectDelayFor, markConnectAttempt, connectCooldownMs, noteConnectFailure } from "./livekitConnect";
import { diagReset, diagRecord, diagReport, diagEnv } from "./livekitDiagnostics";
import { useFullscreen } from "./useFullscreen";
import { useGlobalPin } from "./useGlobalPin";
import { playHandRaise } from "../../lib/uiSounds";
import { pickBestMicrophone } from "./bestMic";
import { createVoiceDetector } from "./autoMic";
import AdaptiveStage from "./AdaptiveStage";
import { useFeaturedSpeaker } from "./useFeaturedSpeaker";
import { useSquishedLayout } from "./useSquishedLayout";

// LiveKit's client logs at "info" by default, which floods the console with
// per-connection play-by-play (signal connecting, connection state changes,
// track publish/unpublish, "already connected to room") — and doubles it under
// React StrictMode in dev, which mounts/unmounts effects twice. It also warns
// on the benign connect→leave→connect churn StrictMode causes ("could not
// createOffer with closed peer connection"). Drop it to "error" so only real
// failures surface. Module-level so it runs once, before any room connects.
setLogLevel("error");

// LiveKit's DisconnectReason is a numeric enum on the wire; map it to a legible
// name. A silent "bounced back to the green room with no console error" is almost
// always a CLEAN server-side disconnect (no JS exception, so nothing logs) — most
// often DUPLICATE_IDENTITY (the same account connected from another tab/device,
// which kicks the older session). We log + report the reason so it stops being
// invisible. (Values mirror livekit-client's DisconnectReason.)
const LK_DISCONNECT_REASON = {
  0: "unknown",
  1: "client_initiated",       // normal leave (we called disconnect)
  2: "duplicate_identity",     // same identity connected elsewhere → this one kicked
  3: "server_shutdown",
  4: "participant_removed",    // moderation kick
  5: "room_deleted",
  6: "state_mismatch",
  7: "join_failure",           // couldn't establish the session (often publisher ICE)
  8: "migration",
  9: "signal_close",
  10: "room_closed",
  11: "user_unavailable",
  12: "user_rejected",
  13: "sip_trunk_failure",
};

// LiveKit provider — the A/B counterpart to <JitsiCall>.
//
// We compose LiveKit's primitives (Grid/Focus/Carousel layouts +
// ParticipantTile + RoomAudioRenderer + a custom ControlBar) rather than the
// all-in-one <VideoConference> so the call matches the app and adapts to
// context:
//   • compact (PiP) → just the stage, no control bar (the app frames PiP).
//   • publish=false (spectate) → connect subscribe-only: you see/hear
//     everyone without publishing your own camera/mic.
//
// We always connect subscribe-only and then enable camera/mic via the
// local-participant API (PublishController) so spectate ↔ join can flip
// live without reconnecting.

// Per-device preferences for the local self-view processors + layout. Kept in
// localStorage so they persist across calls and apply even in PiP (which has
// no control bar to toggle them).
// Shared with the pre-join lobby so a setting chosen there carries into the call.
// (PREF/loadPref/savePref now live in callPrefs.js.)

function refKey(t) {
  return t ? `${t.participant?.identity || ""}:${t.source}` : "";
}

// Krisp bundles several MB of WASM; load it on demand — only when a call enables
// noise cancellation — so it never weighs down the eager app bundle. (The camera
// background pipeline lazy-loads its own MediaPipe deps in refinedBackground.js.)
// stopProcessor() is a track method, so DISABLING needs no package.
let _krispModPromise;
const loadKrispMod = () => (_krispModPromise ||= import("@livekit/krisp-noise-filter"));

// Built-in virtual backgrounds — rendered as gradients on a canvas so we ship
// no binary image assets. The same gradient backs the menu thumbnail (via CSS)
// and the processor (via this canvas data URL), so they match exactly.
const BG_PRESETS = [
  { id: "ocean", label: "Ocean", colors: ["#0ea5e9", "#0f766e"] },
  { id: "sunset", label: "Sunset", colors: ["#fb923c", "#db2777"] },
  { id: "violet", label: "Violet", colors: ["#7c3aed", "#2563eb"] },
  { id: "forest", label: "Forest", colors: ["#16a34a", "#0f766e"] },
  { id: "slate", label: "Slate", colors: ["#475569", "#0f172a"] },
];
const _bgUrlCache = {};
function bgPresetUrl(id) {
  if (_bgUrlCache[id]) return _bgUrlCache[id];
  const preset = BG_PRESETS.find((p) => p.id === id);
  if (!preset) return null;
  try {
    const w = 1280, h = 720;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, preset.colors[0]);
    g.addColorStop(1, preset.colors[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    _bgUrlCache[id] = c.toDataURL("image/jpeg", 0.85);
    return _bgUrlCache[id];
  } catch {
    return null;
  }
}

// Downscale an uploaded image to a sane size + JPEG so the data URL stays small
// enough for localStorage and light for the segmenter to composite each frame.
function fileToScaledDataUrl(file, maxW = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.85));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// Map a bg descriptor ("blur:<r>" | "image:<id|custom>") to the refined
// processor's options. Returns null for an unresolved image (e.g. no custom yet).
function bgToOptions(bg, customBg) {
  if (bg.startsWith("blur:")) return { mode: "blur", blurRadius: parseInt(bg.slice(5), 10) || 10 };
  if (bg.startsWith("image:")) {
    const key = bg.slice(6);
    const url = key === "custom" ? customBg : bgPresetUrl(key);
    return url ? { mode: "image", imageUrl: url } : null;
  }
  return null;
}

// Per-device self-view prefs shared from the control bar down to the tiles:
//   mirror — flip your own camera horizontally (your view only)
//   float  — render your own tile as a draggable PiP instead of a grid cell
const SelfViewContext = createContext({ mirror: true, float: true, setMirror: () => {}, setFloat: () => {} });

const RoomEntryHoldContext = createContext({
  entryHoldPending: false,
  beginEntryHold: () => {},
});

function RoomEntryHoldProvider({ children }) {
  const { cluster } = useRoomCluster();
  const [entryHoldPending, setEntryHoldPending] = useState(false);

  useEffect(() => {
    if (cluster) setEntryHoldPending(false);
  }, [cluster]);

  useEffect(() => {
    if (!entryHoldPending) return undefined;
    // Do not leave the call muted forever if the signal request never lands.
    const t = setTimeout(() => setEntryHoldPending(false), 5000);
    return () => clearTimeout(t);
  }, [entryHoldPending]);

  const value = useMemo(
    () => ({
      entryHoldPending,
      beginEntryHold: () => setEntryHoldPending(true),
    }),
    [entryHoldPending],
  );

  return <RoomEntryHoldContext.Provider value={value}>{children}</RoomEntryHoldContext.Provider>;
}

function useRoomEntryHold() {
  return useContext(RoomEntryHoldContext);
}

// "Pin for everyone" control, shared from the call down to each tile + the
// People panel so the affordance shows wherever it's useful. `canPin` is gated
// by the room's pin_policy; the server re-checks, so this only decides the UI.
const PinControlContext = createContext({ canPin: false, pinnedId: null, pin: () => {}, unpin: () => {}, busyId: null });

function usePinControlValue(roomId) {
  const { isAdmin, isOwner, rooms } = useTeam();
  const { syncSession } = useSyncSession();
  const { localParticipant } = useLocalParticipant();
  const globalPinId = useGlobalPin();
  const myId = localParticipant?.identity;
  const policy = (rooms || []).find((r) => r.id === roomId)?.pin_policy || "admins";
  const isOrgAdmin = !!isAdmin || !!isOwner;
  const isLeader = !!syncSession?.leader_id && syncSession.leader_id === myId;
  const canPin =
    policy === "everyone" ||
    (policy === "admins" && isOrgAdmin) ||
    (policy === "leaders" && isLeader) ||
    (policy === "both" && (isOrgAdmin || isLeader));
  const [busyId, setBusyId] = useState(null);
  const pin = async (id) => {
    setBusyId(id);
    const { error } = await setRoomPin(roomId, id);
    setBusyId(null);
    if (error) console.warn("pin:", error.message);
  };
  const unpin = async () => {
    setBusyId(globalPinId || "_");
    const { error } = await clearRoomPin(roomId);
    setBusyId(null);
    if (error) console.warn("unpin:", error.message);
  };
  return useMemo(
    () => ({ canPin, policy, pinnedId: globalPinId, pin, unpin, busyId }),
    // pin/unpin are stable enough for our use; re-memo on the values that matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canPin, policy, globalPinId, busyId],
  );
}

// Raise-hand — a self-set participant attribute (`hand` = the raise timestamp,
// "" = lowered). Attributes (not data messages) so it persists for late joiners
// and needs no server round-trip, mirroring how `role`/cluster state is carried.
// Ordered by raise time so a host sees who's been waiting longest. Shared from
// ConferenceLayout (above both the Stage and the control bar) via context.
const ATTR_HAND = "hand";

const HandRaiseContext = createContext({
  raisedIds: new Set(),
  order: new Map(),
  myRaised: false,
  toggle: () => {},
  count: 0,
});

function useHandRaiseValue() {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  // useParticipants doesn't re-render on a pure attribute change, so nudge it.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!room) return undefined;
    const bump = () => setTick((n) => n + 1);
    room.on(RoomEvent.ParticipantAttributesChanged, bump);
    return () => room.off(RoomEvent.ParticipantAttributesChanged, bump);
  }, [room]);

  // Auto-lower your own hand once you start talking — you've got the floor, so a
  // still-raised hand is stale and would keep you in the queue (Meet/Zoom do the
  // same). Reads the authoritative isSpeaking + attribute at event time.
  useEffect(() => {
    if (!room) return undefined;
    const onActive = () => {
      if (localParticipant?.isSpeaking && localParticipant.attributes?.[ATTR_HAND]) {
        localParticipant.setAttributes({ [ATTR_HAND]: "" }).catch(() => {});
        setTick((n) => n + 1);
      }
    };
    room.on(RoomEvent.ActiveSpeakersChanged, onActive);
    return () => room.off(RoomEvent.ActiveSpeakersChanged, onActive);
  }, [room, localParticipant]);

  const raised = useMemo(
    () =>
      participants
        .map((p) => ({ identity: p.identity, ts: Number(p.attributes?.[ATTR_HAND]) || 0 }))
        .filter((x) => x.ts > 0)
        .sort((a, b) => a.ts - b.ts),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [participants, tick],
  );

  const myId = localParticipant?.identity;
  const myRaised = !!myId && raised.some((r) => r.identity === myId);

  // Play a cue when SOMEONE ELSE raises their hand (not you, and not for hands
  // already up when you joined). Tracks the previous set of raised remote ids
  // and fires once when a new one appears.
  const handCueJoinedAtRef = useRef(Date.now());
  const prevRaisedRef = useRef(null);
  useEffect(() => {
    if (!myId) return;
    const remoteRaised = raised.filter((r) => r.identity && r.identity !== myId);
    const remote = new Set(remoteRaised.map((r) => r.identity));
    const prev = prevRaisedRef.current;
    for (const r of remoteRaised) {
      if ((!prev || !prev.has(r.identity)) && r.ts > handCueJoinedAtRef.current) { playHandRaise(); break; }
    }
    prevRaisedRef.current = remote;
  }, [raised, myId]);

  const toggle = useCallback(() => {
    if (!localParticipant || room?.state !== "connected") return;
    const raisedNow = !!localParticipant.attributes?.[ATTR_HAND];
    localParticipant.setAttributes({ [ATTR_HAND]: raisedNow ? "" : String(Date.now()) }).catch(() => {});
    if (!raisedNow) playHandRaise(); // confirmation cue when YOU raise (Zoom-style)
    setTick((n) => n + 1); // optimistic — don't wait for the echo
  }, [localParticipant, room]);

  return useMemo(() => {
    const raisedIds = new Set(raised.map((r) => r.identity));
    const order = new Map(raised.map((r, i) => [r.identity, i + 1]));
    return { raisedIds, order, myRaised, toggle, count: raised.length };
  }, [raised, myRaised, toggle]);
}

function PublishController({ publish, choices, micMuted }) {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const { cluster, isMicSource, existingCluster, mergeTarget, startRoom, joinRoom } = useRoomCluster();
  const { entryHoldPending } = useRoomEntryHold();
  const bestMicAppliedRef = useRef(false);
  const enteredRef = useRef(false);
  const inRoom = !!choices?.inRoom;
  // Sticky "we've actually been in a cluster this call". `inRoom` is a STATIC
  // pre-join intent that stays true after you leave the room's audio (leaveRoom
  // clears the cluster attribute, not choices) — so on its own it wrongly keeps
  // the mic + call audio held off forever. Once clustered, leaving must restore
  // both; this ref is what distinguishes "still entering" from "entered & left".
  const clusteredRef = useRef(false);
  if (cluster) clusteredRef.current = true;

  // "I'm in this room" pre-join: on entry, join the room's audio cluster as a
  // muted follower (or found it if you're first) BEFORE the mic comes up, so
  // people sitting together don't get the squeal. The mic + call audio are held
  // off (below / in the audio renderers) until the cluster attribute lands.
  useEffect(() => {
    if (!publish || !inRoom) return undefined;
    if (cluster) { enteredRef.current = true; return undefined; }
    if (!localParticipant || enteredRef.current) return undefined;
    if (existingCluster) {
      enteredRef.current = true;
      joinRoom(existingCluster);
      return undefined;
    }
    // No cluster visible yet — wait a beat for other participants' attributes to
    // arrive before founding one (so two people arriving together don't each
    // start a separate cluster). The mic is held off meanwhile, so no squeal.
    const t = setTimeout(() => { enteredRef.current = true; startRoom(); }, 900);
    return () => clearTimeout(t);
  }, [publish, inRoom, cluster, localParticipant, existingCluster, joinRoom, startRoom]);

  // Merge-back: the 900ms fallback can found a spurious cluster when the device
  // beacon (or a co-located peer) appears just after the blind window closes. Once
  // a canonical cluster shows up, abandon the self-founded one and JOIN it as a
  // muted follower — otherwise we'd stay a separate mic source and publish audio
  // into a space the room device is already mic'ing, so it squeals. id<cluster
  // ordering on the target means exactly one founder survives the collapse.
  useEffect(() => {
    if (!publish || !inRoom || !mergeTarget) return;
    joinRoom({ id: mergeTarget });
  }, [publish, inRoom, mergeTarget, joinRoom]);

  // Role attribute — separate from camera/mic so mic or cluster churn never
  // re-touches either track.
  useEffect(() => {
    if (!localParticipant || !room) return undefined;
    const applyRole = () => {
      // Tag our role so every client can render spectators as a name list
      // instead of giving them a (camera-off) tile in the grid.
      localParticipant.setAttributes({ role: publish ? "publisher" : "spectator" }).catch(() => { /* */ });
    };
    room.on(RoomEvent.Connected, applyRole);
    if (room.state === "connected") applyRole();
    return () => room.off(RoomEvent.Connected, applyRole);
  }, [localParticipant, room, publish]);

  // Camera — join choices + connect/reconnect only. In-call camera toggles
  // (TrackToggle) are NOT reset when micMuted or cluster state changes.
  // Re-running setCameraEnabled off stale join-time `choices.videoEnabled`
  // was force-killing a camera turned on mid-call.
  useEffect(() => {
    if (!localParticipant || !room) return undefined;
    const applyCamera = () => {
      const wantVideo = publish && (choices ? choices.videoEnabled !== false : true);
      localParticipant
        .setCameraEnabled(wantVideo, choices?.videoDeviceId ? { deviceId: choices.videoDeviceId } : undefined)
        .catch(() => { /* device denied/unavailable — stay subscribe-only */ });
    };
    room.on(RoomEvent.Connected, applyCamera);
    if (room.state === "connected") applyCamera();
    return () => room.off(RoomEvent.Connected, applyCamera);
  }, [localParticipant, room, publish, choices?.videoEnabled, choices?.videoDeviceId]);

  // Mic gating — re-applied on connect AND whenever the room-audio cluster state
  // changes (the "behind the scenes" auto-mute). Touches ONLY the mic.
  useEffect(() => {
    if (!localParticipant || !room) return undefined;
    const applyMic = () => {
      // Your mic is live only when YOU haven't muted it AND (solo, or you're the
      // room's mic source). While ENTERING "in this room" but not yet clustered,
      // hold the mic off so it can't squeal before the follower/mic-source role
      // resolves — but NOT after you've been in a cluster and left (clusteredRef),
      // where "in this room" lingers. Manual re-entry sets entryHoldPending for
      // the same pre-cluster safety window.
      const holdForEntry = entryHoldPending || (inRoom && !clusteredRef.current);
      const wantAudio = publish && !micMuted && (cluster ? isMicSource : !holdForEntry);
      localParticipant
        .setMicrophoneEnabled(wantAudio, choices?.audioDeviceId ? { deviceId: choices.audioDeviceId } : undefined)
        .catch(() => { /* */ });
    };
    room.on(RoomEvent.Connected, apply);
    if (room.state === "connected") apply();
    return () => room.off(RoomEvent.Connected, apply);
  }, [localParticipant, room, publish, choices, cluster, isMicSource, micMuted, inRoom, entryHoldPending]);

  // When this device becomes the room's mic source, move to the best available
  // mic (a dedicated/USB mic over the built-in). Skip if the user explicitly
  // picked a mic; run once per activation.
  useEffect(() => {
    if (!isMicSource) {
      bestMicAppliedRef.current = false;
      return undefined;
    }
    if (!publish || !room || choices?.audioDeviceId || bestMicAppliedRef.current) return undefined;
    bestMicAppliedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        // Label-only scoring (measure:false) — this runs DURING a live call, and
        // level-probing opens getUserMedia on every candidate mic (plus a
        // transient AudioContext), which can hiccup the call's own capture. The
        // label heuristic still upgrades a built-in to a dedicated/USB mic, which
        // is the main win for a room-leader device.
        const best = await pickBestMicrophone({ measure: false });
        if (!cancelled && best?.deviceId) await room.switchActiveDevice("audioinput", best.deviceId);
      } catch {
        /* keep the current mic */
      }
    })();
    return () => { cancelled = true; };
  }, [isMicSource, publish, room, choices?.audioDeviceId]);

  return null;
}

// Manages the in-room cluster: leader handoff when the room speaker drops.
// Mounted exactly once (it owns the `manage` side-effects); renders nothing.
function RoomClusterManager() {
  useRoomCluster({ manage: true });
  return null;
}

// Re-applies the saved audio-output device (chosen in a prior call or the lobby)
// once connected, so your speaker choice persists across calls. switchActiveDevice
// fails soft if the device is gone (unplugged headphones → default).
function SavedSpeakerApplier() {
  const room = useRoomContext();
  useEffect(() => {
    if (!room) return undefined;
    const apply = () => {
      const saved = loadPref(PREF.speaker, "");
      if (saved) room.switchActiveDevice("audiooutput", saved).catch(() => { /* device gone */ });
    };
    if (room.state === "connected") apply();
    room.on(RoomEvent.Connected, apply);
    return () => { room.off(RoomEvent.Connected, apply); };
  }, [room]);
  return null;
}

// Records the connection-health events that precede a force disconnect into a
// per-room ring buffer (livekitDiagnostics), so a silent "bounced to the green
// room" can be explained instead of just guessed at. On its own this is quiet —
// it only console.warns the genuinely alarming events (reconnecting, a local
// quality collapse, a media-device failure); the full timeline is dumped by the
// disconnect handler. Listens on the live Room via context so it sees the same
// engine the call is using. Mount once inside <LiveKitRoom>.
function ConnectionDiagnostics({ roomId }) {
  const room = useRoomContext();
  useEffect(() => {
    if (!room) return undefined;
    const roomName = liveKitRoomName(roomId);
    // Start (or restart) the buffer for the current session. If we mounted
    // already-connected (e.g. a remount over a live room), seed it now.
    if (room.state === "connected") diagReset(roomName);

    const onConnected = () => diagReset(roomName);
    const onReconnecting = () => {
      const env = diagEnv();
      diagRecord(roomName, "reconnecting", env);
      // A reconnect is the single best early warning of an impending drop — make
      // it visible with the network context that usually explains it.
      console.warn(`[livekit-diag] reconnecting (room ${roomId})`, env);
    };
    const onReconnected = () => {
      diagRecord(roomName, "reconnected");
      console.info(`[livekit-diag] reconnected (room ${roomId})`);
    };
    const onSignalConnected = () => diagRecord(roomName, "signal_connected");
    const onStateChanged = (state) => diagRecord(roomName, "state", { state: String(state) });
    const onQuality = (quality, participant) => {
      // Only the LOCAL participant's quality matters for whether WE get dropped;
      // remote-quality churn would just be noise.
      if (!participant?.isLocal) return;
      const q = String(quality);
      diagRecord(roomName, "quality", { quality: q });
      if (q === "poor" || q === "lost") {
        console.warn(`[livekit-diag] local connection quality: ${q} (room ${roomId})`);
      }
    };
    const onMediaError = (e) => {
      diagRecord(roomName, "media_error", { message: e?.message || String(e) });
      console.warn(`[livekit-diag] media device error (room ${roomId}):`, e?.message || e);
    };

    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.SignalConnected, onSignalConnected);
    room.on(RoomEvent.ConnectionStateChanged, onStateChanged);
    room.on(RoomEvent.ConnectionQualityChanged, onQuality);
    room.on(RoomEvent.MediaDevicesError, onMediaError);
    return () => {
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.SignalConnected, onSignalConnected);
      room.off(RoomEvent.ConnectionStateChanged, onStateChanged);
      room.off(RoomEvent.ConnectionQualityChanged, onQuality);
      room.off(RoomEvent.MediaDevicesError, onMediaError);
    };
  }, [room, roomId]);
  return null;
}

// Proximity-style auto mic-switching (experimental, opt-in). Only active in a
// room that HAS a device — the device stays the stable audio sink (speakers)
// while the mic moves between people. Each in-room person runs local voice
// detection: speak → auto-claim the room mic (their close mic beats the device's
// far one); go quiet → release so the device reclaims. The detector keys on
// close/loud own-voice over an adaptive floor, so it's cleanest on a headset and
// best-effort on speakers (an in-room mic also hears the room speaker, which no
// per-device echo-cancel can remove). Thresholds will want real-world tuning.
function AutoMicController({ enabled }) {
  const cl = useRoomCluster();
  const hasDevice = cl.members.some((p) => p.attributes?.[ATTR_ROOM_DEVICE] === "1");
  const active = enabled && !!cl.cluster && hasDevice;
  // Keep the latest claim/release in a ref so the detector isn't torn down and
  // the mic re-opened on every render.
  const apiRef = useRef(cl);
  apiRef.current = cl;
  const heldRef = useRef(false);
  useEffect(() => {
    if (!active) return undefined;
    const stop = createVoiceDetector({
      onChange: (speaking) => {
        if (speaking) {
          apiRef.current.claimAuto();
          heldRef.current = true;
        } else if (heldRef.current) {
          apiRef.current.releaseAuto();
          heldRef.current = false;
        }
      },
    });
    return () => {
      stop?.();
      if (heldRef.current) {
        apiRef.current.releaseAuto();
        heldRef.current = false;
      }
    };
  }, [active]);
  return null;
}

// Audio playback. In a room only the AUDIO SINK (the device's speakers, or the
// lone speaker in a device-less room) plays the call aloud — anyone else in the
// room would double up and echo. Solo participants render normally.
function ClusterAudioRenderer({ holdForEntry = false }) {
  const { cluster, isAudioSink } = useRoomCluster();
  const { entryHoldPending } = useRoomEntryHold();
  // holdForEntry: while joining "in this room" but before the cluster attribute
  // has landed, stay silent so our speakers can't feed a co-located mic. Only
  // hold WHILE still entering — once we've been in a cluster, leaving it must
  // restore the call audio. Manual re-entry re-arms the hold until clustering lands.
  const enteredRef = useRef(false);
  if (cluster) enteredRef.current = true;
  const hold = entryHoldPending || (holdForEntry && !enteredRef.current);
  if ((cluster && !isAudioSink) || (hold && !cluster)) return null;
  return <RoomAudioRenderer />;
}

// Stops audio from even being *sent* to in-room participants who aren't the
// sink. They hear the call through the room speaker in person, so they need no
// audio on their own device. Unsubscribing (vs just not playing) means the SFU
// stops delivering those streams here at all — matching "in-room people only
// need external audio, via the room speaker". This also covers a person who
// took over the mic: they publish, but the device still plays for the room, so
// they don't subscribe either. Re-subscribes the moment they become the sink.
function FollowerAudioGate({ holdForEntry = false }) {
  const { cluster, isAudioSink } = useRoomCluster();
  const { entryHoldPending } = useRoomEntryHold();
  // Release the entry hold once we've actually clustered (see ClusterAudioRenderer)
  // so leaving the room re-subscribes us; manual re-entry re-arms it.
  const enteredRef = useRef(false);
  if (cluster) enteredRef.current = true;
  const hold = entryHoldPending || (holdForEntry && !enteredRef.current);
  const suppress = (!!cluster && !isAudioSink) || (hold && !cluster);
  const audioTracks = useTracks(
    [Track.Source.Microphone, Track.Source.ScreenShareAudio],
    { onlySubscribed: false },
  );
  useEffect(() => {
    audioTracks.forEach((tr) => {
      const pub = tr.publication;
      if (!pub || tr.participant?.isLocal || typeof pub.setSubscribed !== "function") return;
      pub.setSubscribed(!suppress);
    });
  }, [suppress, audioTracks]);
  return null;
}

// Applies the self-view processors to the LOCAL tracks: our refined background
// pipeline on the camera (refinedBackground.js — MediaPipe + WebGL edge refine)
// and Krisp noise cancellation on the mic (@livekit/krisp-noise-filter, a
// LiveKit Cloud feature). Re-runs when settings change or the underlying track
// republishes (mute/unmute, device swap).
function EffectsController({ bg, customBg, noiseEnabled }) {
  const { cameraTrack, microphoneTrack } = useLocalParticipant();
  const procRef = useRef(null);
  const appliedToRef = useRef(null);

  useEffect(() => {
    const t = cameraTrack?.track;
    if (!t || t.kind !== "video") return undefined;
    let active = true;
    (async () => {
      try {
        if (!bg || bg === "none") {
          if (appliedToRef.current === t) await t.stopProcessor();
          procRef.current = null;
          appliedToRef.current = null;
          return;
        }
        const opts = bgToOptions(bg, customBg);
        if (!opts) return;
        const { createRefinedBackgroundProcessor } = await import("./refinedBackground");
        if (!active) return;
        // Update the running processor in place when only params changed; build
        // a fresh one (which spins up MediaPipe + WebGL) only on first apply or
        // when the camera track itself changed.
        if (procRef.current && appliedToRef.current === t) {
          procRef.current.updateOptions(opts);
        } else {
          const proc = createRefinedBackgroundProcessor(opts);
          procRef.current = proc;
          appliedToRef.current = t;
          await t.setProcessor(proc);
        }
      } catch {
        /* unsupported / failed — leave the raw camera so the call still works */
      }
    })();
    return () => { active = false; };
  }, [bg, customBg, cameraTrack]);

  useEffect(() => {
    const t = microphoneTrack?.track;
    if (!t || t.kind !== "audio") return undefined;
    let active = true;
    (async () => {
      try {
        if (noiseEnabled) {
          const { KrispNoiseFilter, isKrispNoiseFilterSupported } = await loadKrispMod();
          if (active && isKrispNoiseFilterSupported()) await t.setProcessor(KrispNoiseFilter());
        } else {
          await t.stopProcessor();
        }
      } catch {
        /* unsupported (e.g. not LiveKit Cloud) — leave the raw track */
      }
    })();
    return () => { active = false; };
  }, [noiseEnabled, microphoneTrack]);

  return null;
}

// Speaker (audio output) picker, shown inside the mic menu so all audio
// settings live together. Switching calls room.switchActiveDevice("audiooutput")
// under the hood (setSinkId on the call's <audio> elements). Renders nothing
// where output selection isn't supported (Safari/iOS expose no audiooutput
// devices), so the menu just omits it there instead of showing an empty list.
function OutputDeviceSection() {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind: "audiooutput" });
  if (!devices || devices.length === 0) return null;
  return (
    <div>
      <div className="call-menu-label flex items-center gap-1.5"><Volume2 className="w-3.5 h-3.5 opacity-70" /> Speaker</div>
      <div className="max-h-32 overflow-auto">
        {devices.map((d) => {
          const selected = d.deviceId === activeDeviceId;
          return (
            <button
              key={d.deviceId}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              onClick={() => { setActiveMediaDevice(d.deviceId); savePref(PREF.speaker, d.deviceId); }}
              className={`call-menu-item ${selected ? "call-menu-item--active" : ""}`}
            >
              <span className="flex-1 truncate">{d.label || "Unnamed device"}</span>
              {selected && <Check className="w-4 h-4 shrink-0 text-[var(--color-accent)]" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// A settings row inside a device menu — a labelled on/off toggle (e.g. blur,
// noise cancellation) that lives alongside the device list.
function SettingRow({ icon: Icon, label, active, onClick }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={active}
      onClick={onClick}
      className="call-menu-item"
    >
      <Icon className="w-4 h-4 opacity-70 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      <span className={`text-[10px] font-bold uppercase tracking-wide ${active ? "text-[var(--color-accent)]" : "opacity-50"}`}>
        {active ? "On" : "Off"}
      </span>
    </button>
  );
}

// Background picker for the camera menu: off, three blur strengths, and
// virtual-background images (built-in gradients + a custom upload). Lives
// inside the camera device menu so all video settings sit together.
function BackgroundEffects({ value, onChange, customBg, onUpload }) {
  const chip = (val, label) => (
    <button
      type="button"
      onClick={() => onChange(val)}
      aria-pressed={value === val}
      className={`px-2 py-1 rounded-md text-[11px] font-medium text-left transition-colors ${
        value === val ? "bg-white/15 text-white" : "opacity-80 hover:bg-white/10"
      }`}
    >
      {label}
    </button>
  );
  const thumbCls = (sel) =>
    `aspect-square rounded overflow-hidden ring-1 transition ${
      sel ? "ring-2 ring-white" : "ring-white/15 hover:ring-white/40"
    }`;
  return (
    <div className="px-1 py-1">
      <div className="px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wider opacity-60">Background</div>
      <div className="grid grid-cols-2 gap-1 px-1">
        {chip("none", "None")}
        {chip("blur:4", "Blur · Light")}
        {chip("blur:9", "Blur · Medium")}
        {chip("blur:18", "Blur · Strong")}
      </div>
      <div className="mt-1.5 px-1 grid grid-cols-5 gap-1">
        {BG_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.label}
            aria-label={`Background: ${p.label}`}
            onClick={() => onChange(`image:${p.id}`)}
            className={thumbCls(value === `image:${p.id}`)}
            style={{ backgroundImage: `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]})` }}
          />
        ))}
        {customBg && (
          <button
            type="button"
            title="Custom background"
            onClick={() => onChange("image:custom")}
            className={thumbCls(value === "image:custom")}
          >
            <img src={customBg} alt="" className="w-full h-full object-cover" />
          </button>
        )}
        <label
          title="Upload an image"
          className="aspect-square rounded ring-1 ring-white/15 flex items-center justify-center cursor-pointer hover:bg-white/10"
        >
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
          />
          <Plus className="w-3.5 h-3.5 opacity-70" />
        </label>
      </div>
    </div>
  );
}

// Per-track settings dropdown: the device picker (mic / camera) PLUS that
// track's processing settings below it. Replaces LiveKit's <MediaDeviceMenu>
// so all audio settings (mic + noise cancellation) live under the mic, and all
// video settings (camera + background blur/image) under the camera.
function DeviceSettingsMenu({ kind, label, children }) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind });
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative -ml-1.5">
      <button
        type="button"
        className="lk-caret-btn"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label} settings`}
        title={`${label} settings`}
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="call-menu absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 w-64 max-h-[70vh] overflow-y-auto">
          <div className="call-menu-label">{label}</div>
          <div className="max-h-44 overflow-auto">
            {devices.length === 0 ? (
              <div className="px-2.5 py-2 text-[13px] opacity-55">No devices found</div>
            ) : (
              devices.map((d) => {
                const selected = d.deviceId === activeDeviceId;
                return (
                  <button
                    key={d.deviceId}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => { setActiveMediaDevice(d.deviceId); setOpen(false); }}
                    className={`call-menu-item ${selected ? "call-menu-item--active" : ""}`}
                  >
                    <span className="flex-1 truncate">{d.label || "Unnamed device"}</span>
                    {selected && <Check className="w-4 h-4 shrink-0 text-[var(--color-accent)]" />}
                  </button>
                );
              })
            )}
          </div>
          {children && (
            <>
              <div className="call-menu-sep" />
              {children}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// In-room ("companion mode") control. When several people share one physical
// room, one device becomes the room speaker (mic + audio) and the others join
// muted so the room doesn't echo. Not in a room → one click joins an existing
// one (if a neighbour started it) or starts a new one. In a room → a small
// popover shows who's together and a Leave action.
function RoomClusterButton({ autoMic, onToggleAutoMic }) {
  const {
    cluster, members, isMicSource, isAudioSink, existingCluster,
    startRoom, joinRoom, takeSpeaker, stepDown, takeSink, releaseSink, leaveRoom,
  } = useRoomCluster();
  const { beginEntryHold } = useRoomEntryHold();
  const roles = useClusterRoles();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!cluster) {
    const joining = !!existingCluster;
    const enterRoom = () => {
      beginEntryHold();
      if (joining) joinRoom(existingCluster);
      else startRoom();
    };
    return (
      <button
        type="button"
        className="lk-button"
        title={
          joining
            ? `In the room with ${existingCluster.leaderName || "others"}? Join their shared audio (mutes your mic + call audio so you don't echo)`
            : "In a room with teammates? Make this the room speaker so you don't echo each other"
        }
        aria-label={joining ? "Join the room's shared audio" : "Make this the room speaker"}
        onClick={enterRoom}
      >
        {/* Speaker (not a people icon) so this "share the room's audio" control
            isn't confused with the People / participants button. */}
        <Speaker className="w-5 h-5" />
      </button>
    );
  }

  const deviceInRoom = members.some((p) => roles.get(p.identity)?.isDevice);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="lk-button"
        aria-pressed="true"
        aria-expanded={open}
        title={isMicSource ? "You're the room mic" : "You're in a shared room (muted)"}
        onClick={() => setOpen((v) => !v)}
      >
        <Speaker className="w-5 h-5" style={{ color: "var(--lk-accent-bg, #22d3ee)" }} />
      </button>
      {open && (
        <div className="call-menu absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 w-64">
          <div className="call-menu-label">
            {isMicSource ? "You're the room mic" : "In this room · muted"}
          </div>
          <ul className="max-h-40 overflow-auto mb-1 px-1">
            {members.map((p) => {
              const r = roles.get(p.identity) || {};
              const tag = r.isDevice
                ? "device"
                : r.isMicSource && r.isAudioSink
                  ? "mic + speaker"
                  : r.isMicSource
                    ? "mic"
                    : r.isAudioSink
                      ? "speaker"
                      : null;
              return (
                <li key={p.identity} className="flex items-center gap-1.5 px-1.5 py-1 text-[12.5px]">
                  <span className="flex-1 min-w-0 truncate">
                    {p.name || p.identity}
                    {p.isLocal && <span className="opacity-50"> (you)</span>}
                  </span>
                  {tag ? (
                    <span className="inline-flex items-center gap-1 text-amber-300 text-[11px] font-medium shrink-0">
                      <Volume2 className="w-3 h-3" />
                      {tag}
                    </span>
                  ) : (
                    <MicOff className="w-3.5 h-3.5 opacity-40 shrink-0" title="Muted" />
                  )}
                </li>
              );
            })}
          </ul>
          <div className="call-menu-sep" />
          {isMicSource ? (
            <button type="button" onClick={() => { stepDown(); setOpen(false); }} className="call-menu-item">
              <MicOff className="w-4 h-4 opacity-70 shrink-0" />
              {deviceInRoom ? "Give mic back to room device" : "Step down as room mic"}
            </button>
          ) : (
            <button type="button" onClick={() => { takeSpeaker(); setOpen(false); }} className="call-menu-item">
              <Mic className="w-4 h-4 opacity-70 shrink-0" />
              Take over the room mic
            </button>
          )}
          {deviceInRoom && (
            isAudioSink ? (
              <button type="button" onClick={() => { releaseSink(); setOpen(false); }} className="call-menu-item">
                <Volume2 className="w-4 h-4 opacity-70 shrink-0" />
                Give room speakers back to device
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { takeSink(); setOpen(false); }}
                className="call-menu-item"
                title="Play the call through this computer's speakers instead of the device's."
              >
                <Volume2 className="w-4 h-4 opacity-70 shrink-0" />
                Use my speakers for the room
              </button>
            )
          )}
          <button type="button" onClick={() => { leaveRoom(); setOpen(false); }} className="call-menu-item text-rose-300">
            <X className="w-4 h-4 opacity-70 shrink-0" />
            Leave room
          </button>
          {deviceInRoom && (
            <>
              <div className="call-menu-sep" />
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={!!autoMic}
                onClick={() => onToggleAutoMic?.()}
                className="call-menu-item"
                title="Experimental: automatically hand the room mic to whoever's speaking (their closer mic)."
              >
                <Sparkles className="w-4 h-4 opacity-70 shrink-0" />
                <span className="flex-1">Auto-switch mic to the speaker</span>
                <span className={`text-[10px] font-bold uppercase tracking-wide ${autoMic ? "text-[var(--color-accent)]" : "opacity-50"}`}>
                  {autoMic ? "On" : "Off"}
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Personal mic mute. The icon reflects only what YOU did — not the in-room
// auto-mute, which happens behind the scenes. When you're in a room and your
// audio is being carried by the room mic, the icon still shows your own state
// and the tooltip (plus the "In room" tile badge) explains why you may not be
// transmitting. So: MicOff = you muted yourself; Mic + "In room" badge = the
// room is carrying you.
function MicButton({ micMuted, deafened, onToggleMic }) {
  const { cluster, isMicSource } = useRoomCluster();
  const carriedByRoom = !!cluster && !isMicSource;
  const title = deafened
    ? "Undeafen before unmuting"
    : micMuted
      ? "Unmute"
      : carriedByRoom
        ? "You're in the room — the room mic carries your audio"
        : "Mute";
  return (
    <button
      type="button"
      className="lk-button"
      aria-pressed={micMuted}
      aria-label={deafened ? "Microphone muted while deafened" : micMuted ? "Unmute microphone" : "Mute microphone"}
      title={title}
      onClick={() => onToggleMic?.()}
      disabled={deafened}
    >
      {micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
    </button>
  );
}

// Layout-mode picker (grid / presenter / spotlight). A small popover keyed off
// the current mode's icon, replacing the old grid↔speaker toggle.
function LayoutMenu({ mode, onSet, ignoreSelf, onToggleIgnoreSelf }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const items = [
    { id: "grid", label: "Grid", Icon: LayoutGrid },
    { id: "presenter", label: "Presenter", Icon: Presentation },
    { id: "spotlight", label: "Spotlight", Icon: Focus },
  ];
  const Cur = (items.find((i) => i.id === mode) || items[0]).Icon;
  // Tiny diagram of each layout so the picker shows what it does, not just a word.
  const Diagram = ({ id }) => {
    const box = "w-[60px] h-[38px] rounded-md p-1 flex gap-1";
    if (id === "grid") {
      return (
        <div className={`${box} grid grid-cols-2 grid-rows-2`}>
          {[0, 1, 2, 3].map((i) => <span key={i} className="lc-cell w-full h-full" />)}
        </div>
      );
    }
    if (id === "presenter") {
      return (
        <div className={box}>
          <span className="lc-cell flex-1 h-full" />
          <span className="flex flex-col gap-1 w-[14px]">
            <span className="lc-cell w-full flex-1" />
            <span className="lc-cell w-full flex-1" />
          </span>
        </div>
      );
    }
    return (
      <div className={box}>
        <span className="lc-cell w-full h-full" />
      </div>
    );
  };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="lk-button"
        data-tour="call-layout"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Layout"
      >
        <Cur className="w-5 h-5" />
      </button>
      {open && (
        <div className="call-menu absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 w-[252px]">
          <div className="call-menu-label">Layout</div>
          <div className="grid grid-cols-3 gap-1.5 p-1">
            {items.map((it) => {
              const sel = mode === it.id;
              return (
                <button
                  key={it.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={sel}
                  onClick={() => { onSet(it.id); setOpen(false); }}
                  className={`call-layout-card ${sel ? "call-layout-card--active" : ""}`}
                >
                  <Diagram id={it.id} />
                  <span className="lc-label">{it.label}</span>
                </button>
              );
            })}
          </div>
          <div className="my-1 border-t border-white/10" />
          <SettingRow
            icon={UserX}
            label="Don't spotlight me"
            active={!!ignoreSelf}
            onClick={onToggleIgnoreSelf}
          />
        </div>
      )}
    </div>
  );
}

// Custom control bar (replaces LiveKit's <ControlBar>) so reactions + the
// layout toggle sit where we want and it collapses to icon-only when the tile
// is narrow — keeping a small video usable rather than forcing a large minimum
// size. Per-track processing (blur, noise cancellation) lives in each device
// menu, not as separate buttons.
//
// The reactions popup (Google-Meet style) is centered on the bar FRAME, not
// on the off-center smiley button — so it stays put regardless of how many
// controls flank it.
// Overflow "More" menu — houses the less-frequent utility actions (pop-out,
// deafen, fullscreen) so the control bar stays uncluttered. A tap on any item
// runs it and closes the menu.
function MoreMenu({ children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="lk-button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More options"
        title="More"
      >
        <MoreHorizontal className="w-5 h-5" />
      </button>
      {open && (
        <div className="call-menu absolute bottom-full mb-2 right-0 z-20 w-[220px]" onClick={() => setOpen(false)}>
          <div className="call-menu-label">More</div>
          {children}
        </div>
      )}
    </div>
  );
}

function CallControlBar({
  publish, tight, emote,
  layoutMode, onSetLayout,
  ignoreSelf, onToggleIgnoreSelf,
  bg, onChangeBg, customBg, onUploadBg,
  noiseEnabled, onToggleNoise,
  autoMic, onToggleAutoMic,
  ptt, onTogglePtt,
  mirror, onToggleMirror,
  selfFloat, onToggleSelfFloat,
  micMuted, onToggleMic,
  deafened, onToggleDeafen,
  peopleOpen, onTogglePeople,
  fullscreenSupported, isFullscreen, onToggleFullscreen,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { poppedOut, popOut, popIn, canPopOut } = useVideoCall();
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const { myRaised, toggle: toggleHand, count: handCount } = useContext(HandRaiseContext);
  // Mirror the overlay's charge + recents so the shared <EmoteBar> shows the
  // same glow and custom emojis here without re-rendering the whole call.
  const [charge, setCharge] = useState(null);
  const [recents, setRecents] = useState([]);
  useEffect(() => emote?.subscribeCharge?.(setCharge), [emote]);
  useEffect(() => emote?.subscribeRecents?.(setRecents), [emote]);

  return (
    <div
      className="lk-call-bar relative flex items-center justify-center flex-wrap gap-1.5 px-2.5 py-2 rounded-2xl backdrop-blur-md shadow-xl ring-1 ring-white/10"
      style={{ "--lk-border-radius": "9999px" }}
    >
      {reactionsOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setReactionsOpen(false)} />
          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20">
            <EmoteBar
              orientation="row"
              btn={36}
              recents={recents}
              charge={charge}
              onEmit={emote?.start}
              onPick={emote?.pick}
              dark={dark}
            />
          </div>
        </>
      )}

      {publish && (
        <>
          <MicButton micMuted={micMuted} deafened={deafened} onToggleMic={onToggleMic} />
          {!tight && (
            <DeviceSettingsMenu kind="audioinput" label="Microphone">
              <OutputDeviceSection />
              <div className="my-1 border-t border-white/10" />
              <SettingRow icon={Waves} label="Noise cancellation" active={noiseEnabled} onClick={onToggleNoise} />
              <SettingRow icon={Radio} label="Push to talk (hold Space)" active={ptt} onClick={onTogglePtt} />
            </DeviceSettingsMenu>
          )}
          <TrackToggle source={Track.Source.Camera} />
          {!tight && (
            <DeviceSettingsMenu kind="videoinput" label="Camera">
              <BackgroundEffects value={bg} onChange={onChangeBg} customBg={customBg} onUpload={onUploadBg} />
              <div className="my-1 border-t border-white/10" />
              <SettingRow icon={FlipHorizontal2} label="Mirror my video" active={mirror} onClick={onToggleMirror} />
              <SettingRow icon={PictureInPicture2} label="Float my video" active={selfFloat} onClick={onToggleSelfFloat} />
            </DeviceSettingsMenu>
          )}
          <TrackToggle source={Track.Source.ScreenShare} />
          {/* In-room companion mode: become the room speaker / join muted. */}
          <RoomClusterButton autoMic={autoMic} onToggleAutoMic={onToggleAutoMic} />
        </>
      )}

      {/* Raise hand — available whether or not you publish (a spectator can ask
          to speak). Amber while yours is up. */}
      <button
        type="button"
        className={`lk-button ${myRaised ? "lk-button--raised" : ""}`}
        onClick={toggleHand}
        aria-pressed={myRaised}
        title={myRaised ? "Lower hand" : "Raise hand"}
      >
        <Hand className={`w-5 h-5 ${myRaised ? "call-hand-wave" : ""}`} />
      </button>

      {/* Layout picker (viewing — available whether or not you publish). */}
      <LayoutMenu mode={layoutMode} onSet={onSetLayout} ignoreSelf={ignoreSelf} onToggleIgnoreSelf={onToggleIgnoreSelf} />

      {/* People / moderation roster. A badge surfaces raised hands when closed. */}
      <span className="relative inline-flex">
        <button
          type="button"
          className="lk-button"
          onClick={onTogglePeople}
          aria-pressed={peopleOpen}
          title={handCount > 0 ? `People · ${handCount} hand${handCount > 1 ? "s" : ""} up` : "People in this call"}
        >
          <Users className="w-5 h-5" />
        </button>
        {handCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold leading-none ring-2 ring-[rgba(22,24,29,0.82)] pointer-events-none">
            {handCount}
          </span>
        )}
      </span>

      <button
        type="button"
        className="lk-button"
        onClick={() => setReactionsOpen((v) => !v)}
        aria-label="Reactions"
        aria-expanded={reactionsOpen}
        title="Reactions"
      >
        <Smile className="w-5 h-5" />
      </button>

      {/* Overflow: the less-frequent utilities live here so the bar stays tidy —
          pop-out (Document PiP, where supported), deafen, and true fullscreen. */}
      <MoreMenu>
        {canPopOut && (
          <SettingRow
            icon={PictureInPicture2}
            label={poppedOut ? "Return from pop-out" : "Pop out to a window"}
            active={poppedOut}
            onClick={poppedOut ? popIn : popOut}
          />
        )}
        <SettingRow
          icon={deafened ? HeadphoneOff : Headphones}
          label={deafened ? "Undeafen" : "Deafen (mute all audio)"}
          active={deafened}
          onClick={onToggleDeafen}
        />
        {fullscreenSupported && (
          <SettingRow
            icon={isFullscreen ? Minimize2 : Maximize2}
            label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            active={isFullscreen}
            onClick={onToggleFullscreen}
          />
        )}
      </MoreMenu>

      <DisconnectButton>{tight ? <PhoneOff className="w-4 h-4" /> : "Leave"}</DisconnectButton>
    </div>
  );
}

// A small toggleable "N watching" pill → expandable name list, shown over
// the stage so spectators take a line of text, not a whole tile.
function SpectatorList({ spectators }) {
  const [open, setOpen] = useState(false);
  if (!spectators.length) return null;
  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 text-white flex flex-col items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="People watching without their camera on"
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-900/70 backdrop-blur-sm text-[11px] font-semibold hover:bg-slate-900/90"
      >
        <Eye className="w-3.5 h-3.5 opacity-80" />
        {spectators.length} watching
      </button>
      {open && (
        <div className="mt-1 w-44 max-h-40 overflow-auto rounded-lg bg-slate-900/90 backdrop-blur-sm p-1.5 text-[12px]">
          {spectators.map((p) => (
            <div key={p.identity} className="truncate px-1.5 py-0.5">{p.name || p.identity}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// Host moderation roster: lists everyone in the call. The session leader gets
// mute / remove actions per participant (the action is enforced server-side by
// the livekit-moderate edge function; this UI gate is just for affordance).
// The room-level "global pin" (parseGlobalPin / useGlobalPin) now lives in
// ./useGlobalPin so the kiosk can honour the same admin pin — imported above.

function PeoplePanel({ roomId, onClose }) {
  const participants = useParticipants();
  const speaking = useSpeakingParticipants();
  const { localParticipant } = useLocalParticipant();
  const { syncSession } = useSyncSession();
  const { teamMembers } = useTeam();
  const myId = localParticipant?.identity;
  const leaderId = syncSession?.leader_id || null;
  const isHost = !!leaderId && leaderId === myId;
  // Pinning for everyone is gated by the room's pin policy (server re-checks).
  const { canPin } = useContext(PinControlContext);
  const { raisedIds, order: handOrder } = useContext(HandRaiseContext);
  const globalPinId = useGlobalPin();
  const [busy, setBusy] = useState(null);
  const [confirmKick, setConfirmKick] = useState(null);

  // Org members get a real profile (photo + name); everyone else is a guest
  // shown with an initials avatar.
  const memberMap = useMemo(() => {
    const m = new Map();
    for (const tm of teamMembers || []) m.set(tm.user_id, tm);
    return m;
  }, [teamMembers]);
  const speakingIds = useMemo(() => new Set(speaking.map((p) => p.identity)), [speaking]);

  const doKick = async (id) => {
    setBusy(id);
    const { error } = await kickFromCall(roomId, id);
    setBusy(null);
    setConfirmKick(null);
    if (error) console.warn("kick:", error.message);
  };
  const doMute = async (p) => {
    const micPub = p.getTrackPublication?.(Track.Source.Microphone);
    if (!micPub?.trackSid) return;
    setBusy(p.identity);
    const { error } = await muteParticipantTrack(roomId, p.identity, micPub.trackSid);
    setBusy(null);
    if (error) console.warn("mute:", error.message);
  };
  const doPin = async (id) => {
    setBusy(id);
    const { error } = await setRoomPin(roomId, id);
    setBusy(null);
    if (error) console.warn("pin:", error.message);
  };
  const doUnpin = async (id) => {
    setBusy(id);
    const { error } = await clearRoomPin(roomId);
    setBusy(null);
    if (error) console.warn("unpin:", error.message);
  };

  const orgPeople = [];
  const guests = [];
  for (const p of participants) (memberMap.has(p.identity) ? orgPeople : guests).push(p);

  const Row = (p, i) => {
    const member = memberMap.get(p.identity);
    const isSelf = p.identity === myId;
    const isLeader = p.identity === leaderId;
    const isSpectator = p.attributes?.role === "spectator";
    const isPinned = p.identity === globalPinId;
    const isSpk = speakingIds.has(p.identity);
    const micPub = p.getTrackPublication?.(Track.Source.Microphone);
    const micOn = !!micPub && !micPub.isMuted;
    const name = p.name || member?.name || "Guest";
    const handUp = raisedIds.has(p.identity);
    const handPos = handUp ? handOrder.get(p.identity) : null;
    const canModerate = canPin || (isHost && !isSelf);
    const status = isSpectator ? "Watching" : isSpk ? "Speaking" : micOn ? "Mic on" : "Muted";
    return (
      <div
        key={p.identity}
        className="call-person-row group flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 hover:bg-white/[0.06] transition-colors"
        style={{ animationDelay: `${Math.min(i, 8) * 28}ms` }}
      >
        <CallAvatar name={name} src={member?.avatar_url} id={p.identity} size={34} speaking={isSpk} dimmed={isSpectator} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 min-w-0">
            <span className="truncate font-medium text-slate-100">{name}</span>
            {isSelf && <span className="shrink-0 text-[10px] px-1 py-px rounded bg-white/10 text-slate-300">you</span>}
            {isLeader && <span className="shrink-0 text-amber-300" title="Session leader">★</span>}
            {isPinned && <Pin className="w-3 h-3 text-amber-300 shrink-0" />}
            {handUp && (
              <span className="shrink-0 inline-flex items-center text-amber-300" title={handPos ? `Hand raised (#${handPos} in line)` : "Hand raised"}>
                <Hand className="w-3 h-3 call-hand-wave" />
                {handPos && handPos > 1 ? <span className="text-[9px] font-bold ml-px">{handPos}</span> : null}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 text-[10.5px] leading-tight">
            <span className={isSpk ? "text-emerald-300" : "text-slate-400"}>{status}</span>
          </div>
        </div>
        {!isSpectator && (
          <span className="shrink-0" title={micOn ? "Mic on" : "Muted"}>
            {micOn ? <Mic className="w-3.5 h-3.5 text-slate-300" /> : <MicOff className="w-3.5 h-3.5 text-slate-500" />}
          </span>
        )}
        {canModerate && (
          <span className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {canPin && (
              isPinned ? (
                <button
                  type="button"
                  title="Unpin for everyone"
                  disabled={busy === p.identity}
                  onClick={() => doUnpin(p.identity)}
                  className="p-1 rounded-lg text-amber-300 hover:bg-white/15 active:scale-90 transition disabled:opacity-40"
                >
                  <PinOff className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  title="Pin for everyone"
                  disabled={busy === p.identity}
                  onClick={() => doPin(p.identity)}
                  className="p-1 rounded-lg text-slate-300 hover:bg-white/15 active:scale-90 transition disabled:opacity-40"
                >
                  <Pin className="w-3.5 h-3.5" />
                </button>
              )
            )}
            {isHost && !isSelf && micOn && (
              <button
                type="button"
                title="Mute mic"
                disabled={busy === p.identity}
                onClick={() => doMute(p)}
                className="p-1 rounded-lg text-slate-300 hover:bg-white/15 active:scale-90 transition disabled:opacity-40"
              >
                <MicOff className="w-3.5 h-3.5" />
              </button>
            )}
            {isHost && !isSelf && (
              confirmKick === p.identity ? (
                <button
                  type="button"
                  disabled={busy === p.identity}
                  onClick={() => doKick(p.identity)}
                  className="px-1.5 py-0.5 rounded-lg bg-rose-500/85 hover:bg-rose-500 text-[10px] font-semibold active:scale-95 transition disabled:opacity-40"
                >
                  Remove?
                </button>
              ) : (
                <button
                  type="button"
                  title="Remove from call"
                  onClick={() => setConfirmKick(p.identity)}
                  className="p-1 rounded-lg text-rose-300 hover:bg-rose-500/20 active:scale-90 transition"
                >
                  <UserX className="w-3.5 h-3.5" />
                </button>
              )
            )}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="call-sheet absolute top-2 bottom-2 right-2 z-20 w-72 max-w-[82%] flex flex-col text-[12.5px] text-slate-100">
      <div className="flex items-center justify-between px-3.5 pt-3 pb-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <UsersRound className="w-4 h-4 opacity-80 shrink-0" />
          <span className="font-semibold tracking-tight">People</span>
          <span className="text-[11px] px-1.5 py-px rounded-full bg-white/10 text-slate-300">{participants.length}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="p-1 rounded-lg hover:bg-white/10 active:scale-90 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-2.5">
        {orgPeople.length > 0 && (
          <div>
            <div className="call-menu-label px-1.5">In your org · {orgPeople.length}</div>
            <div className="mt-1 space-y-0.5">{orgPeople.map(Row)}</div>
          </div>
        )}
        {guests.length > 0 && (
          <div>
            <div className="call-menu-label px-1.5">Guests · {guests.length}</div>
            <div className="mt-1 space-y-0.5">{guests.map(Row)}</div>
          </div>
        )}
        {participants.length === 0 && (
          <p className="px-3 py-6 text-center text-slate-400">No one here yet.</p>
        )}
      </div>
      {!isHost && (
        <p className="px-3.5 py-2 border-t border-white/[0.07] text-[10.5px] text-slate-400">
          Only the session leader can mute or remove.
        </p>
      )}
    </div>
  );
}

// A soft, deterministic per-person gradient for the camera-off initials avatar.
function avatarGradient(id) {
  let h = 0;
  for (let i = 0; i < (id || "").length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `linear-gradient(135deg, hsl(${hue} 52% 48%), hsl(${(hue + 38) % 360} 55% 34%))`;
}

// First+last initial for an initials avatar / fallback.
function getInitials(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// A round person avatar: real photo when we have one, otherwise initials on the
// person's deterministic gradient. `speaking` adds the accent breathing ring.
function CallAvatar({ name, src, id, size = 34, speaking = false, dimmed = false }) {
  const [broken, setBroken] = useState(false);
  const showImg = src && !broken;
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden ${
        speaking ? "call-avatar--speaking" : "ring-1 ring-white/10"
      }`}
      style={{
        width: size,
        height: size,
        background: showImg ? "rgba(255,255,255,0.06)" : avatarGradient(id || name),
        opacity: dimmed ? 0.6 : 1,
        transition: "opacity 0.15s ease",
      }}
    >
      {showImg ? (
        <img src={src} alt="" className="w-full h-full object-cover" onError={() => setBroken(true)} />
      ) : (
        <span className="font-semibold text-white leading-none" style={{ fontSize: Math.round(size * 0.4) }}>
          {getInitials(name)}
        </span>
      )}
    </span>
  );
}

// A ParticipantTile with an in-room badge. When a participant is part of a
// physical-room cluster, their tile gets a small chip — amber "Room device" /
// "Room mic" for whoever carries the room's audio, muted "In room" for the
// rest — so the grouping is visible right in the grid. Looks the tile's role up
// in the shared cluster-roles map (so it reflects the EFFECTIVE leader, e.g.
// after a take-over). Wraps the default tile in a flex box and lets it fill, so
// the grid layout is unaffected.
function ClusterParticipantTile({ trackRef: trackRefProp }) {
  // Our layout engine passes the track ref explicitly; inside a LiveKit layout
  // it comes from context. Either way ParticipantTile gets it as a prop.
  const ctxTrackRef = useMaybeTrackRefContext();
  const trackRef = trackRefProp || ctxTrackRef;
  const participant = trackRef?.participant;
  const roles = useClusterRoles();
  const globalPinId = useGlobalPin();
  const { canPin, pin, unpin, busyId } = useContext(PinControlContext);
  const { raisedIds, order: handOrder } = useContext(HandRaiseContext);
  const handRaised = !!participant?.identity && raisedIds.has(participant.identity);
  const handPos = handRaised ? handOrder.get(participant.identity) : null;
  const role = participant ? roles.get(participant.identity) : null;
  const isPinned = !!participant?.identity && participant.identity === globalPinId;
  // A hover pin toggle so you can set everyone's focus straight from a tile —
  // no need to open the People list. Shown only when the room's pin policy lets
  // you (server re-checks). Hidden on placeholder tiles (no identity yet).
  const canPinHere = canPin && !!participant?.identity;
  const pinBusy = busyId === participant?.identity || (isPinned && busyId === "_");
  // Personal "expand" — a per-CLIENT pin (LiveKit's LayoutContext) that enlarges
  // this tile in YOUR view only, no server/moderation involved. The Stage reads
  // usePinnedTracks() as its top-priority focus. Available to everyone (not gated
  // like "pin for everyone"), and kept a distinct EXPAND icon so the two don't
  // read as the same control.
  const layoutContext = useLayoutContext();
  const pinnedTracks = usePinnedTracks();
  const isSelfPinned = !!trackRef && pinnedTracks.some((t) => refKey(t) === refKey(trackRef));
  const canExpand = !!trackRef && !!participant?.identity;
  const togglePersonalPin = () => {
    const dispatch = layoutContext?.pin?.dispatch;
    if (!dispatch) return;
    if (isSelfPinned) dispatch({ msg: "clear_pin" });
    else dispatch({ msg: "set_pin", trackReference: trackRef });
  };
  const inRoom = !!role?.inRoom;
  // Tile chrome: a speaking ring (glows while this person talks) and a
  // connection-quality dot (shown only when degraded, so it reads as a warning
  // not clutter). Hooks accept an optional participant → safe on placeholders.
  const isSpeaking = useIsSpeaking(participant);
  const { quality } = useConnectionQualityIndicator({ participant });
  const weak = quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost;
  // Mirror only YOUR OWN camera (the convention — your self-view reads like a
  // mirror), and only the camera, never a screen share. `[&_video]` flips the
  // <video> LiveKit renders inside ParticipantTile.
  const { mirror } = useContext(SelfViewContext);
  const flip = mirror && participant?.isLocal && trackRef?.source === Track.Source.Camera;
  // Camera off → cover LiveKit's generic gray silhouette with a clean initials
  // avatar (a soft per-person gradient), which reads far more modern.
  const camOff = trackRef?.source === Track.Source.Camera && (!trackRef?.publication || trackRef.publication.isMuted);
  const micOff = !!participant && participant.isMicrophoneEnabled === false;
  const dispName = participant?.name || participant?.identity || "Guest";
  const initial = (dispName.trim()[0] || "?").toUpperCase();
  // Amber for whoever carries the room's audio I/O — the device, the current mic
  // source, or the speakers — muted chip for the rest.
  const active = !!role && (role.isDevice || role.isMicSource || role.isAudioSink);
  const label = role?.isDevice
    ? "Room device"
    : role?.isMicSource && role?.isAudioSink
      ? "Room mic + speaker"
      : role?.isMicSource
        ? "Room mic"
        : role?.isAudioSink
          ? "Room speaker"
          : "In room";
  return (
    <div
      className={`group relative flex w-full h-full rounded-xl overflow-hidden ring-1 ring-white/[0.07] ${flip ? "[&_video]:scale-x-[-1]" : ""}`}
    >
      <ParticipantTile trackRef={trackRef} style={{ flex: 1, minWidth: 0, minHeight: 0 }} />

      {/* Hover controls (bottom-right) — on the bottom edge so they never collide
          with the room panel's window controls (maximize/close), which own the
          top-right. Two distinct affordances:
            • Expand (everyone) — a PERSONAL pin: enlarges this tile in your view
              only. White so it reads apart from the amber "everyone" pin.
            • Pin (admins/leaders) — pins the tile for EVERYONE (room-wide). */}
      {(canExpand || canPinHere) && (
        <div className="absolute bottom-1.5 right-1.5 z-30 flex items-center gap-1">
          {canPinHere && (
            <button
              type="button"
              onClick={() => (isPinned ? unpin() : pin(participant.identity))}
              disabled={pinBusy}
              title={isPinned ? "Unpin for everyone" : "Pin for everyone"}
              className={`inline-flex items-center justify-center w-7 h-7 rounded-full backdrop-blur-sm ring-1 ring-white/15 transition active:scale-90 disabled:opacity-40 ${
                isPinned
                  ? "bg-amber-500/85 text-white opacity-100"
                  : "bg-black/55 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-black/75"
              }`}
            >
              {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            </button>
          )}
          {canExpand && (
            <button
              type="button"
              onClick={togglePersonalPin}
              title={isSelfPinned ? "Shrink — stop expanding this just for you" : "Expand this for yourself (only your view)"}
              aria-pressed={isSelfPinned}
              className={`inline-flex items-center justify-center w-7 h-7 rounded-full backdrop-blur-sm ring-1 ring-white/15 transition active:scale-90 ${
                isSelfPinned
                  ? "bg-white/90 text-slate-900 opacity-100"
                  : "bg-black/55 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-black/75"
              }`}
            >
              {isSelfPinned ? <Shrink className="w-3.5 h-3.5" /> : <Expand className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      )}

      {/* Name + mute, glassy pill bottom-left (replaces LiveKit's metadata bar,
          which our avatar overlay would otherwise cover). */}
      <div className="absolute bottom-1.5 left-1.5 z-10 inline-flex items-center gap-1 max-w-[calc(100%-12px)] px-2 py-0.5 rounded-md bg-black/55 backdrop-blur-sm pointer-events-none">
        {micOff && <MicOff className="w-3 h-3 text-rose-300 shrink-0" />}
        <span className="text-[11px] font-medium text-white truncate">
          {dispName}{participant?.isLocal ? " (You)" : ""}
        </span>
        {/* Connection-quality dot — only when degraded (amber = poor, red =
            lost). Folded into the name pill so the bottom-right corner is free
            for the pin button. */}
        {weak && (
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${quality === ConnectionQuality.Lost ? "bg-red-500" : "bg-amber-400"}`}
            title={quality === ConnectionQuality.Lost ? "Connection lost" : "Weak connection"}
          />
        )}
      </div>

      {/* Camera-off: an initials avatar over LiveKit's default silhouette. */}
      {camOff && (
        <div
          className="absolute inset-0 z-[1] flex items-center justify-center"
          style={{ background: "radial-gradient(circle at 50% 36%, #1b2840, #0b1220)" }}
        >
          <div
            className="rounded-full flex items-center justify-center text-white font-semibold ring-1 ring-white/10 shadow-lg"
            style={{
              width: "clamp(44px, 26%, 116px)",
              aspectRatio: "1",
              fontSize: "clamp(16px, 4vw, 40px)",
              background: avatarGradient(participant?.identity || dispName),
            }}
          >
            {initial}
          </div>
        </div>
      )}

      {/* Speaking ring — an inset glow so it never shifts layout. Matches the
          tile's rounding; pulses softly while the person is talking. */}
      {isSpeaking && (
        <div
          className="absolute inset-0 z-20 pointer-events-none animate-pulse"
          style={{
            borderRadius: "var(--lk-border-radius, 0.75rem)",
            boxShadow: "inset 0 0 0 3px rgba(16,185,129,0.95), 0 0 14px -2px rgba(16,185,129,0.6)",
          }}
        />
      )}

      {(isPinned || inRoom || handRaised) && (
        <div className="absolute top-1.5 left-1.5 z-10 flex flex-col items-start gap-1 pointer-events-none">
          {handRaised && (
            <div
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold backdrop-blur-sm bg-amber-500/90 text-white"
              title={handPos ? `Hand raised (#${handPos} in line)` : "Hand raised"}
            >
              <Hand className="w-3 h-3 shrink-0 call-hand-wave" />
              {handPos && handPos > 1 ? handPos : "Hand"}
            </div>
          )}
          {isPinned && (
            <div
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold backdrop-blur-sm bg-amber-500/85 text-white"
              title="Pinned for everyone by an admin"
            >
              <Pin className="w-3 h-3 shrink-0" />
              Pinned
            </div>
          )}
          {inRoom && (
            <div
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold backdrop-blur-sm ${
                active ? "bg-amber-500/85 text-white" : "bg-slate-900/70 text-slate-100"
              }`}
              title={
                active
                  ? `${label} — carries this room's audio`
                  : "In the room · muted here (heard through the room speaker)"
              }
            >
              {active ? <Volume2 className="w-3 h-3 shrink-0" /> : <MicOff className="w-3 h-3 shrink-0" />}
              {label}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Largest uniform tile size (at `aspect`) that fits `n` tiles in W×H. Picks the
// column count that maximises tile area, so cells are never ultra-wide or
// skinny-tall — the aspect "clamp" that stops faces from being cropped.
function bestGrid(n, W, H, aspect, gap) {
  if (n <= 0 || W <= 0 || H <= 0) return { cols: 1, tileW: 0, tileH: 0 };
  let best = { cols: 1, tileW: 0, tileH: 0, area: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (W - gap * (cols - 1)) / cols;
    const ch = (H - gap * (rows - 1)) / rows;
    if (cw <= 0 || ch <= 0) continue;
    let tw = cw;
    let th = cw / aspect;
    if (th > ch) { th = ch; tw = ch * aspect; }
    const area = tw * th;
    if (area > best.area) best = { cols, tileW: tw, tileH: th, area };
  }
  return best;
}

function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const apply = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// Largest tile count that still fits at a comfortable minimum width — the cap
// before the grid spills into the audience row. Walks the same bestGrid the grid
// uses so the threshold matches what would actually render.
function capFor(w, h, minW = 130, aspect = 16 / 9, gap = 8) {
  if (w <= 0 || h <= 0) return 99;
  let best = 1;
  for (let n = 1; n <= 60; n++) {
    const { tileW } = bestGrid(n, w, h, aspect, gap);
    if (tileW >= minW) best = n; else break;
  }
  return best;
}

// Order tiles so the grid keeps who matters when it overflows: screen share and
// pins first, then featured / active speakers, then cameras-on, then cameras-off.
// Stable within a tier (original order) so tiles don't shuffle every render —
// only a new speaker or pin promotes into view.
function rankTiles(tracks, { featuredId, speaking, globalPinId, pinnedTrackKey } = {}) {
  const speakingIds = new Set((speaking || []).map((p) => p.identity));
  const score = (t) => {
    if (t.source === Track.Source.ScreenShare) return 0;
    const id = t.participant?.identity;
    if (globalPinId && id === globalPinId) return 1;
    if (pinnedTrackKey && refKey(t) === pinnedTrackKey) return 2;
    if (id && (id === featuredId || speakingIds.has(id))) return 3;
    const camOn = !!t.publication && !t.publication.isMuted;
    return camOn ? 4 : 5;
  };
  return tracks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => score(a.t) - score(b.t) || a.i - b.i)
    .map((x) => x.t);
}

// One overflow person — initials avatar with a speaking pulse. Speaking promotes
// them back into the grid (rankTiles), so the pulse here is the "they're talking,
// watch them pop up" cue.
function AudienceChip({ participant }) {
  const isSpeaking = useIsSpeaking(participant);
  const name = participant?.name || participant?.identity || "Guest";
  const initial = (name.trim()[0] || "?").toUpperCase();
  return (
    <div className="flex flex-col items-center gap-1 w-14 shrink-0" title={name}>
      <div className={`relative w-11 h-11 rounded-full flex items-center justify-center text-white font-semibold text-sm bg-slate-700 ${isSpeaking ? "ring-2 ring-emerald-400" : "ring-1 ring-white/15"}`}>
        {initial}
        {isSpeaking && <span className="absolute inset-0 rounded-full ring-2 ring-emerald-400 animate-ping pointer-events-none" />}
      </div>
      <span className="text-[10px] text-slate-300 truncate max-w-full">{name}</span>
    </div>
  );
}

// The audience row — overflow participants past the grid cap, as a scrollable
// strip of chips.
function AudienceRow({ tracks }) {
  return (
    <div className="shrink-0 h-[80px] flex items-center gap-2 px-3 overflow-x-auto bg-black/30 border-t border-white/10">
      <span className="text-[10px] font-bold uppercase tracking-wider text-white/50 shrink-0 mr-1">
        +{tracks.length}
      </span>
      {tracks.map((t) => <AudienceChip key={refKey(t)} participant={t.participant} />)}
    </div>
  );
}

// Your own camera as a floating, draggable, minimizable PiP (Meet's signature
// self-view) — pulled out of the grid so it doesn't eat a cell. Drag to
// reposition (clamped to the stage); hover for shrink + dock-to-grid controls.
// It renders a ClusterParticipantTile, so it picks up the mirror pref too.
function FloatingSelfView({ trackRef, onDock }) {
  const [pos, setPos] = useState({ right: 14, bottom: 14 });
  const [minimized, setMinimized] = useState(false);
  const dragRef = useRef(null);

  const onMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    const maxR = Math.max(8, (d.parent?.width || 9999) - d.w - 8);
    const maxB = Math.max(8, (d.parent?.height || 9999) - d.h - 8);
    setPos({
      right: Math.min(maxR, Math.max(8, d.right - dx)),
      bottom: Math.min(maxB, Math.max(8, d.bottom - dy)),
    });
  };
  const endDrag = () => {
    dragRef.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", endDrag);
  };
  const startDrag = (e) => {
    if (e.target.closest("button")) return; // don't drag when hitting a control
    e.preventDefault();
    const self = e.currentTarget.getBoundingClientRect();
    const parent = e.currentTarget.parentElement?.getBoundingClientRect();
    dragRef.current = { sx: e.clientX, sy: e.clientY, right: pos.right, bottom: pos.bottom, parent, w: self.width, h: self.height };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endDrag);
  };

  return (
    <div
      onPointerDown={startDrag}
      className="group/self absolute z-40 rounded-xl overflow-hidden ring-1 ring-white/25 shadow-2xl bg-slate-900 cursor-grab active:cursor-grabbing"
      style={{ right: pos.right, bottom: pos.bottom, width: minimized ? 132 : 188, aspectRatio: "16 / 9", touchAction: "none" }}
    >
      <ClusterParticipantTile trackRef={trackRef} />
      <div className="absolute top-1 right-1 z-10 flex items-center gap-0.5 opacity-0 group-hover/self:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={() => setMinimized((v) => !v)}
          title={minimized ? "Enlarge" : "Shrink"}
          className="p-1 rounded bg-black/55 text-white/90 hover:text-white"
        >
          {minimized ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
        </button>
        <button
          type="button"
          onClick={onDock}
          title="Show my video in the grid instead"
          className="p-1 rounded bg-black/55 text-white/90 hover:text-white"
        >
          <LayoutGrid className="w-3 h-3" />
        </button>
      </div>
      <span className="absolute bottom-1 left-1.5 text-[9px] font-medium text-white/80 px-1 rounded bg-black/40 pointer-events-none">You</span>
    </div>
  );
}

// The video stage. Switches between layout modes — grid (uniform clamped
// tiles), presenter (one big focus + a strip of the rest), and spotlight (just
// the focus). Grid always stays a true grid (screen share / pins reorder tiles,
// not layout shape). A squished tile collapses to spotlight. Clicking a tile's
// focus button pins it (LiveKit's LayoutContextProvider wires that into
// ParticipantTile for free).
function Stage({ compact, publish, onJoinIn, layoutMode, spotlightIgnoreSelf, roomId, peopleOpen, onClosePeople }) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const participants = useParticipants();
  const speaking = useSpeakingParticipants();
  const pinned = usePinnedTracks();
  const globalPinId = useGlobalPin();
  const pinControl = usePinControlValue(roomId);
  const rootRef = useRef(null);
  const { w, h } = useSize(rootRef);

  // Featured speaker: HOLD the last speaker so Spotlight/Presenter stay on
  // whoever spoke last instead of snapping back to the first tile between turns.
  // When "don't spotlight me" is on, drop yourself from the candidates so you
  // never feature your own tile to yourself — others still see you featured when
  // you talk (this is purely your local view).
  const localId = participants.find((p) => p.isLocal)?.identity || null;
  const speakingForFeature = spotlightIgnoreSelf && localId
    ? speaking.filter((p) => p.identity !== localId)
    : speaking;
  const featuredSpeaker = useFeaturedSpeaker(speakingForFeature, { decayMs: 2500, hold: true });
  const featuredSpeakerForStage = spotlightIgnoreSelf && featuredSpeaker === localId
    ? null
    : featuredSpeaker;

  // Spectators are listed by name; publishers (even camera-off) get a tile.
  const spectators = participants.filter((p) => p.attributes?.role === "spectator" && !p.isLocal);
  const shown = tracks.filter((t) => {
    const p = t.participant;
    if (!p) return true;
    if (p.attributes?.role === "spectator") return false; // listed, not tiled
    if (!publish && p.isLocal) return false; // don't show your own empty tile
    return true;
  });

  const screenTrack = shown.find((t) => t.source === Track.Source.ScreenShare);
  const autoFocusFallback = spotlightIgnoreSelf && localId
    ? shown.find((t) => t.participant?.identity !== localId)
    : shown[0];
  const speakerTrack = featuredSpeakerForStage
    ? shown.find((t) => t.participant?.identity === featuredSpeakerForStage && t.source === Track.Source.Camera)
    : null;
  // The admin's global pin (room metadata) focuses this participant for everyone,
  // unless you've locally pinned someone else. Their screen share wins over their
  // camera (the presenter case).
  const globalPinTrack = globalPinId
    ? shown.find((t) => t.participant?.identity === globalPinId && t.source === Track.Source.ScreenShare)
      || shown.find((t) => t.participant?.identity === globalPinId && t.source === Track.Source.Camera)
    : null;
  // An EXPLICIT focus (your pin > admin global pin > a screen share) picks the
  // presenter/spotlight big tile. In grid mode these only affect tile order.
  const forcedFocus = (pinned && pinned[0]) || globalPinTrack || screenTrack || null;
  const focusTrack = forcedFocus || speakerTrack || autoFocusFallback || null;
  const pinnedTrackKey = pinned?.[0] ? refKey(pinned[0]) : null;
  const rankOpts = {
    featuredId: featuredSpeakerForStage,
    speaking,
    globalPinId,
    pinnedTrackKey,
  };

  // A squished tile (e.g. a tiny office panel) collapses to just the speaker.
  const squished = useSquishedLayout(w, h);

  // Automatic pin + spotlight: when you've explicitly chosen Spotlight or
  // Presenter AND something is pinned (your pin, the admin's global pin, or a
  // screen share), show the pin AND the live speaker as two big tiles — the
  // "room view + who's talking" view. In Spotlight those two are the whole stage;
  // in Presenter everyone else drops into the filmstrip. Only when the speaker is
  // a different track than the pin, and not in the cramped squished case.
  const dualEligible =
    !squished &&
    !!forcedFocus &&
    !!speakerTrack &&
    refKey(forcedFocus) !== refKey(speakerTrack);
  const dualSpotlight = dualEligible && layoutMode === "spotlight";
  const dualPresenter = dualEligible && layoutMode === "presenter";
  const dual = dualSpotlight || dualPresenter;

  // Floating self-view: pull your own camera tile out of the grid into a PiP
  // (unless it's one of the big tiles — then it stays big). Everyone else still
  // sees you as a normal tile; this is purely your local arrangement.
  const { float, setFloat } = useContext(SelfViewContext);
  const localCamTrack = shown.find(
    (t) => t.participant?.isLocal && t.source === Track.Source.Camera && t.publication && !t.publication.isMuted,
  );
  const localIsBig = !!localCamTrack && (
    dual
      ? (refKey(localCamTrack) === refKey(forcedFocus) || refKey(localCamTrack) === refKey(speakerTrack))
      : (!!focusTrack && refKey(localCamTrack) === refKey(focusTrack))
  );
  const floatLocal = float && publish && !!localCamTrack && !localIsBig;
  const baseTiles = floatLocal ? shown.filter((t) => t !== localCamTrack) : shown;

  let mode = layoutMode;
  if (squished) mode = "spotlight";

  // Map the resolved mode to the adaptive stage: grid = even tiles; presenter =
  // focus + filmstrip; spotlight = focus only (or, when pinned, pin + live
  // speaker as two big tiles). In GRID mode, once there are more people than fit
  // at a comfortable size, the extras spill into the audience row (avatar chips)
  // — rankTiles keeps screen shares, pins, and speakers visible in the grid cap.
  let stageTiles;
  let stageFocusKey = null;
  let stageFocusKeys = null;
  let audienceTiles = [];
  const AUDIENCE_H = 80;
  if (dualSpotlight) {
    // Two equal big tiles — the pinned view + the live speaker. No focus keys →
    // the adaptive stage lays them out as an even 2-cell grid, nothing else.
    stageTiles = [forcedFocus, speakerTrack];
  } else if (dualPresenter) {
    // Pin + live speaker as two big tiles, everyone else in the filmstrip.
    stageTiles = baseTiles;
    stageFocusKeys = [refKey(forcedFocus), refKey(speakerTrack)];
  } else if (mode === "spotlight" && focusTrack) {
    stageTiles = [focusTrack];
    stageFocusKey = refKey(focusTrack);
  } else if (mode === "presenter" && focusTrack) {
    stageTiles = baseTiles;
    stageFocusKey = refKey(focusTrack);
  } else {
    const ordered = rankTiles(baseTiles, rankOpts);
    if (ordered.length > capFor(w, h)) {
      const cap = capFor(w, h - AUDIENCE_H);
      stageTiles = ordered.slice(0, cap);
      audienceTiles = ordered.slice(cap);
    } else {
      stageTiles = ordered;
    }
  }

  return (
    <PinControlContext.Provider value={pinControl}>
      <div ref={rootRef} className="relative flex-1 min-h-0 flex flex-col">
        <div className="relative flex-1 min-h-0">
          <AdaptiveStage
            tiles={stageTiles.map((t) => ({ key: refKey(t), content: <ClusterParticipantTile trackRef={t} /> }))}
            focusKey={stageFocusKey}
            focusKeys={stageFocusKeys}
          />
        </div>
        {audienceTiles.length > 0 && <AudienceRow tracks={audienceTiles} />}

        {floatLocal && <FloatingSelfView trackRef={localCamTrack} onDock={() => setFloat(false)} />}

        <SpectatorList spectators={spectators} />
        {peopleOpen && <PeoplePanel roomId={roomId} onClose={onClosePeople} />}

        {/* The spectator → publisher control lives in RoomVideoStage's JoinDock,
            overlaid on this call (it owns the persisted mic/camera join intent and
            the live preview context). PiP has no join affordance — go back to the
            room to join. onJoinIn is still wired for any future in-call use. */}
      </div>
    </PinControlContext.Provider>
  );
}

function ConferenceLayout({ compact, publish, onJoinIn, emote, roomId, micMuted, onToggleMic, deafened, onToggleDeafen, chromeless }) {
  // Collapse the control bar to icon-only below this width so the video can
  // stay small without the toolbar overflowing.
  const rootRef = useRef(null);
  const [tight, setTight] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  // Fullscreen the call's own root (stage + controls), so it takes over the
  // whole screen rather than just maximizing the browser window.
  const { isFs: isFullscreen, supported: fullscreenSupported, toggle: toggleFullscreen } = useFullscreen(rootRef);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const apply = () => setTight(el.clientWidth < 380);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-hiding controls: the bar floats over the video and fades after a few
  // seconds idle, returning on any pointer activity (Meet / FaceTime style). It
  // stays put while the pointer is over it (so menus don't vanish mid-use).
  const [controlsShown, setControlsShown] = useState(true);
  const hideTimerRef = useRef(null);
  const overBarRef = useRef(false);
  const reveal = () => {
    setControlsShown(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (!overBarRef.current) hideTimerRef.current = setTimeout(() => setControlsShown(false), 3000);
  };
  useEffect(() => {
    reveal();
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onBarEnter = () => {
    overBarRef.current = true;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setControlsShown(true);
  };
  const onBarLeave = () => { overBarRef.current = false; reveal(); };

  const [layoutMode, setLayoutMode] = useState(() => {
    // One-time reset: Grid is now the default for everyone. Clear any previously
    // saved Spotlight/Presenter choice once so all users land on Grid; after this
    // they can freely re-pick and it persists again.
    try {
      if (!localStorage.getItem("ql_lk_layout_reset_grid")) {
        localStorage.removeItem(PREF.layout);
        localStorage.setItem("ql_lk_layout_reset_grid", "1");
      }
    } catch { /* ignore (private mode) */ }
    const v = loadPref(PREF.layout, "grid");
    if (v === "grid" || v === "presenter" || v === "spotlight") return v;
    return v === "speaker" ? "presenter" : "grid"; // migrate the old grid/speaker pref
  });
  // "Don't spotlight me" — exclude yourself from the featured-speaker view so you
  // never spotlight your own tile to yourself. Opt-in (default off).
  const [spotlightIgnoreSelf, setSpotlightIgnoreSelf] = useState(() => loadPref(PREF.spotlightIgnoreSelf, "0") === "1");
  // Background effect descriptor: "none" | "blur:<radius>" | "image:<id|custom>".
  const [bg, setBg] = useState(() => loadPref(PREF.bg, "none"));
  const [customBg, setCustomBg] = useState(() => loadPref(PREF.bgCustom, "") || null);
  // Noise cancellation defaults ON (the whole point), where supported.
  const [noiseEnabled, setNoiseEnabled] = useState(() => loadPref(PREF.noise, "1") === "1");
  // Proximity auto mic-switching is experimental → defaults OFF.
  const [autoMic, setAutoMic] = useState(() => loadPref(PREF.autoMic, "0") === "1");
  // Push-to-talk: when on, the mic stays muted and a held Space key opens it for
  // the duration of the press. Off by default.
  const [ptt, setPtt] = useState(() => loadPref(PREF.ptt, "0") === "1");
  // Self-view: mirror your own camera + float it as a PiP. Both default ON (the
  // Meet convention).
  const [mirror, setMirror] = useState(() => loadPref(PREF.mirror, "1") === "1");
  const [selfFloat, setSelfFloat] = useState(() => loadPref(PREF.selfFloat, "1") === "1");

  useEffect(() => savePref(PREF.layout, layoutMode), [layoutMode]);
  useEffect(() => savePref(PREF.spotlightIgnoreSelf, spotlightIgnoreSelf ? "1" : "0"), [spotlightIgnoreSelf]);
  useEffect(() => savePref(PREF.bg, bg), [bg]);
  useEffect(() => savePref(PREF.noise, noiseEnabled ? "1" : "0"), [noiseEnabled]);
  useEffect(() => savePref(PREF.autoMic, autoMic ? "1" : "0"), [autoMic]);
  useEffect(() => savePref(PREF.ptt, ptt ? "1" : "0"), [ptt]);
  useEffect(() => savePref(PREF.mirror, mirror ? "1" : "0"), [mirror]);
  useEffect(() => savePref(PREF.selfFloat, selfFloat ? "1" : "0"), [selfFloat]);
  const selfView = useMemo(() => ({ mirror, float: selfFloat, setMirror, setFloat: setSelfFloat }), [mirror, selfFloat]);

  // Push-to-talk key handling. micMuted lives in the parent; we drive it via the
  // passed toggle, reading the latest value through a ref so the listeners never
  // capture a stale state. Enabling PTT mutes you to start; then Space (held)
  // unmutes while pressed. Ignored while typing in a field, and key-repeat is
  // dropped so a long hold doesn't thrash.
  const micMutedRef = useRef(micMuted);
  micMutedRef.current = micMuted;
  useEffect(() => {
    if (!ptt) return undefined;
    if (!micMutedRef.current) onToggleMic?.(); // start muted when PTT turns on
    const typing = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    };
    const onDown = (e) => {
      if (e.code !== "Space" || e.repeat || typing()) return;
      e.preventDefault();
      if (micMutedRef.current) onToggleMic?.(); // open the mic while held
    };
    const onUp = (e) => {
      if (e.code !== "Space" || typing()) return;
      e.preventDefault();
      if (!micMutedRef.current) onToggleMic?.(); // close it on release
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
    // onToggleMic is stable from the parent; depend only on the enable flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptt]);

  const onUploadBg = async (file) => {
    try {
      const url = await fileToScaledDataUrl(file);
      try { localStorage.setItem(PREF.bgCustom, url); } catch { /* quota — keep in memory only */ }
      setCustomBg(url);
      setBg("image:custom");
    } catch {
      /* unreadable image — ignore */
    }
  };

  // Raise-hand state lives here so both the Stage (tile badges + People panel)
  // and the control-bar toggle read the same source.
  const handRaise = useHandRaiseValue();

  return (
    <HandRaiseContext.Provider value={handRaise}>
    <div
      ref={rootRef}
      className={`relative flex flex-col w-full h-full ${isFullscreen ? "bg-slate-950" : ""}`}
      onPointerMove={compact ? undefined : reveal}
      onPointerDown={compact ? undefined : reveal}
    >
      <EffectsController bg={bg} customBg={customBg} noiseEnabled={noiseEnabled} />
      <AutoMicController enabled={autoMic} />
      <SelfViewContext.Provider value={selfView}>
        <LayoutContextProvider>
          <Stage
            compact={compact}
            publish={publish}
            onJoinIn={onJoinIn}
            layoutMode={layoutMode}
            spotlightIgnoreSelf={spotlightIgnoreSelf}
            roomId={roomId}
            peopleOpen={peopleOpen}
            onClosePeople={() => setPeopleOpen(false)}
          />
        </LayoutContextProvider>
      </SelfViewContext.Provider>
      {!compact && !chromeless && (
        <div
          className={`absolute inset-x-0 bottom-0 z-30 flex justify-center px-2 pb-3 pointer-events-none transition-opacity duration-300 ${
            controlsShown ? "opacity-100" : "opacity-0"
          }`}
        >
          <div
            className={controlsShown ? "pointer-events-auto" : "pointer-events-none"}
            onMouseEnter={onBarEnter}
            onMouseLeave={onBarLeave}
          >
            <CallControlBar
              publish={publish}
              tight={tight}
              emote={emote}
              layoutMode={layoutMode}
              onSetLayout={setLayoutMode}
              ignoreSelf={spotlightIgnoreSelf}
              onToggleIgnoreSelf={() => setSpotlightIgnoreSelf((v) => !v)}
              bg={bg}
              onChangeBg={setBg}
              customBg={customBg}
              onUploadBg={onUploadBg}
              noiseEnabled={noiseEnabled}
              onToggleNoise={() => setNoiseEnabled((v) => !v)}
              autoMic={autoMic}
              onToggleAutoMic={() => setAutoMic((v) => !v)}
              ptt={ptt}
              onTogglePtt={() => setPtt((v) => !v)}
              mirror={mirror}
              onToggleMirror={() => setMirror((v) => !v)}
              selfFloat={selfFloat}
              onToggleSelfFloat={() => setSelfFloat((v) => !v)}
              micMuted={micMuted}
              onToggleMic={onToggleMic}
              deafened={deafened}
              onToggleDeafen={onToggleDeafen}
              peopleOpen={peopleOpen}
              onTogglePeople={() => setPeopleOpen((v) => !v)}
              fullscreenSupported={fullscreenSupported}
              isFullscreen={isFullscreen}
              onToggleFullscreen={toggleFullscreen}
            />
          </div>
        </div>
      )}
    </div>
    </HandRaiseContext.Provider>
  );
}

export default function LiveKitCall({ roomId, displayName, compact, publish = true, listen = true, choices, chromeless = false, onJoinIn, emote, onJoined, onLeft, onError }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [token, setToken] = useState(null);
  // Personal mic mute — your own control, kept separate from the room's
  // behind-the-scenes auto-mute. Seeded from the join choice.
  const [micMuted, setMicMuted] = useState(choices?.audioEnabled === false);
  // Deafen — one control to silence ALL audio, incoming and outgoing (Discord
  // style). Incoming is cut by not rendering the audio renderer below; outgoing
  // by muting the mic (deafening forces micMuted on, so the mic button + publish
  // both reflect it). Un-deafening leaves the mic muted; the user unmutes when
  // ready.
  const [deafened, setDeafened] = useState(false);
  const toggleMic = () => {
    if (deafened) return;
    setMicMuted((v) => !v);
  };
  const toggleDeafen = () => {
    const next = !deafened;
    setDeafened(next);
    if (next) setMicMuted(true); // deafening also mutes your mic
  };

  useEffect(() => {
    let cancelled = false;
    setToken(null);
    const room = liveKitRoomName(roomId);
    // Throttle: if we connected to this room very recently (StrictMode double-
    // mount, an HMR remount, or a rapid rejoin), wait out the cooldown before
    // minting a token + connecting again, so we stop spamming the backend. Also
    // honor the global post-failure breaker so a 429 backs off the next connect.
    const delay = Math.max(connectDelayFor(room), connectCooldownMs());
    const timer = setTimeout(() => {
      if (cancelled) return;
      markConnectAttempt(room);
      (async () => {
        try {
          const t = await fetchLiveKitToken(room, displayName);
          if (!cancelled) setToken(t);
        } catch (e) {
          if (!cancelled) {
            const msg = e?.message || "Could not get a LiveKit token";
            console.warn(`[livekit] token mint failed (room ${roomId}): ${msg}`);
            diagRecord(room, "token_error", { message: msg });
            noteConnectFailure();
            onError?.(msg);
          }
        }
      })();
    }, delay);
    return () => { cancelled = true; clearTimeout(timer); };
    // Re-mint only on room change (identity is the user, not the name).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  if (!LIVEKIT_URL) {
    onError?.("LiveKit is not configured (missing VITE_LIVE_KIT_URL)");
    return null;
  }

  if (!token) {
    return <div className="w-full h-full rounded-xl overflow-hidden bg-slate-900" aria-label="Connecting to call" />;
  }

  const lkTheme = {
    height: "100%",
    "--lk-bg": dark ? "#0b1220" : "#0f172a",
    "--lk-bg-secondary": dark ? "#0f172a" : "#1e293b",
    "--lk-fg": "#f1f5f9",
    "--lk-accent-bg": "var(--color-accent)",
    "--lk-accent-fg": "#ffffff",
    "--lk-control-bg": "rgba(255,255,255,0.08)",
    "--lk-control-fg": "#f1f5f9",
    "--lk-border-radius": "0.75rem",
  };

  return (
    <div
      className="w-full h-full rounded-xl overflow-hidden"
      data-lk-theme="default"
      style={lkTheme}
    >
      <LiveKitRoom
        serverUrl={LIVEKIT_URL}
        token={token}
        connect
        // Always connect subscribe-only; PublishController enables devices
        // when publishing so spectate↔join flips without a reconnect.
        video={false}
        audio={false}
        // Capped-backoff reconnect + bounded initial retries so a failed
        // connect can't 429-storm LiveKit Cloud across every region.
        options={LK_ROOM_OPTIONS}
        connectOptions={LK_CONNECT_OPTIONS}
        style={{ height: "100%" }}
        onConnected={() => {
          // A plain breadcrumb so a session has a visible start in the console to
          // bound the disconnect dump against. (ConnectionDiagnostics resets its
          // buffer on this same event.)
          console.info(`[livekit] connected (room ${roomId})`);
          onJoined?.();
        }}
        onDisconnected={(reason) => {
          const name = LK_DISCONNECT_REASON[reason] ?? `code_${reason ?? "none"}`;
          // Pull the full lead-up (duration, reconnect count, quality history,
          // online/visibility at drop) recorded by <ConnectionDiagnostics>.
          const report = diagReport(liveKitRoomName(roomId), name, reason ?? null);
          // Anything other than our own leave is unexpected — dump the whole
          // timeline so a silent bounce becomes diagnosable (network reconnect
          // storm vs. server kick vs. went offline), and pass it up for analytics.
          if (reason !== undefined && reason !== 1) {
            console.warn(
              `[livekit] disconnected: ${name} (room ${roomId}) after ${report.durationS}s` +
                `${report.reconnects ? `, ${report.reconnects} reconnect attempt(s)` : ""}` +
                `, last quality ${report.lastQuality}, online=${report.env.online}`,
              report,
            );
          }
          onLeft?.(name, report);
        }}
        onError={(e) => {
          // A room-level error (often the prelude to a drop) — record it into the
          // timeline and surface it, then arm the cooldown + bubble up as before.
          const msg = e?.message || "LiveKit connection error";
          diagRecord(liveKitRoomName(roomId), "error", { message: msg });
          console.warn(`[livekit] room error (room ${roomId}): ${msg}`);
          noteConnectFailure();
          onError?.(msg);
        }}
      >
        <RoomEntryHoldProvider>
          <PublishController publish={publish} choices={choices} micMuted={micMuted} />
          {/* Silent connection-health recorder — feeds the disconnect report so a
              force disconnect can be explained, not just observed. */}
          <ConnectionDiagnostics roomId={roomId} />
          <ConferenceLayout compact={compact} publish={publish} onJoinIn={onJoinIn} emote={emote} roomId={roomId} micMuted={micMuted} onToggleMic={toggleMic} deafened={deafened} onToggleDeafen={toggleDeafen} chromeless={chromeless} />
          {/* Owns in-room cluster management (leader handoff). Mount once. */}
          <RoomClusterManager />
          {/* Restore the saved audio-output device on connect. */}
          <SavedSpeakerApplier />
          {/* In-room followers receive no audio at all (the room speaker carries
              it for them); everyone else plays normally. holdForEntry keeps a
              still-clustering "in this room" joiner silent during the entry window. */}
          <FollowerAudioGate holdForEntry={publish && !!choices?.inRoom} />
          {/* Required for participants to be audible — suppressed for in-room
              followers so the leader's speakers don't echo back through them. Also
              gated on `listen`: a silent auto-preview spectator plays NOTHING, so
              walking up to a room can't blast the call through your speakers and
              (if a live participant is nearby) feed back into the room. Publishers
              always hear; explicit watchers and join always have listen=true. */}
          {(publish || listen) && !deafened && <ClusterAudioRenderer holdForEntry={publish && !!choices?.inRoom} />}
        </RoomEntryHoldProvider>
      </LiveKitRoom>
    </div>
  );
}
