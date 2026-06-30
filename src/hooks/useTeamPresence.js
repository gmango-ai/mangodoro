import { useEffect, useState } from "react";
import { supabase } from "../supabase";

// Team-wide "who's online RIGHT NOW" via Supabase Realtime Presence.
//
// Why not reuse work_status / user_settings.presence_state? Those are DB rows:
// work_status is only written while clocked in, and presence_state goes STALE
// when a tab closes ungracefully (it stays "active" forever). Realtime Presence
// auto-clears when a client's socket drops — the reliable "they're actually
// here" signal. One shared channel per team (`team-presence:{teamId}`) that every
// member joins; PresenceSync owns the local track(), any component can read the
// roster via useTeamPresence(). Drives the hallway's "online but not clocked in".

let _channel = null;
let _teamId = null;
let _me = null;            // { id, name, avatar_url }
let _myState = "active";   // local presence_state, tracked into the channel
let _online = [];          // [{ user_id, presence_state, name, avatar_url }]
const _subs = new Set();

function emit() { for (const fn of _subs) fn(_online); }

// Higher = "more present"; used to collapse a user's multiple tabs to one entry.
const _ORDER = { active: 5, heads_down: 4, in_meeting: 3, available: 2, commuting: 1, out_to_lunch: 0, away: 0 };
const rank = (s) => _ORDER[s] ?? 1;

function recompute() {
  if (!_channel) { _online = []; emit(); return; }
  let state = {};
  try { state = _channel.presenceState() || {}; } catch { state = {}; }
  const byUser = new Map();
  for (const key of Object.keys(state)) {
    for (const meta of state[key] || []) {
      if (!meta?.user_id) continue;
      const cand = {
        user_id: meta.user_id,
        presence_state: meta.presence_state || "active",
        name: meta.name || "",
        avatar_url: meta.avatar_url || "",
      };
      const prev = byUser.get(meta.user_id);
      if (!prev || rank(cand.presence_state) > rank(prev.presence_state)) byUser.set(meta.user_id, cand);
    }
  }
  _online = [...byUser.values()];
  emit();
}

function trackMe() {
  if (!_channel || !_me) return;
  try { _channel.track({ user_id: _me.id, name: _me.name, avatar_url: _me.avatar_url, presence_state: _myState }); } catch { /* */ }
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

export function setMyPresenceState(state) {
  _myState = state || "active";
  trackMe();
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
