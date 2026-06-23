import { useEffect, useState } from "react";
import {
  LiveKitRoom,
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  TrackToggle,
  useTracks,
  useRoomContext,
} from "@livekit/components-react";
import { Track, RoomEvent } from "livekit-client";
import "@livekit/components-styles";
import { Volume2, VolumeX, Eye, EyeOff } from "lucide-react";
import { LIVEKIT_URL, fetchLiveKitToken, liveKitRoomName } from "../../lib/livekit";
import { ATTR_CLUSTER, ATTR_LEADER, ATTR_ROOM_DEVICE } from "./useRoomCluster";

// Advertises the locked device as its room's default speaker/mic (companion
// mode). The device is always-on and already publishes mic + plays the call
// aloud — it IS the room's speaker — so it self-claims leadership and flags
// itself the room device, and people physically in the room then join it
// (muted) from their own LiveKitCall.
//
// This MUST run once the room is actually connected: before the server join
// completes the local identity isn't assigned and setAttributes is a no-op,
// so asserting only on mount silently did nothing. We assert on Connected (and
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

// On-kiosk controls so the device can manage itself from time to time: toggle
// its camera + mic (TrackToggle drives the real publish state), mute the room
// speaker, and blank the display. Low-key for a kiosk — dimmed until hovered or
// focused (a tap counts as focus on touch screens).
function DeviceControls({ muted, onToggleMute, hideVideo, onToggleHideVideo }) {
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 rounded-full bg-black/45 backdrop-blur px-2 py-1.5 opacity-50 hover:opacity-100 focus-within:opacity-100 transition-opacity">
      <TrackToggle source={Track.Source.Microphone} />
      <TrackToggle source={Track.Source.Camera} />
      <button
        type="button"
        className="lk-button"
        aria-pressed={muted}
        title={muted ? "Unmute room speaker" : "Mute room speaker"}
        onClick={onToggleMute}
      >
        {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
      </button>
      <button
        type="button"
        className="lk-button"
        aria-pressed={hideVideo}
        title={hideVideo ? "Show video" : "Hide video"}
        onClick={onToggleHideVideo}
      >
        {hideVideo ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
      </button>
    </div>
  );
}

// Always-on two-way video portal for the device kiosk. Publishes the device's
// camera + mic and shows everyone in the room's LiveKit call, so remote members
// can drop in and see/hear the physical office — and be seen/heard back. The
// device is the room's default audio leader (DeviceClusterBeacon); a small
// control cluster lets it manage its own camera/mic, mute, and hide video.
export default function DevicePortalCall({ roomId, displayName }) {
  const [token, setToken] = useState(null);
  const [failed, setFailed] = useState(false);
  const [muted, setMuted] = useState(false);
  const [hideVideo, setHideVideo] = useState(false);

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
        <DeviceClusterBeacon />
        {hideVideo ? (
          <div className="w-full h-full flex items-center justify-center text-slate-600 text-sm uppercase tracking-widest">
            Video hidden
          </div>
        ) : (
          <PortalGrid />
        )}
        <DeviceControls
          muted={muted}
          onToggleMute={() => setMuted((v) => !v)}
          hideVideo={hideVideo}
          onToggleHideVideo={() => setHideVideo((v) => !v)}
        />
        {/* Plays remote audio so the office hears whoever drops in — unless the
            device muted its own speaker. */}
        {!muted && <RoomAudioRenderer />}
      </LiveKitRoom>
    </div>
  );
}
