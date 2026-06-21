import { supabase } from "../supabase";

// ─── Templates ─────────────────────────────────────────────────────
//
// Each template returns the initial xyflow `{ nodes, edges }` payload.
// The whiteboard's snapshot column stores exactly this shape, plus the
// goal text on the row itself. Keep TEMPLATES in lockstep with the SQL
// check constraint on whiteboards.template_key.

// Built-in templates were removed in favour of user-saved templates (see
// whiteboard_templates + the functions below). `blank` stays as the implicit
// default: a board with no seeded snapshot is just an empty canvas.
export const TEMPLATES = {
  blank: { key: "blank", name: "Blank board", desc: "A clean infinite canvas", build: () => ({ nodes: [], edges: [] }) },
};

export const TEMPLATE_LIST = Object.values(TEMPLATES);

// Empty store check — used so we never overwrite a board that has work
// in it with a fresh template seed.
export function isEmptySnapshot(snap) {
  if (!snap) return true;
  const n = Array.isArray(snap.nodes) ? snap.nodes : [];
  const e = Array.isArray(snap.edges) ? snap.edges : [];
  return n.length === 0 && e.length === 0;
}

export function templateSnapshotFor(templateKey) {
  const tpl = TEMPLATES[templateKey] || TEMPLATES.blank;
  return tpl.build();
}

// Strip volatile per-session state before persisting a snapshot (as a template
// or a board seed) so saved templates don't carry selection/drag flags.
export function cleanSnapshot(snap) {
  const nodes = (Array.isArray(snap?.nodes) ? snap.nodes : []).map(
    ({ selected, dragging, resizing, ...rest }) => rest
  );
  const edges = (Array.isArray(snap?.edges) ? snap.edges : []).map(
    ({ selected, ...rest }) => rest
  );
  return { nodes, edges };
}

// ─── User templates (personal / org) ───────────────────────────────

// Personal templates (yours) + org templates for the active team. RLS already
// scopes visibility; we narrow org rows to the active team.
export async function listWhiteboardTemplates(teamId) {
  let q = supabase
    .from("whiteboard_templates")
    .select("id, name, scope, owner_id, team_id, created_at")
    .order("created_at", { ascending: false });
  q = teamId ? q.or(`scope.eq.personal,team_id.eq.${teamId}`) : q.eq("scope", "personal");
  const { data, error } = await q;
  return { data: data || [], error };
}

export async function fetchTemplateSnapshot(templateId) {
  if (!templateId) return { data: null, error: null };
  const { data, error } = await supabase
    .from("whiteboard_templates")
    .select("snapshot")
    .eq("id", templateId)
    .maybeSingle();
  return { data: data?.snapshot || null, error };
}

export async function saveWhiteboardTemplate({ name, scope, ownerId, teamId, snapshot }) {
  const trimmed = (name || "").trim() || "Untitled template";
  if (trimmed.length > 80) return { error: { message: "Name too long (max 80 chars)." } };
  const org = scope === "org";
  if (org && !teamId) return { error: { message: "Pick a team for an org template." } };
  const { data, error } = await supabase
    .from("whiteboard_templates")
    .insert({
      name: trimmed,
      scope: org ? "org" : "personal",
      owner_id: ownerId,
      team_id: org ? teamId : null,
      snapshot: cleanSnapshot(snapshot),
    })
    .select()
    .single();
  return { data, error };
}

export async function deleteWhiteboardTemplate(id) {
  const { error } = await supabase.from("whiteboard_templates").delete().eq("id", id);
  return { error };
}

// ─── CRUD ──────────────────────────────────────────────────────────

export async function listTeamWhiteboards(teamId, { includeArchived = false } = {}) {
  if (!teamId) return { data: [], error: null };
  let q = supabase
    .from("whiteboards")
    .select("id, team_id, title, template_key, goal, created_by, created_at, updated_at, archived_at")
    .eq("team_id", teamId)
    .order("updated_at", { ascending: false });
  if (!includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q;
  return { data: data || [], error };
}

export async function fetchWhiteboardById(whiteboardId) {
  if (!whiteboardId) return { data: null, error: null };
  const { data, error } = await supabase
    .from("whiteboards")
    .select("*")
    .eq("id", whiteboardId)
    .maybeSingle();
  return { data, error };
}

export async function createWhiteboard({ teamId, title, createdBy, snapshot }) {
  const trimmedTitle = (title || "").trim() || "Untitled whiteboard";
  if (trimmedTitle.length > 120) return { error: { message: "Title too long (max 120 chars)." } };
  const row = {
    team_id: teamId,
    title: trimmedTitle,
    template_key: "blank",
    created_by: createdBy,
  };
  // Seed from a saved template's snapshot when one was chosen.
  if (snapshot && !isEmptySnapshot(snapshot)) row.snapshot = cleanSnapshot(snapshot);
  const { data, error } = await supabase
    .from("whiteboards")
    .insert(row)
    .select()
    .single();
  return { data, error };
}

// Snapshot is the xyflow `{ nodes, edges }` payload. We save whole and
// re-load whole — fine for the size we expect (retro boards land well
// under 200KB; complex flowcharts at a few hundred). If real-time
// diffs land in Phase 2 we keep this as the snapshot-of-record and
// layer ops on top.
export async function saveSnapshot(whiteboardId, snapshot) {
  if (!whiteboardId) return { error: { message: "Missing whiteboardId." } };
  const { error } = await supabase
    .from("whiteboards")
    .update({ snapshot })
    .eq("id", whiteboardId);
  return { error };
}

export async function setWhiteboardGoal(whiteboardId, goal) {
  const { error } = await supabase
    .from("whiteboards")
    .update({ goal: (goal ?? "").trim() })
    .eq("id", whiteboardId);
  return { error };
}

export async function setWhiteboardTitle(whiteboardId, title) {
  const trimmed = (title || "").trim() || "Untitled whiteboard";
  if (trimmed.length > 120) return { error: { message: "Title too long (max 120 chars)." } };
  const { error } = await supabase
    .from("whiteboards")
    .update({ title: trimmed })
    .eq("id", whiteboardId);
  return { error };
}

export async function archiveWhiteboard(whiteboardId) {
  const { error } = await supabase
    .from("whiteboards")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", whiteboardId);
  return { error };
}

export async function unarchiveWhiteboard(whiteboardId) {
  const { error } = await supabase
    .from("whiteboards")
    .update({ archived_at: null })
    .eq("id", whiteboardId);
  return { error };
}

export async function deleteWhiteboard(whiteboardId) {
  const { error } = await supabase
    .from("whiteboards")
    .delete()
    .eq("id", whiteboardId);
  return { error };
}
