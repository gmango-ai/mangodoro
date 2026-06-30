import { useEffect, useState } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";

// The room-level "global pin" — a team admin pins a participant and EVERY
// client's view focuses them. It's stored in LiveKit room metadata (written by
// the livekit-moderate edge function), so it propagates to all clients via
// RoomMetadataChanged. Shared by the member call (LiveKitCall) and the room
// kiosk (DevicePortalCall) so both honour the same pin. Returns the pinned
// participant identity (a user uid) or null.
export function parseGlobalPin(metadata) {
  if (!metadata) return null;
  try {
    return JSON.parse(metadata)?.pinnedIdentity || null;
  } catch {
    return null;
  }
}

export function useGlobalPin() {
  const room = useRoomContext();
  const [pinnedId, setPinnedId] = useState(() => parseGlobalPin(room?.metadata));
  useEffect(() => {
    if (!room) return undefined;
    const update = () => setPinnedId(parseGlobalPin(room.metadata));
    update();
    room.on(RoomEvent.RoomMetadataChanged, update);
    return () => room.off(RoomEvent.RoomMetadataChanged, update);
  }, [room]);
  return pinnedId;
}
