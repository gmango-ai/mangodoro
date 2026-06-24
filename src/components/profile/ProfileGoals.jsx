import { useCallback, useEffect, useState } from "react";
import { Plus, Check, X, Target, Lock, Globe } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useTeam } from "../../context/TeamContext";
import { useTheme } from "../../context/ThemeContext";
import { listTeamGoals, createGoal, updateGoal, deleteGoal, horizonShort } from "../../lib/goals";
import GoalHorizonSelect from "../goals/GoalHorizonSelect";

// A person's goals (team-scoped to the active team). Editable when it's you —
// add, check off (active/done), remove; read-only for teammates. Used on the
// profile page.
export default function ProfileGoals({ userId }) {
  const { session, settings } = useApp();
  const { activeTeamId } = useTeam();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const isMe = !!userId && session?.user?.id === userId;
  const [goals, setGoals] = useState([]);
  const [draft, setDraft] = useState("");
  const [addHorizon, setAddHorizon] = useState("none");

  const load = useCallback(async () => {
    if (!activeTeamId || !userId) { setGoals([]); return; }
    const { data } = await listTeamGoals(activeTeamId);
    setGoals((data || []).filter((g) => g.owner_type === "user" && g.owner_id === userId));
  }, [activeTeamId, userId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const body = draft.trim();
    if (!body || !isMe) return;
    setDraft("");
    await createGoal({ teamId: activeTeamId, ownerType: "user", ownerId: userId, ownerName: settings?.name || "", body, horizon: addHorizon });
    load();
  };
  const changeHorizon = async (g, h) => { if (!isMe) return; await updateGoal({ id: g.id, horizon: h }); load(); };
  const toggle = async (g) => {
    if (!isMe) return;
    await updateGoal({ id: g.id, status: g.status === "done" ? "active" : "done" });
    load();
  };
  const remove = async (g) => { if (!isMe) return; await deleteGoal(g.id); load(); };
  const togglePublic = async (g) => {
    if (!isMe) return;
    await updateGoal({ id: g.id, isPublic: !g.is_public });
    load();
  };

  if (!activeTeamId) return null;
  const active = goals.filter((g) => g.status !== "done");
  const done = goals.filter((g) => g.status === "done");
  const ordered = [...active, ...done];

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Target className="w-4 h-4 text-[var(--color-accent)]" />
        <span className={`text-sm font-bold ${dark ? "text-slate-200" : "text-slate-700"}`}>Goals</span>
      </div>
      {isMe && (
        <p className={`text-[11px] mb-2 ${dark ? "text-slate-500" : "text-slate-400"}`}>
          Private by default — tap the lock to share a goal with teammates.
        </p>
      )}

      {ordered.length === 0 && !isMe && (
        <p className={`text-sm ${dark ? "text-slate-500" : "text-slate-400"}`}>No goals yet.</p>
      )}

      <ul className="flex flex-col gap-1.5">
        {ordered.map((g) => (
          <li key={g.id} className="flex items-start gap-2 group">
            <button
              type="button"
              disabled={!isMe}
              onClick={() => toggle(g)}
              title={g.status === "done" ? "Mark active" : "Mark done"}
              className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                g.status === "done"
                  ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-white"
                  : dark ? "border-slate-500" : "border-slate-300"
              } ${isMe ? "cursor-pointer" : "cursor-default"}`}
            >
              {g.status === "done" && <Check className="w-3 h-3" />}
            </button>
            <span className={`text-sm flex-1 break-words ${g.status === "done" ? "line-through opacity-60" : ""} ${dark ? "text-slate-200" : "text-slate-700"}`}>
              {g.body}
            </span>
            {isMe ? (
              <GoalHorizonSelect value={g.horizon} onChange={(h) => changeHorizon(g, h)} dark={dark} />
            ) : (
              g.horizon && g.horizon !== "none" && (
                <span className={`shrink-0 mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full ${dark ? "bg-slate-700 text-slate-300" : "bg-slate-100 text-slate-500"}`}>
                  {horizonShort(g.horizon)}
                </span>
              )
            )}
            {isMe && (
              <button
                type="button"
                onClick={() => togglePublic(g)}
                title={g.is_public ? "Public — teammates can see this on your profile" : "Private — only you"}
                className={`shrink-0 transition-colors ${g.is_public ? "text-[var(--color-accent)]" : dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"}`}
                aria-label={g.is_public ? "Make private" : "Make public"}
              >
                {g.is_public ? <Globe className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
              </button>
            )}
            {isMe && (
              <button
                type="button"
                onClick={() => remove(g)}
                className={`opacity-0 group-hover:opacity-100 shrink-0 ${dark ? "text-slate-500 hover:text-red-300" : "text-slate-400 hover:text-red-500"}`}
                aria-label="Delete goal"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {isMe && (
        <div className="flex items-center gap-2 mt-2.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            placeholder="Add a goal…"
            className={`flex-1 text-sm px-2.5 py-1.5 rounded-lg border outline-none ${
              dark ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500" : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
            }`}
          />
          <GoalHorizonSelect value={addHorizon} onChange={setAddHorizon} dark={dark} />
          <button
            type="button"
            onClick={add}
            disabled={!draft.trim()}
            className="shrink-0 w-8 h-8 rounded-lg bg-[var(--color-accent)] text-white flex items-center justify-center disabled:opacity-40"
            aria-label="Add goal"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
