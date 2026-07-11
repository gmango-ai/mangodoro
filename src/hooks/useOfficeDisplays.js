import { useEffect, useState } from "react";
import { supabase } from "../supabase";

// Which rooms in an org have a LIVE kiosk/room-display, learned from ONE
// org-wide presence channel rather than one subscription per room.
//
// A kiosk announces itself on `office-displays:<orgId>` tracking { room_id }
// while it's awake (useAnnounceDisplay). The hallway observes that single
// channel (useOfficeDisplays) and returns the Set of room ids that currently
// have a display — so a member can see, from the floor plan, which rooms have a
// physical display on before walking in. orgId here is the team id (rooms.team_id
// == org_devices.org_id), so both sides compute the same channel name.
export function useOfficeDisplays(orgId) {
  const [roomIds, setRoomIds] = useState(() => new Set());
  useEffect(() => {
    if (!orgId) { setRoomIds(new Set()); return undefined; }
    const channel = supabase.channel(`office-displays:${orgId}`);
    // Same channel-reuse guard as useRoomCallPresence: a leftover joined channel
    // (StrictMode double-mount) can't take new listeners after subscribe().
    if (channel.state === "joined" || channel.state === "joining") return () => {};
    const refresh = () => {
      const state = channel.presenceState();
      const s = new Set();
      for (const arr of Object.values(state)) {
        for (const p of arr) if (p.room_id) s.add(p.room_id);
      }
      setRoomIds(s);
    };
    channel.on("presence", { event: "sync" }, refresh);
    channel.on("presence", { event: "join" }, refresh);
    channel.on("presence", { event: "leave" }, refresh);
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [orgId]);
  return roomIds;
}

// Kiosk side: announce THIS display's room on the org-wide channel while enabled
// (awake). Uses a MODULE-LEVEL singleton (mirrors useTeamPresence) because the
// kiosk's inputs settle asynchronously at different times — orgId arrives after
// the room fetch, `enabled` after the sleep-schedule load — which, with a naive
// per-render channel, churned create→remove→create and left the channel joined
// but NOT tracking. The singleton makes join idempotent (same target → no-op) so
// it reliably ends up tracked. Announce-only: no `.on()` listeners, so no
// channel-reuse guard is needed (that guard's early-return was skipping track()).
let _annChannel = null;
let _annKey = null; // `${orgId}:${roomId}:${deviceKey}`

function startAnnounce({ orgId, roomId, deviceKey }) {
  const key = `${orgId}:${roomId}:${deviceKey}`;
  if (_annChannel && _annKey === key) return; // already announcing this exact target
  stopAnnounce();
  _annKey = key;
  _annChannel = supabase.channel(`office-displays:${orgId}`, { config: { presence: { key: deviceKey } } });
  _annChannel.subscribe((status) => {
    if (status === "SUBSCRIBED") { try { _annChannel.track({ room_id: roomId }); } catch { /* */ } }
  });
}

function stopAnnounce() {
  if (_annChannel) { try { supabase.removeChannel(_annChannel); } catch { /* */ } _annChannel = null; }
  _annKey = null;
}

export function useAnnounceDisplay({ orgId, roomId, deviceKey, enabled = true }) {
  useEffect(() => {
    if (!orgId || !roomId || !deviceKey || !enabled) { stopAnnounce(); return undefined; }
    startAnnounce({ orgId, roomId, deviceKey });
    return () => { stopAnnounce(); };
  }, [orgId, roomId, deviceKey, enabled]);
}
