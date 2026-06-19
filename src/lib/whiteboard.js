import { supabase } from "../supabase";

// ─── Templates ─────────────────────────────────────────────────────
//
// Each template returns the initial xyflow `{ nodes, edges }` payload.
// The whiteboard's snapshot column stores exactly this shape, plus the
// goal text on the row itself. Keep TEMPLATES in lockstep with the SQL
// check constraint on whiteboards.template_key.

export const TEMPLATES = {
  blank: {
    key: "blank",
    name: "Blank board",
    desc: "A clean infinite canvas",
    hasGoal: false,
    build: () => ({ nodes: [], edges: [] }),
  },

  weekly_review: {
    key: "weekly_review",
    name: "Weekly Review",
    desc: "Celebrate · Went Well · Improve · Next",
    hasGoal: true,
    build: () => buildWeeklyReview(),
  },

  brainstorm: {
    key: "brainstorm",
    name: "Brainstorm",
    desc: "Diverge freely, then cluster",
    hasGoal: false,
    build: () => buildBrainstorm(),
  },

  retro: {
    key: "retro",
    name: "Retro",
    desc: "Celebrate · Went well · Improve · Actions",
    hasGoal: true,
    build: () => buildRetro(),
  },
};

export const TEMPLATE_LIST = Object.values(TEMPLATES);

const STICKY_COLOR_FOR_ZONE = {
  celebrate: "orange",
  went_well: "green",
  to_improve: "yellow",
  next_week: "blue",
  // Brainstorm column colors map to the same palette.
  ideas: "yellow",
  build_on: "blue",
  park_it: "slate",
};

function zoneNode(id, label, icon, tint, bg, border, x, y, w = 380, h = 600) {
  return {
    id: `zone-${id}`,
    type: "zone",
    position: { x, y },
    width: w, height: h,
    data: { label, icon, tint, bg, border },
    draggable: false,
    selectable: false,
    deletable: false,
    connectable: false,
    // zIndex via xyflow's zIndex prop puts zones behind every other
    // node so stickies / shapes float on top visually.
    zIndex: -1,
  };
}

function stickyNode(id, text, x, y, color = "yellow") {
  return {
    id, type: "sticky",
    position: { x, y },
    data: { text, color },
  };
}

function buildWeeklyReview() {
  const ZONES = [
    { id: "celebrate",  label: "Celebrate",         icon: "🎉", tint: "#d97706", bg: "#fef3c7", border: "#fcd34d" },
    { id: "went_well",  label: "What went well",    icon: "👍", tint: "#059669", bg: "#d1fae5", border: "#6ee7b7" },
    { id: "to_improve", label: "Needs improvement", icon: "🔧", tint: "#b45309", bg: "#fef9c3", border: "#fde047" },
    { id: "next_week",  label: "Next week",         icon: "🚀", tint: "#1d4ed8", bg: "#dbeafe", border: "#93c5fd" },
  ];
  const GAP = 60;
  const W = 380;
  const nodes = [];
  ZONES.forEach((z, i) => {
    const x = 60 + i * (W + GAP);
    nodes.push(zoneNode(z.id, z.label, z.icon, z.tint, z.bg, z.border, x, 60, W, 600));
    // One seed sticky per zone so the user can see the structure
    // working before they write anything. They delete or write over it.
    nodes.push(stickyNode(
      `seed-${z.id}`,
      "Drop a sticky here…",
      x + (W - 160) / 2,
      60 + 100,
      STICKY_COLOR_FOR_ZONE[z.id],
    ));
  });
  return { nodes, edges: [] };
}

function buildBrainstorm() {
  const ZONES = [
    { id: "ideas",    label: "Ideas",    icon: "💡", tint: "#d97706", bg: "#fef3c7", border: "#fcd34d" },
    { id: "build_on", label: "Build on", icon: "🧱", tint: "#1d4ed8", bg: "#dbeafe", border: "#93c5fd" },
    { id: "park_it",  label: "Park it",  icon: "⚓", tint: "#475569", bg: "#f1f5f9", border: "#cbd5e1" },
  ];
  const GAP = 60;
  const W = 480;
  const nodes = [];
  ZONES.forEach((z, i) => {
    const x = 60 + i * (W + GAP);
    nodes.push(zoneNode(z.id, z.label, z.icon, z.tint, z.bg, z.border, x, 60, W, 620));
  });
  // A seed prompt sticky so the empty board reads less broken.
  nodes.push(stickyNode("seed-prompt", "What's the question?", 60, 700, "yellow"));
  return { nodes, edges: [] };
}

// A resizable, editable container (the new "frame" node) — used by the
// retro template for its lanes. Unlike the fixed `zone`, users can move,
// resize, and rename these.
function frameNode(id, label, icon, tint, bg, x, y, w, h) {
  return {
    id: `frame-${id}`,
    type: "frame",
    position: { x, y },
    width: w, height: h,
    data: { text: label, icon, tint, bg },
    zIndex: -1,
  };
}

function buildRetro() {
  const LANES = [
    { id: "celebrate",  label: "Celebrate",    icon: "🎉", tint: "#d97706", bg: "rgba(217,119,6,.07)" },
    { id: "went_well",  label: "Went well",    icon: "👍", tint: "#059669", bg: "rgba(5,150,105,.07)" },
    { id: "to_improve", label: "To improve",   icon: "🔧", tint: "#b45309", bg: "rgba(180,83,9,.07)" },
    { id: "next_week",  label: "Action items", icon: "🚀", tint: "#1d4ed8", bg: "rgba(29,78,216,.07)" },
  ];
  const GAP = 40, W = 320, H = 560;
  const nodes = [];
  LANES.forEach((z, i) => {
    const x = 40 + i * (W + GAP);
    nodes.push(frameNode(z.id, z.label, z.icon, z.tint, z.bg, x, 60, W, H));
    // Seed sticky as a CHILD of the frame (position relative) so it moves
    // with the lane.
    nodes.push({
      ...stickyNode(`seed-${z.id}`, "Add a card…", (W - 160) / 2, 80, STICKY_COLOR_FOR_ZONE[z.id]),
      parentId: `frame-${z.id}`,
      extent: "parent",
    });
  });
  return { nodes, edges: [] };
}

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

export async function createWhiteboard({ teamId, title, templateKey, createdBy }) {
  const trimmedTitle = (title || "").trim() || "Untitled whiteboard";
  if (trimmedTitle.length > 120) return { error: { message: "Title too long (max 120 chars)." } };
  const tpl = TEMPLATES[templateKey] || TEMPLATES.blank;
  const { data, error } = await supabase
    .from("whiteboards")
    .insert({
      team_id: teamId,
      title: trimmedTitle,
      template_key: tpl.key,
      created_by: createdBy,
    })
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
