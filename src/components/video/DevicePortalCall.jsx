import { useEffect, useReducer, useState } from "react";
import {
  LiveKitRoom,
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
  useRoomContext,
  useParticipants,
  useLocalParticipant,
} from "@livekit/components-react";
import { Track, RoomEvent } from "livekit-client";
import "@livekit/components-styles";
import { Mic, MicOff, Video, VideoOff, Volume2, VolumeX, Monitor, MonitorOff } from "lucide-react";
import { LIVEKIT_URL, fetchLiveKitToken, liveKitRoomName } from "../../lib/livekit";
import { ATTR_CLUSTER, ATTR_LEADER, ATTR_ROOM_DEVICE, pickMicSource, pickAudioSink } from "./useRoomCluster";

// Advertises the locked device as its room's default mic + speakers (companion
// mode). The device is always-on and already publishes mic + plays the call
// aloud, so it self-claims the mic role and flags itself the room device; people
// physically in the room then join it (muted) from their own LiveKitCall.
//
// MUST run once the room is actually connected: before the server join completes
// the local identity isn't assigned and setAttributes is a no-op, so asserting
// only on mount silently did nothing (the original bug). Assert on Connected (and
// Reconnected, in case attributes don't survive a rejoin), plus immediately in
// case we mounted already-connected. Cluster id = the device's stable identity.
function DeviceClusterBeacon() {
  const room = useRoomContext();
  useEffect(() => {
    if (!room) return undefined;
    const assert = () => {
      const lp = room.localParticipant;
      const id = lp?.identity;
      if (!id || room.state !== "connected") return;
      lp.setAttributes({
        role: "publisher",
        [ATTR_CLUSTER]: id,
        [ATTR_LEADER]: id,
        [ATTR_ROOM_DEVICE]: "1",
      }).catch(() => { /* device keeps publishing regardless */ });
    };
    assert();
    room.on(RoomEvent.Connected, assert);
    room.on(RoomEvent.Reconnected, assert);
    return () => {
      room.off(RoomEvent.Connected, assert);
      room.off(RoomEvent.Reconnected, assert);
    };
  }, [room]);
  return null;
}

// The device's current room roles. Either goes false once someone in the room
// takes over that role: the device then pauses its mic / speakers so two mics
// or two speakers in one space don't conflict.
function useDeviceRoles() {
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
  const myId = room?.localParticipant?.identity;
  // Assume both until we know otherwise (avoids cutting out on connect).
  if (!myId) return { isMicSource: true, isAudioSink: true };
  // The device's cluster id is its own identity (set by the beacon).
  const members = participants.filter((p) => p.attributes?.[ATTR_CLUSTER] === myId);
  if (!members.length) return { isMicSource: true, isAudioSink: true };
  const micId = pickMicSource(members);
  return { isMicSource: micId === myId, isAudioSink: pickAudioSink(members, micId) === myId };
}

function PortalGrid() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  return (
    <GridLayout tracks={tracks} style={{ height: "100%" }}>
      <ParticipantTile />
    </GridLayout>
  );
}

// One labelled kiosk control. `on` = the function is active (mic live, camera
// on, sound playing, screen showing); when off it tints amber so "this is
// switched off" reads at a glance. The text label + tooltip spell out exactly
// what it does, since icons alone made the four controls easy to confuse.
function CtrlButton({ on, onIcon: OnIcon, offIcon: OffIcon, label, title, disabled, onClick }) {
  const Icon = on ? OnIcon : OffIcon;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-pressed={!on}
      className={`flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 ${
        on ? "text-white hover:bg-white/10" : "text-amber-300 bg-white/5 hover:bg-white/10"
      }`}
    >
      <Icon className="w-5 h-5" />
      <span className="text-[9px] font-medium leading-none">{label}</span>
    </button>
  );
}

