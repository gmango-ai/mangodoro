import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { listTeamPresence } from "../lib/userPresence";
import { useTeamPresence } from "./useTeamPresence";
import { mergeOfficePresence } from "../lib/officePresence";

// Office-wide status roster (seam ① read side). A refcounted singleton realtime
// sub + minute poll over user_presence (mirrors useClockedIn), merged with
// useTeamPresence liveness via the pure mergeOfficePresence.
//
// NOT YET CONSUMED by any surface — the read side stays inert until go-live.

let _rows = [];
const _subs = new Set();
let _channel = null;
let _poll = null;
let _refcount = 0;

function emit() { for (const fn of _subs) fn(_rows); }
async function reload() { _rows = await listTeamPresence(); emit(); }

function start() {
  if (_refcount === 0) {
    reload();
    // Unique channel name per creation (same reasoning as useClockedIn).
    _channel = supabase
      .channel(`user_presence:shared:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_presence" }, reload)
      .subscribe();
    _poll = setInterval(reload, 60000);
  }
  _refcount += 1;
}

function stop() {
  _refcount -= 1;
  if (_refcount <= 0) {
    _refcount = 0;
    if (_channel) { try { supabase.removeChannel(_channel); } catch { /* */ } _channel = null; }
    if (_poll) { clearInterval(_poll); _poll = null; }
    _rows = [];
  }
}

// `identity` is an optional { userId: { name, avatar } } map (e.g. team members)
// so offline teammates still get a name/avatar and the whole team is listed.
export function useOfficePresence(identity = {}) {
  const [rows, setRows] = useState(_rows);
  const online = useTeamPresence();

  useEffect(() => {
    _subs.add(setRows);
    start();
    setRows(_rows);
    return () => { _subs.delete(setRows); stop(); };
  }, []);

  return mergeOfficePresence(rows, online, identity);
}
