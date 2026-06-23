import { useEffect, useState } from "react";
import {
  LiveKitRoom,
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
  useLocalParticipant,
  useRoomContext,
} from "@livekit/components-react";
import { Track, RoomEvent } from "livekit-client";
import "@livekit/components-styles";
import { LIVEKIT_URL, fetchLiveKitToken, liveKitRoomName } from "../../lib/livekit";
import { ATTR_CLUSTER, ATTR_LEADER, ATTR_ROOM_DEVICE } from "./useRoomCluster";

// Advertises the locked device as its room's default audio leader (companion
// mode). The device is always-on and already publishes mic + plays the call
// aloud — i.e. it IS the room's speaker — so it self-claims leadership and
// flags itself as the room device. People physically in the room then see it
// as the room to join (muted) from their own LiveKitCall; remote members are
// unaffected. Re-asserts after a reconnect in case attributes didn't survive
// the rejoin. The cluster id is the device's (stable) identity.
function DeviceClusterBeacon() {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  useEffect(() => {
    const id = localParticipant?.identity;
    if (!id) return undefined;
    const assert = () =>
      localParticipant
        .setAttributes({
          role: "publisher",
          [ATTR_CLUSTER]: id,
          [ATTR_LEADER]: id,
          [ATTR_ROOM_DEVICE]: "1",
        })
        .catch(() => { /* device keeps publishing regardless */ });
    assert();
    if (!room) return undefined;
    room.on(RoomEvent.Reconnected, assert);
    return () => { room.off(RoomEvent.Reconnected, assert); };
  }, [localParticipant, room]);
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

// Always-on two-way video portal for the device kiosk. Publishes the device's
// camera + mic and shows everyone in the room's LiveKit call, so remote members
// can drop in and see/hear the physical office — and be seen/heard back. No
// controls (it's a fixed portal, not an interactive call).
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
        <DeviceClusterBeacon />
        <PortalGrid />
        {/* Plays remote audio so the office hears whoever drops in. */}
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  );
}
