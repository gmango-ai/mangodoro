import { useCallback, useEffect, useState } from "react";
import { Plus, Check, X, Target } from "lucide-react";
import { useTeam } from "../../context/TeamContext";
import { listTeamGoals, createGoal, updateGoal, deleteGoal } from "../../lib/goals";

// Org / department goals on the Team page. Lists each department (org_team)
// with its goals (active/done); admins and that department's leads can add /
// check off / remove. Department goals are org-visible (everyone sees them).
export default function TeamGoals({ dark }) {
  const { orgTeams = [], activeTeamId, isAdmin, myOrgTeamLeadIds } = useTeam();
  const [goals, setGoals] = useState([]);
  const [drafts, setDrafts] = useState({}); // deptId → draft

  const load = useCallback(async () => {
    if (!activeTeamId) { setGoals([]); return; }
    const { data } = await listTeamGoals(activeTeamId);
    setGoals((data || []).filter((g) => g.owner_type === "department"));
  }, [activeTeamId]);
  useEffect(() => { load(); }, [load]);

  if (!orgTeams.length) return null;

  const canManage = (deptId) => isAdmin || !!myOrgTeamLeadIds?.has(deptId);
  const surface = dark ? "var(--color-surface)" : "#fff";
  const border = dark ? "var(--color-border)" : "rgb(226,232,240)";

  const add = async (dept) => {
    const body = (drafts[dept.id] || "").trim();
    if (!body) return;
    setDrafts((d) => ({ ...d, [dept.id]: "" }));
    await createGoal({ teamId: activeTeamId, ownerType: "department", ownerId: dept.id, ownerName: dept.name, ownerColor: dept.color || null, body });
    load();
  };
  const toggle = async (g) => { await updateGoal({ id: g.id, status: g.status === "done" ? "active" : "done" }); load(); };
  const remove = async (g) => { await deleteGoal(g.id); load(); };

  return (
    <div className="rounded-2xl border p-4" style={{ background: surface, borderColor: border }}>
      <div className="flex items-center gap-2 mb-3">
        <Target className="w-4 h-4 text-[var(--color-accent)]" />
        <span className={`text-sm font-bold ${dark ? "text-slate-200" : "text-slate-700"}`}>Department goals</span>
      </div>
      <div className="flex flex-col gap-4">
        {orgTeams.map((dept) => {
          const dgoals = goals.filter((g) => g.owner_id === dept.id);
          const ordered = [...dgoals.filter((g) => g.status !== "done"), ...dgoals.filter((g) => g.status === "done")];
          const manage = canManage(dept.id);
          return (
            <div key={dept.id}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: dept.color || "#64748b" }} />
                <span className={`text-[13px] font-semibold ${dark ? "text-slate-200" : "text-slate-700"}`}>{dept.name}</span>
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
                    <span className={`text-sm flex-1 break-words ${g.status === "done" ? "line-through opacity-60" : ""} ${dark ? "text-slate-200" : "text-slate-700"}`}>{g.body}</span>
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
                    value={drafts[dept.id] || ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [dept.id]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") add(dept); }}
                    placeholder={`Add a goal for ${dept.name}…`}
                    className={`flex-1 text-sm px-2.5 py-1.5 rounded-lg border outline-none ${
                      dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500" : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => add(dept)}
                    disabled={!(drafts[dept.id] || "").trim()}
                    aria-label="Add goal"
                    className="shrink-0 w-8 h-8 rounded-lg bg-[var(--color-accent)] text-white flex items-center justify-center disabled:opacity-40"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
