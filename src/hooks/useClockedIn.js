import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { listClockedIn } from "../lib/workStatus";

// Shared "who's clocked in" signal. A module-level singleton holds ONE realtime
// subscription + minute poll over work_status, refcounted across consumers (the
// nav pill + the hallway presence bar), so we don't open a channel per mount
// (and don't collide on a shared channel topic). Returns the clocked-in rows.

let _rows = [];
const _subs = new Set();
let _channel = null;
let _poll = null;
let _refcount = 0;

function emit() { for (const fn of _subs) fn(_rows); }
async function reload() { _rows = await listClockedIn(); emit(); }

function start() {
  if (_refcount === 0) {
    reload();
    // Unique name per creation so a pending removeChannel can't hand us an
    // already-subscribed channel and throw on .on().
    _channel = supabase
      .channel(`work_status:shared:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "work_status" }, reload)
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
  }
}

export function useClockedIn() {
  const [rows, setRows] = useState(_rows);
  useEffect(() => {
    _subs.add(setRows);
    start();
    setRows(_rows); // sync to any already-loaded data
    return () => { _subs.delete(setRows); stop(); };
  }, []);
  return rows;
}
