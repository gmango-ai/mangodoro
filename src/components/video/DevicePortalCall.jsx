import { useEffect, useReducer, useRef, useState } from "react";
import {
  LiveKitRoom,
  GridLayout,
  FocusLayout,
  CarouselLayout,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
  useRoomContext,
  useParticipants,
  useLocalParticipant,
  useSpeakingParticipants,
  useMediaDeviceSelect,
} from "@livekit/components-react";
import { Track, RoomEvent } from "livekit-client";
import "@livekit/components-styles";
import { Mic, MicOff, Video, VideoOff, Volume2, VolumeX, Monitor, MonitorOff, Settings } from "lucide-react";

// Per-device audio/camera choices persist locally (the kiosk is read-only, so no
// DB) — applied on connect so a paired display keeps its mic/speaker across restarts.
const DEV_PREF = { mic: "ql_device_mic", speaker: "ql_device_speaker", camera: "ql_device_camera" };

// One device <select> backed by LiveKit's device manager. Switching a kind calls
// room.switchActiveDevice under the hood (incl. setSinkId for the speaker), and we
// remember the choice per-device + re-apply it once the device list resolves.
function DeviceMediaPicker({ kind, label, storageKey }) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind });
  const appliedRef = useRef(false);
  useEffect(() => {
    if (appliedRef.current || !devices.length) return;
    let saved = null;
    try { saved = localStorage.getItem(storageKey); } catch { /* */ }
    if (saved && devices.some((d) => d.deviceId === saved)) {
      appliedRef.current = true;
      Promise.resolve(setActiveMediaDevice(saved)).catch(() => {});
    }
  }, [devices, setActiveMediaDevice, storageKey]);
  const onChange = (id) => {
    Promise.resolve(setActiveMediaDevice(id)).catch(() => {});
    try { localStorage.setItem(storageKey, id); } catch { /* */ }
  };
  return (
    <label className="block mb-2 last:mb-0">
      <span className="block text-[10px] uppercase tracking-wider opacity-60 mb-1">{label}</span>
      <select
        value={activeDeviceId || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md bg-white/10 px-2 py-1.5 text-[12px] text-white outline-none cursor-pointer"
      >
        {devices.length === 0 && <option value="">System default</option>}
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId} className="text-slate-900">
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}
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

// TV conferencing stage. Small calls use an even grid; once there are 3+
// cameras or a screen share, it switches to a spotlight (the screen share, else
// the active speaker, else the first person) with the rest in a filmstrip — the
// glanceable "who's talking" framing you want on a big communal display.
function PortalStage() {
  const cameras = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
  const screens = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }], { onlySubscribed: false });
  const speaking = useSpeakingParticipants();

  if (!screens.length && cameras.length <= 2) {
    return (
      <GridLayout tracks={cameras} style={{ height: "100%" }}>
        <ParticipantTile />
      </GridLayout>
    );
  }

  const speakerCam = speaking.length
    ? cameras.find((t) => t.participant?.identity === speaking[0]?.identity)
    : null;
  const focus = screens[0] || speakerCam || cameras[0];
  const strip = cameras.filter((t) => t !== focus);

  return (
    <div className="flex flex-col h-full gap-3 p-3">
      <div className="flex-1 min-h-0 rounded-2xl overflow-hidden bg-black/30">
        <FocusLayout trackRef={focus} style={{ height: "100%" }} />
      </div>
      {strip.length > 0 && (
        <div className="h-[20%] min-h-[88px]">
          <CarouselLayout tracks={strip} orientation="horizontal">
            <ParticipantTile />
          </CarouselLayout>
        </div>
      )}
    </div>
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
  const [settingsOpen, setSettingsOpen] = useState(false);
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
      <span className="self-stretch w-px bg-white/15 mx-1.5" aria-hidden="true" />
      {/* Device picker — set which mic / speaker / camera this kiosk uses. */}
      <div className="relative flex items-center">
        <button
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          title="Choose microphone, speaker, and camera"
          aria-label="Device settings"
          aria-expanded={settingsOpen}
          className={`flex flex-col items-center gap-0.5 px-2.5 py-1 rounded-lg transition-colors ${
            settingsOpen ? "text-white bg-white/15" : "text-white hover:bg-white/10"
          }`}
        >
          <Settings className="w-5 h-5" />
          <span className="text-[9px] font-medium leading-none">Devices</span>
        </button>
        {settingsOpen && (
          <div className="absolute bottom-full right-0 mb-2 w-64 rounded-xl bg-slate-900/95 backdrop-blur p-3 shadow-2xl ring-1 ring-white/10 text-left">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60 mb-2">Devices</div>
            <DeviceMediaPicker kind="audioinput" label="Microphone" storageKey={DEV_PREF.mic} />
            <DeviceMediaPicker kind="audiooutput" label="Speaker" storageKey={DEV_PREF.speaker} />
            <DeviceMediaPicker kind="videoinput" label="Camera" storageKey={DEV_PREF.camera} />
          </div>
        )}
      </div>
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
        <PortalStage />
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
