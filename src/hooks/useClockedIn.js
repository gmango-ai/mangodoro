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

// Patch _rows from the realtime payload instead of refetching the whole list
// on every change (listClockedIn selects plain work_status columns, all present
// in the payload). The 60s poll below stays as the reconciliation pass.
function applyChange({ eventType, new: newRow, old: oldRow }) {
  const uid = newRow?.user_id ?? oldRow?.user_id;
  if (!uid) { reload(); return; } // can't identify the row — reconcile
  const clockedIn = eventType !== "DELETE" && !!newRow?.clocked_in_at;
  const i = _rows.findIndex((r) => r.user_id === uid);
  if (!clockedIn) {
    if (i < 0) return; // not in the list — nothing to do
    _rows = _rows.filter((r) => r.user_id !== uid);
  } else {
    const row = {
      user_id: newRow.user_id,
      team_id: newRow.team_id,
      clocked_in_at: newRow.clocked_in_at,
      on_break: newRow.on_break,
      task: newRow.task,
      updated_at: newRow.updated_at,
    };
    _rows = i < 0 ? [..._rows, row] : _rows.map((r, j) => (j === i ? row : r));
  }
  emit();
}

function start() {
  if (_refcount === 0) {
    reload();
    // Unique name per creation so a pending removeChannel can't hand us an
    // already-subscribed channel and throw on .on().
    _channel = supabase
      .channel(`work_status:shared:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "work_status" }, applyChange)
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
