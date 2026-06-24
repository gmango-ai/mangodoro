import { useCallback, useEffect, useState } from "react";
import { Plus, Check, X, Target, Building2, Pin, PinOff } from "lucide-react";
import { useTeam } from "../../context/TeamContext";
import { listTeamGoals, listGoalRooms, createGoal, updateGoal, deleteGoal, horizonShort } from "../../lib/goals";
import GoalHorizonSelect from "../goals/GoalHorizonSelect";
import GoalRoomsButton from "../goals/GoalRoomsButton";

// Org goals on the Team page. A top-level **Company** goal (the team itself)
// plus a section per **department** (org_team), each with active/done goals and
// a time horizon. Admins manage the company goal + any department; a
// department's leads manage their own. Org goals are visible to everyone.
export default function TeamGoals({ dark }) {
  const { orgTeams = [], activeTeam, activeTeamId, isAdmin, myOrgTeamLeadIds } = useTeam();
  const [goals, setGoals] = useState([]);
  const [drafts, setDrafts] = useState({}); // ownerId → draft body
  const [horizons, setHorizons] = useState({}); // ownerId → add-row horizon
  const [roomMap, setRoomMap] = useState({}); // goalId → [roomId]

  const load = useCallback(async () => {
    if (!activeTeamId) { setGoals([]); setRoomMap({}); return; }
    const [{ data }, { data: rooms }] = await Promise.all([
      listTeamGoals(activeTeamId),
      listGoalRooms(activeTeamId),
    ]);
    setGoals((data || []).filter((g) => g.owner_type === "company" || g.owner_type === "department"));
    const map = {};
    for (const row of rooms || []) (map[row.goal_id] ||= []).push(row.room_id);
    setRoomMap(map);
  }, [activeTeamId]);
  useEffect(() => { load(); }, [load]);

  if (!orgTeams.length && !activeTeam) return null;

  const surface = dark ? "var(--color-surface)" : "#fff";
  const border = dark ? "var(--color-border)" : "rgb(226,232,240)";

  const add = async (ownerType, owner) => {
    const body = (drafts[owner.id] || "").trim();
    if (!body) return;
    setDrafts((d) => ({ ...d, [owner.id]: "" }));
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

  // One owner's goal list + (when permitted) the add-row.
  const section = (ownerType, owner, manage) => {
    const own = goals.filter((g) => g.owner_type === ownerType && g.owner_id === owner.id);
    const ordered = [...own.filter((g) => g.status !== "done"), ...own.filter((g) => g.status === "done")];
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
          {ordered.map((g) => (
            <li key={g.id} className="flex items-start gap-2 group">
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
              <span className={`text-sm flex-1 break-words ${g.status === "done" ? "line-through opacity-60" : g.pinned === false ? "opacity-50" : ""} ${dark ? "text-slate-200" : "text-slate-700"}`}>{g.body}</span>
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
                <button type="button" onClick={() => remove(g)} aria-label="Delete goal" className={`opacity-0 group-hover:opacity-100 shrink-0 ${dark ? "text-slate-500 hover:text-red-300" : "text-slate-400 hover:text-red-500"}`}>
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {manage && (
          <div className="flex items-center gap-2 mt-1.5">
            <input
              value={drafts[owner.id] || ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [owner.id]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") add(ownerType, owner); }}
              placeholder={ownerType === "company" ? "Add a company goal…" : `Add a goal for ${owner.name}…`}
              className={`flex-1 text-sm px-2.5 py-1.5 rounded-lg border outline-none ${
                dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500" : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
              }`}
            />
            <GoalHorizonSelect value={horizons[owner.id] || "none"} onChange={(h) => setHorizons((s) => ({ ...s, [owner.id]: h }))} dark={dark} />
            <button
              type="button"
              onClick={() => add(ownerType, owner)}
              disabled={!(drafts[owner.id] || "").trim()}
              aria-label="Add goal"
              className="shrink-0 w-8 h-8 rounded-lg bg-[var(--color-accent)] text-white flex items-center justify-center disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        )}
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