// On-kiosk controls, grouped so the two "mute"s and two "hide"s aren't confused:
//   Room sends  → Mic (audio the room sends out) · Camera (video the room sends out)
//   This screen → Sound (call audio playing here) · Screen (call video shown here)
// The Mic auto-mutes (and locks out here) while someone in the room has taken
// over the mic — its tooltip says so.
function DeviceControls({
  micOn, micOverridden, onToggleMic,
  cameraOn, onToggleCamera,
  soundOn, soundOverridden, onToggleSound,
  screenOn, onToggleScreen,
}) {
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-stretch gap-0.5 rounded-2xl bg-black/55 backdrop-blur px-2 py-1.5 opacity-60 hover:opacity-100 focus-within:opacity-100 transition-opacity">
      <CtrlButton
        on={micOn}
        onIcon={Mic}
        offIcon={MicOff}
        label="Mic"
        disabled={micOverridden}
        title={micOverridden
          ? "Someone in the room has taken over the mic — the device mic is paused"
          : micOn ? "Mute the room mic (stop sending the room's audio)" : "Unmute the room mic"}
        onClick={onToggleMic}
      />
      <CtrlButton
        on={cameraOn}
        onIcon={Video}
        offIcon={VideoOff}
        label="Camera"
        title={cameraOn ? "Turn off the room camera (others stop seeing the room)" : "Turn the room camera back on"}
        onClick={onToggleCamera}
      />
      <span className="self-stretch w-px bg-white/15 mx-1.5" aria-hidden="true" />
      <CtrlButton
        on={soundOn}
        onIcon={Volume2}
        offIcon={VolumeX}
        label="Sound"
        disabled={soundOverridden}
        title={soundOverridden
          ? "Someone in the room is the speaker — the device speaker is paused"
          : soundOn ? "Mute the call audio playing in the room" : "Play the call audio in the room again"}
        onClick={onToggleSound}
      />
      <CtrlButton
        on={screenOn}
        onIcon={Monitor}
        offIcon={MonitorOff}
        label="Screen"
        title={screenOn ? "Hide the call video on this display" : "Show the call video on this display"}
        onClick={onToggleScreen}
      />
    </div>
  );
}

// Lives inside <LiveKitRoom>: owns the device's self-management state and keeps
// its mic gated by both the operator's intent (micOn) and whether the device is
// still the room mic source (someone may have taken over).
function DevicePortalInner() {
  const { localParticipant } = useLocalParticipant();
  const { isMicSource, isAudioSink } = useDeviceRoles();
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [soundOn, setSoundOn] = useState(true); // the room's speaker output
  const [screenOn, setScreenOn] = useState(true); // the call video on this display

  useEffect(() => {
    if (!localParticipant) return;
    localParticipant.setMicrophoneEnabled(micOn && isMicSource).catch(() => {});
  }, [localParticipant, micOn, isMicSource]);

  useEffect(() => {
    if (!localParticipant) return;
    localParticipant.setCameraEnabled(cameraOn).catch(() => {});
  }, [localParticipant, cameraOn]);

  return (
    <>
      <DeviceClusterBeacon />
      {screenOn ? (
        <PortalGrid />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-slate-600 text-sm uppercase tracking-widest">
          Display off
        </div>
      )}
      <DeviceControls
        micOn={micOn && isMicSource}
        micOverridden={!isMicSource}
        onToggleMic={() => setMicOn((v) => !v)}
        cameraOn={cameraOn}
        onToggleCamera={() => setCameraOn((v) => !v)}
        soundOn={soundOn && isAudioSink}
        soundOverridden={!isAudioSink}
        onToggleSound={() => setSoundOn((v) => !v)}
        screenOn={screenOn}
        onToggleScreen={() => setScreenOn((v) => !v)}
      />
      {/* The device is the room's speakers by default — keep playing remote audio
          (even when someone took over the mic) unless its operator muted the
          Sound, OR someone in the room took over the speakers. */}
      {soundOn && isAudioSink && <RoomAudioRenderer />}
    </>
  );
}

// Always-on two-way video portal for the device kiosk. Publishes the device's
// camera + mic and shows everyone in the room's LiveKit call, so remote members
// can drop in and see/hear the physical office — and be seen/heard back. The
// device is the room's default mic + speakers (DeviceClusterBeacon); a small,
// clearly-labelled control cluster lets it manage its own mic/camera, the room
// sound, and this display.
export default function DevicePortalCall({ roomId, displayName }) {
  const [token, setToken] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!roomId || !LIVEKIT_URL) { setFailed(true); return undefined; }
    let cancelled = false;
    setToken(null);
    setFailed(false);
    fetchLiveKitToken(liveKitRoomName(roomId), displayName)
      .then((t) => { if (!cancelled) setToken(t); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [roomId, displayName]);

  if (failed || !token) return null;

  return (
    <div data-lk-theme="default" className="w-full h-full bg-slate-900">
      <LiveKitRoom serverUrl={LIVEKIT_URL} token={token} connect video audio style={{ height: "100%" }}>
        <DevicePortalInner />
      </LiveKitRoom>
    </div>
  );
}
