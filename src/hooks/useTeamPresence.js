import { useEffect, useState } from "react";
import { supabase } from "../supabase";

// Team-wide "who's online RIGHT NOW" via Supabase Realtime Presence — pure
// LIVENESS. The resolved status/availability lives in user_presence; this
// channel only answers "is their socket connected?" (it auto-clears when a
// client drops, which a DB row can't). One shared channel per team
// (`team-presence:{teamId}`); PresenceSync owns the local track(); any component
// reads the roster via useTeamPresence(). Drives the hallway + the office
// roster's online/offline overlay.

let _channel = null;
let _teamId = null;
let _me = null;            // { id, name, avatar_url }
let _online = [];          // [{ user_id, name, avatar_url }]
const _subs = new Set();

function emit() { for (const fn of _subs) fn(_online); }

function recompute() {
  if (!_channel) { _online = []; emit(); return; }
  let state = {};
  try { state = _channel.presenceState() || {}; } catch { state = {}; }
  const byUser = new Map();
  for (const key of Object.keys(state)) {
    for (const meta of state[key] || []) {
      if (!meta?.user_id || byUser.has(meta.user_id)) continue; // one entry per user (any tab)
      byUser.set(meta.user_id, { user_id: meta.user_id, name: meta.name || "", avatar_url: meta.avatar_url || "" });
    }
  }
  _online = [...byUser.values()];
  emit();
}

function trackMe() {
  if (!_channel || !_me) return;
  try { _channel.track({ user_id: _me.id, name: _me.name, avatar_url: _me.avatar_url }); } catch { /* */ }
}

// Join (or re-target) the team channel. Same team → just refresh identity +
// re-track; different team → leave the old one first.
export function joinTeamPresence({ teamId, user }) {
  if (!teamId || !user?.id) return;
  if (_channel && _teamId === teamId) { _me = user; trackMe(); return; }
  leaveTeamPresence();
  _teamId = teamId;
  _me = user;
  _channel = supabase.channel(`team-presence:${teamId}`, { config: { presence: { key: user.id } } });
  _channel
    .on("presence", { event: "sync" }, recompute)
    .on("presence", { event: "join" }, recompute)
    .on("presence", { event: "leave" }, recompute)
    .subscribe((status) => { if (status === "SUBSCRIBED") trackMe(); });
}

export function leaveTeamPresence() {
  if (_channel) { try { supabase.removeChannel(_channel); } catch { /* */ } _channel = null; }
  _teamId = null; _me = null; _online = []; emit();
}

export function useTeamPresence() {
  const [online, setOnline] = useState(_online);
  useEffect(() => {
    _subs.add(setOnline);
    setOnline(_online);
    return () => { _subs.delete(setOnline); };
  }, []);
  return online;
}
