import { supabase } from "../supabase";
import { seriesBaseOf } from "./calendar";

// Persistence for company events surfaced from a user's Google Calendar and
// confirmed for the whole team. Stored team-scoped (RLS: any team member reads;
// a member upserts rows stamped with their own id; publisher or admin deletes),
// deduped on (team_id, ical_uid) so the same meeting confirmed by several
// teammates collapses to ONE shared row. See migration
// 20260715120000_google_company_events.

// Publish (upsert) a set of confirmed candidates to the team calendar.
export async function publishCompanyEvents(teamId, userId, candidates) {
  if (!teamId || !userId || !Array.isArray(candidates) || !candidates.length) {
    return { error: null, count: 0 };
  }
  // Dedupe by (ical_uid) within the batch — Postgres rejects an ON CONFLICT
  // upsert that would touch the same conflict target twice, which happens when
  // two selected candidates map to the same key. Last one wins.
  const byKey = new Map();
  for (const c of candidates) {
    if (!c?.icalUid || !c?.start) continue;
    byKey.set(c.icalUid, {
      team_id: teamId,
      ical_uid: c.icalUid,
      title: c.title || "(busy)",
      starts_at: new Date(c.start).toISOString(),
      ends_at: c.end ? new Date(c.end).toISOString() : null,
      all_day: !!c.allDay,
      location: c.location || null,
      html_link: c.htmlLink || null,
      organizer_email: c.organizerEmail || null,
      google_event_id: c.googleEventId || null,
      payload: c,
      published_by: userId,
      updated_at: new Date().toISOString(),
    });
  }
  const rows = [...byKey.values()];
  if (!rows.length) return { error: null, count: 0 };
  const { error } = await supabase
    .from("google_company_events")
    .upsert(rows, { onConflict: "team_id,ical_uid" });
  if (error) console.warn("publishCompanyEvents:", error.message);
  return { error, count: rows.length };
}

// Team company events that START within [startIso, endIso) — the shared calendar
// source everyone sees.
export async function loadCompanyEvents(teamId, startIso, endIso) {
  if (!teamId) return [];
  const { data, error } = await supabase
    .from("google_company_events")
    .select("ical_uid,title,starts_at,ends_at,all_day,location,html_link,organizer_email,payload,published_by")
    .eq("team_id", teamId)
    .gte("starts_at", startIso)
    .lt("starts_at", endIso);
  if (error) { console.warn("loadCompanyEvents:", error.message); return []; }
  return data || [];
}

// Which candidate iCalUIDs in a window are already shared — so the review list
// can badge them instead of offering to publish again.
// Returns { uids: Set<string>, publisherMap: Map<ical_uid, published_by> } so
// callers can both detect published events and check who owns each one.
export async function loadPublishedIcalUids(teamId, startIso, endIso) {
  if (!teamId) return { uids: new Set(), publisherMap: new Map() };
  const { data, error } = await supabase
    .from("google_company_events")
    .select("ical_uid, published_by")
    .eq("team_id", teamId)
    .gte("starts_at", startIso)
    .lt("starts_at", endIso);
  if (error) {
    console.warn("loadPublishedIcalUids:", error.message);
    return { uids: new Set(), publisherMap: new Map() };
  }
  const uids = new Set((data || []).map((r) => r.ical_uid));
  const publisherMap = new Map((data || []).map((r) => [r.ical_uid, r.published_by]));
  return { uids, publisherMap };
}

// The team's next few shared company events (for the office "Upcoming meetings"
// widget). Mirrors listUpcomingMeetings' 30-min grace so an in-progress one
// still shows. These are external Google events — no room to join.
export async function listUpcomingCompanyEvents(teamId, limit = 6) {
  if (!teamId) return { data: [] };
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("google_company_events")
    .select("ical_uid, title, starts_at, ends_at, location, html_link, organizer_email, payload")
    .eq("team_id", teamId)
    .gte("starts_at", since)
    .order("starts_at", { ascending: true })
    .limit(limit);
  if (error) { console.warn("listUpcomingCompanyEvents:", error.message); return { data: [] }; }
  return { data: data || [] };
}

// All shared occurrences of the series a given occurrence belongs to (recurring
// events share one iCalUID prefix). Used by the remove-one/all/selection dialog.
export async function loadCompanySeries(teamId, icalUid) {
  if (!teamId || !icalUid) return [];
  const base = seriesBaseOf(icalUid);
  const { data, error } = await supabase
    .from("google_company_events")
    .select("ical_uid, title, starts_at, all_day")
    .eq("team_id", teamId)
    .like("ical_uid", `${base}::%`)
    .order("starts_at", { ascending: true });
  if (error) { console.warn("loadCompanySeries:", error.message); return []; }
  return data || [];
}

// Pull a shared company event back off the team calendar.
export async function unpublishCompanyEvent(teamId, icalUid) {
  if (!teamId || !icalUid) return { error: null };
  const { error } = await supabase
    .from("google_company_events")
    .delete()
    .eq("team_id", teamId)
    .eq("ical_uid", icalUid);
  if (error) console.warn("unpublishCompanyEvent:", error.message);
  return { error };
}

// Remove a set of occurrences at once (all-in-series, or a hand-picked selection).
export async function unpublishCompanyEventsByKeys(teamId, keys) {
  if (!teamId || !Array.isArray(keys) || !keys.length) return { error: null };
  const { error } = await supabase
    .from("google_company_events")
    .delete()
    .eq("team_id", teamId)
    .in("ical_uid", keys);
  if (error) console.warn("unpublishCompanyEventsByKeys:", error.message);
  return { error };
}
