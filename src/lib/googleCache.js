import { supabase } from "../supabase";

// Persistence for Google Calendar events so a token desync doesn't wipe them
// from the calendar. Stores the normalised events (the shape returned by
// listGoogleCalendarEvents) keyed by (user_id, event_id); RLS keeps them
// own-rows. See migration 20260709190000_google_events_cache.

// Replace the cache for a fetched window [rangeStart, rangeEnd): clear what we
// had cached for that window (so events deleted/moved-out in Google drop away)
// then upsert the fresh set (upsert, not insert, so a multi-day event already
// cached under another window doesn't collide). Call ONLY after a SUCCESSFUL
// fetch — never on a desync/empty-error — so a failed request can't wipe it.
export async function cacheGoogleEvents(userId, events, rangeStartIso, rangeEndIso) {
  if (!userId || !Array.isArray(events)) return;
  const rows = events
    .filter((g) => g && g.id != null)
    .map((g) => ({
      user_id: userId,
      event_id: String(g.id),
      payload: g,
      start_at: g.start ? new Date(g.start).toISOString() : null,
      end_at: g.end ? new Date(g.end).toISOString() : null,
    }));
  const { error: delErr } = await supabase
    .from("google_events_cache")
    .delete()
    .eq("user_id", userId)
    .gte("start_at", rangeStartIso)
    .lt("start_at", rangeEndIso);
  if (delErr) { console.warn("cacheGoogleEvents clear:", delErr.message); return; }
  if (rows.length) {
    const { error } = await supabase
      .from("google_events_cache")
      .upsert(rows, { onConflict: "user_id,event_id" });
    if (error) console.warn("cacheGoogleEvents upsert:", error.message);
  }
}

// Cached events that START within [rangeStart, rangeEnd) — the fallback shown
// while Google is disconnected. Returns the normalised event payloads so the
// caller can feed them through googleEventToEvent exactly like live ones.
export async function loadGoogleCache(rangeStartIso, rangeEndIso) {
  const { data, error } = await supabase
    .from("google_events_cache")
    .select("payload")
    .gte("start_at", rangeStartIso)
    .lt("start_at", rangeEndIso);
  if (error) { console.warn("loadGoogleCache:", error.message); return []; }
  return (data || []).map((r) => r.payload).filter(Boolean);
}
