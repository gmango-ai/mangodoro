import { supabase } from "../supabase";

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
    .select("ical_uid,title,starts_at,ends_at,all_day,location,html_link,organizer_email")
    .eq("team_id", teamId)
    .gte("starts_at", startIso)
    .lt("starts_at", endIso);
  if (error) { console.warn("loadCompanyEvents:", error.message); return []; }
  return data || [];
}

// Which candidate iCalUIDs in a window are already shared — so the review list
// can badge them instead of offering to publish again.
export async function loadPublishedIcalUids(teamId, startIso, endIso) {
  if (!teamId) return new Set();
  const { data, error } = await supabase
    .from("google_company_events")
    .select("ical_uid")
    .eq("team_id", teamId)
    .gte("starts_at", startIso)
    .lt("starts_at", endIso);
  if (error) { console.warn("loadPublishedIcalUids:", error.message); return new Set(); }
  return new Set((data || []).map((r) => r.ical_uid));
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
