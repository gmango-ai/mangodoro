import { useCallback, useEffect, useState } from "react";
import { Plus, Check, X, Target, Building2, Pin, PinOff, Pencil, ChevronUp, ChevronDown } from "lucide-react";
import { useTeam } from "../../context/TeamContext";
import { listTeamGoals, listGoalRooms, listGoalKeyResults, createGoal, updateGoal, deleteGoal, reorderGoals, horizonShort } from "../../lib/goals";
import GoalHorizonSelect from "../goals/GoalHorizonSelect";
import GoalRoomsButton from "../goals/GoalRoomsButton";
import GoalProgress from "../goals/GoalProgress";
import MarkdownText from "../MarkdownText";
import MarkdownEditor from "../MarkdownEditor";

// Org goals on the Team page. A top-level **Company** goal (the team itself)
// plus a section per **department** (org_team), each with active/done goals and
// a time horizon. Admins manage the company goal + any department; a
// department's leads manage their own. Org goals are visible to everyone.
export default function TeamGoals({ dark }) {
  const { orgTeams = [], activeTeam, activeTeamId, isAdmin, myOrgTeamLeadIds } = useTeam();
  const [goals, setGoals] = useState([]);
  const [drafts, setDrafts] = useState({}); // ownerId → draft body
  const [horizons, setHorizons] = useState({}); // ownerId → add-row horizon
  const [addingId, setAddingId] = useState(null); // owner.id whose add-editor is open
  const [editingId, setEditingId] = useState(null); // goal.id being edited
  const [editDraft, setEditDraft] = useState("");
  const [roomMap, setRoomMap] = useState({}); // goalId → [roomId]
  const [krMap, setKrMap] = useState({}); // goalId → [keyResult]

  const load = useCallback(async () => {
    if (!activeTeamId) { setGoals([]); setRoomMap({}); setKrMap({}); return; }
    const [{ data }, { data: rooms }, { data: krs }] = await Promise.all([
      listTeamGoals(activeTeamId),
      listGoalRooms(activeTeamId),
      listGoalKeyResults(activeTeamId),
    ]);
    setGoals((data || []).filter((g) => g.owner_type === "company" || g.owner_type === "department"));
    const map = {};
    for (const row of rooms || []) (map[row.goal_id] ||= []).push(row.room_id);
    setRoomMap(map);
    const km = {};
    for (const kr of krs || []) (km[kr.goal_id] ||= []).push(kr);
    setKrMap(km);
  }, [activeTeamId]);
  useEffect(() => { load(); }, [load]);

  if (!orgTeams.length && !activeTeam) return null;

  const surface = dark ? "var(--color-surface)" : "#fff";
  const border = dark ? "var(--color-border)" : "rgb(226,232,240)";

  const add = async (ownerType, owner) => {
    const body = (drafts[owner.id] || "").trim();
    if (!body) return;
    setDrafts((d) => ({ ...d, [owner.id]: "" }));
    setAddingId(null);
    await createGoal({
      teamId: activeTeamId, ownerType, ownerId: owner.id,
      ownerName: owner.name, ownerColor: owner.color || null, body,
      horizon: horizons[owner.id] || "none",
    });
    load();
  };
  const toggle = async (g) => { await updateGoal({ id: g.id, status: g.status === "done" ? "active" : "done" }); load(); };
  const remove = async (g) => { await deleteGoal(g.id); load(); };
  const changeHorizon = async (g, h) => { await updateGoal({ id: g.id, horizon: h }); load(); };
  const togglePin = async (g) => { await updateGoal({ id: g.id, pinned: g.pinned === false }); load(); };
  const moveGoal = async (ownerType, ownerId, g, dir) => {
    const own = goals.filter((x) => x.owner_type === ownerType && x.owner_id === ownerId);
    const act = own.filter((x) => x.status !== "done");
    const dn = own.filter((x) => x.status === "done");
    const i = act.findIndex((x) => x.id === g.id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= act.length) return;
    const next = [...act];
    [next[i], next[j]] = [next[j], next[i]];
    await reorderGoals([...next.map((x) => x.id), ...dn.map((x) => x.id)]);
    load();
  };
  const startEdit = (g) => { setEditingId(g.id); setEditDraft(g.body || ""); };
  const saveEdit = async () => {
    const body = editDraft.trim();
    if (!body) { setEditingId(null); return; }
    const id = editingId;
    setEditingId(null);
    await updateGoal({ id, body });
    load();
  };

  // One owner's goal list + (when permitted) the add-row.
  const section = (ownerType, owner, manage) => {
    const own = goals.filter((g) => g.owner_type === ownerType && g.owner_id === owner.id);
    const ownActive = own.filter((g) => g.status !== "done");
    const ordered = [...ownActive, ...own.filter((g) => g.status === "done")];
    return (
      <div key={`${ownerType}:${owner.id}`}>
        <div className="flex items-center gap-1.5 mb-1.5">
          {ownerType === "company" ? (
            <Building2 className="w-3.5 h-3.5 text-[var(--color-accent)]" />
          ) : (
            <span className="w-2 h-2 rounded-full" style={{ background: owner.color || "#64748b" }} />
          )}
          <span className={`text-[13px] font-semibold ${dark ? "text-slate-200" : "text-slate-700"}`}>{owner.name}</span>
        </div>
        {ordered.length === 0 && <p className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>No goals yet.</p>}
        <ul className="flex flex-col gap-1.5">
          {ordered.map((g) => {
            const aIdx = g.status === "done" ? -1 : ownActive.findIndex((x) => x.id === g.id);
            return (
            <li key={g.id} className="group">
              {editingId === g.id ? (
                <div>
                  <MarkdownEditor value={editDraft} onChange={setEditDraft} dark={dark} autoFocus minHeight="64px" placeholder="Edit goal…" />
                  <div className="flex items-center justify-end gap-2 mt-1.5">
                    <button type="button" onClick={() => setEditingId(null)} className={`text-xs px-2 py-1 rounded-md ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}>Cancel</button>
                    <button type="button" onClick={saveEdit} disabled={!editDraft.trim()} className="text-sm px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-white disabled:opacity-40">Save</button>
                  </div>
                </div>
              ) : (
              <>
              <div className="flex items-start gap-2">
              {manage && aIdx >= 0 && (
                <span className="shrink-0 mt-0.5 flex flex-col -my-0.5 opacity-0 group-hover:opacity-100">
                  <button type="button" onClick={() => moveGoal(ownerType, owner.id, g, "up")} disabled={aIdx === 0} aria-label="Move up" className={`leading-none disabled:opacity-30 ${dark ? "text-slate-500 hover:text-slate-200" : "text-slate-400 hover:text-slate-700"}`}>
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <button type="button" onClick={() => moveGoal(ownerType, owner.id, g, "down")} disabled={aIdx === ownActive.length - 1} aria-label="Move down" className={`leading-none disabled:opacity-30 ${dark ? "text-slate-500 hover:text-slate-200" : "text-slate-400 hover:text-slate-700"}`}>
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </span>
              )}
              <button
                type="button"
                disabled={!manage}
                onClick={() => toggle(g)}
                title={g.status === "done" ? "Mark active" : "Mark done"}
                className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                  g.status === "done" ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-white" : dark ? "border-slate-500" : "border-slate-300"
                } ${manage ? "cursor-pointer" : "cursor-default"}`}
              >
                {g.status === "done" && <Check className="w-3 h-3" />}
              </button>
              <div className={`text-sm flex-1 min-w-0 break-words ${g.status === "done" ? "line-through opacity-60" : g.pinned === false ? "opacity-50" : ""} ${dark ? "text-slate-200" : "text-slate-700"}`}>
                <MarkdownText dark={dark} compact>{g.body}</MarkdownText>
              </div>
              {manage ? (
                <GoalHorizonSelect value={g.horizon} onChange={(h) => changeHorizon(g, h)} dark={dark} />
              ) : (
                g.horizon && g.horizon !== "none" && (
                  <span className={`shrink-0 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full ${dark ? "bg-slate-700 text-slate-300" : "bg-slate-100 text-slate-500"}`}>
                    {horizonShort(g.horizon)}
                  </span>
                )
              )}
              {manage && (
                <button
                  type="button"
                  onClick={() => togglePin(g)}
                  title={g.pinned === false ? "Backgrounded — won't show on the office board" : "Pinned — shows on the office board"}
                  aria-label={g.pinned === false ? "Pin goal" : "Background goal"}
                  className={`shrink-0 mt-0.5 transition-colors ${
                    g.pinned === false ? (dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600") : "text-[var(--color-accent)]"
                  }`}
                >
                  {g.pinned === false ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                </button>
              )}
              {manage && (
                <GoalRoomsButton goalId={g.id} scopedRoomIds={roomMap[g.id] || []} onSaved={load} dark={dark} />
              )}
              {manage && (
                <button type="button" onClick={() => startEdit(g)} aria-label="Edit goal" className={`opacity-0 group-hover:opacity-100 shrink-0 mt-0.5 transition-colors ${dark ? "text-slate-500 hover:text-slate-200" : "text-slate-400 hover:text-slate-700"}`}>
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
              {manage && (
                <button type="button" onClick={() => remove(g)} aria-label="Delete goal" className={`opacity-0 group-hover:opacity-100 shrink-0 ${dark ? "text-slate-500 hover:text-red-300" : "text-slate-400 hover:text-red-500"}`}>
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              </div>
              <GoalProgress goal={g} krs={krMap[g.id] || []} manage={manage} onChange={load} dark={dark} />
              </>
              )}
            </li>
          );
          })}
        </ul>
        {manage && (addingId === owner.id ? (
          <div className="mt-1.5">
            <MarkdownEditor
              value={drafts[owner.id] || ""}
              onChange={(v) => setDrafts((d) => ({ ...d, [owner.id]: v }))}
              dark={dark}
              placeholder={ownerType === "company" ? "Add a company goal…" : `Add a goal for ${owner.name}…`}
              minHeight="64px"
              autoFocus
            />
            <div className="flex items-center justify-between gap-2 mt-1.5">
              <span className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>Markdown supported</span>
              <div className="flex items-center gap-2">
                <GoalHorizonSelect value={horizons[owner.id] || "none"} onChange={(h) => setHorizons((s) => ({ ...s, [owner.id]: h }))} dark={dark} />
                <button type="button" onClick={() => { setAddingId(null); setDrafts((d) => ({ ...d, [owner.id]: "" })); }} className={`text-xs px-2 py-1 rounded-md ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}>
                  Cancel
                </button>
                <button type="button" onClick={() => add(ownerType, owner)} disabled={!(drafts[owner.id] || "").trim()} className="text-sm px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-white disabled:opacity-40">
                  Add goal
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setAddingId(owner.id)} className={`mt-1.5 flex items-center gap-1.5 text-sm ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}>
            <Plus className="w-4 h-4" /> {ownerType === "company" ? "Add a company goal" : "Add a goal"}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="rounded-2xl border p-4" style={{ background: surface, borderColor: border }}>
      <div className="flex items-center gap-2 mb-3">
        <Target className="w-4 h-4 text-[var(--color-accent)]" />
        <span className={`text-sm font-bold ${dark ? "text-slate-200" : "text-slate-700"}`}>Organization goals</span>
      </div>
      <div className="flex flex-col gap-4">
        {activeTeam && section("company", { id: activeTeamId, name: activeTeam.name, color: activeTeam.color }, isAdmin)}
        {orgTeams.map((dept) => section("department", dept, isAdmin || !!myOrgTeamLeadIds?.has(dept.id)))}
      </div>
    </div>
  );
}
