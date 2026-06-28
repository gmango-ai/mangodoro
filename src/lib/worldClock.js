import { supabase } from "../supabase";

// Org-curated world-clock locations live on teams.world_clock_locations as a
// jsonb array of { id, label, tz } (tz = IANA zone). Members read it (the office
// widget); admins edit it (teams UPDATE is admin-only by RLS, enforced
// server-side regardless of the client gate).
//
// These helpers fetch/save the column DIRECTLY rather than threading it through
// TeamContext's loadTeams(): keeping it off that hot path means the app still
// loads even if this migration hasn't been applied yet — a missing column only
// fails this isolated fetch (→ the widget shows empty), not the whole team load.

// "America/New_York" → "New York" (last path segment, underscores → spaces).
export function cityFromZone(tz) {
  if (!tz) return "";
  const seg = String(tz).split("/").pop() || String(tz);
  return seg.replace(/_/g, " ");
}

function newId() {
  try { return crypto.randomUUID(); } catch { return `loc_${Math.random().toString(36).slice(2)}`; }
}

// Coerce stored/edited rows into a clean [{ id, label, tz }] — drop anything
// without a timezone, fill a missing label from the zone, ensure a stable id.
export function normalizeLocations(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l) => l && typeof l.tz === "string" && l.tz.trim())
    .map((l) => ({
      id: l.id ? String(l.id) : newId(),
      label: String(l.label || "").trim() || cityFromZone(l.tz),
      tz: l.tz.trim(),
    }));
}

// A blank editor row, seeded with an optional zone.
export function blankLocation(tz = "") {
  return { id: newId(), label: tz ? cityFromZone(tz) : "", tz };
}

export async function getWorldClockLocations(teamId) {
  if (!teamId) return { data: [], error: null };
  const { data, error } = await supabase
    .from("teams")
    .select("world_clock_locations")
    .eq("id", teamId)
    .single();
  if (error) return { data: [], error };
  return { data: normalizeLocations(data?.world_clock_locations), error: null };
}

export async function saveWorldClockLocations(teamId, locations) {
  if (!teamId) return { data: [], error: { message: "No active team" } };
  const clean = normalizeLocations(locations);
  const { error } = await supabase
    .from("teams")
    .update({ world_clock_locations: clean })
    .eq("id", teamId);
  return { data: clean, error };
}
