import { supabase } from "../supabase";

// Meetings booked into a room, optionally mirrored to Google Calendar. RLS keeps
// reads/writes to the creator + their team (see 20260707120200_scheduled_meetings).

export async function listUpcomingMeetings(teamId, limit = 6) {
  // Include meetings that started up to 30 min ago so an in-progress one still shows.
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  return supabase
    .from("scheduled_meetings")
    .select("id, room_id, title, description, starts_at, ends_at, created_by, google_html_link, auto_record")
    .eq("team_id", teamId)
    .gte("starts_at", since)
    .order("starts_at", { ascending: true })
    .limit(limit);
}

export async function createScheduledMeeting(payload) {
  return supabase.from("scheduled_meetings").insert(payload).select().single();
}

export async function updateScheduledMeeting(id, patch) {
  return supabase.from("scheduled_meetings")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
}

export async function deleteScheduledMeeting(id) {
  return supabase.from("scheduled_meetings").delete().eq("id", id);
}
