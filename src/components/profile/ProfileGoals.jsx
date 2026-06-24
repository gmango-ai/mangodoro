import { useCallback, useEffect, useState } from "react";
import { Plus, Check, X, Target, Lock, Globe, Pin, PinOff, Pencil, ChevronUp, ChevronDown } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useTeam } from "../../context/TeamContext";
import { useTheme } from "../../context/ThemeContext";
import { listTeamGoals, listGoalRooms, listGoalKeyResults, createGoal, updateGoal, deleteGoal, reorderGoals, horizonShort } from "../../lib/goals";
import GoalHorizonSelect from "../goals/GoalHorizonSelect";
import GoalRoomsButton from "../goals/GoalRoomsButton";
import GoalProgress from "../goals/GoalProgress";
import GoalMoveMenu from "../goals/GoalMoveMenu";
import MarkdownText from "../MarkdownText";
import MarkdownEditor from "../MarkdownEditor";
import { ArrowUpFromLine } from "lucide-react";

// A person's goals (team-scoped to the active team). Editable when it's you —
// add, check off (active/done), remove; read-only for teammates. Used on the
// profile page.
export default function ProfileGoals({ userId }) {
  const { session, settings } = useApp();
  const { activeTeamId, activeTeam, orgTeams = [], isAdmin, myOrgTeamIds } = useTeam();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const isMe = !!userId && session?.user?.id === userId;
  // Where a personal goal can be elevated: teams you're on + the company (admins).
  const elevateTargets = [
    ...(isAdmin && activeTeam ? [{ ownerType: "company", ownerId: activeTeamId, ownerName: activeTeam.name, ownerColor: activeTeam.color, label: `${activeTeam.name} · company` }] : []),
    ...orgTeams.filter((d) => myOrgTeamIds?.has(d.id)).map((d) => ({ ownerType: "department", ownerId: d.id, ownerName: d.name, ownerColor: d.color, label: d.name })),
  ];
  const [goals, setGoals] = useState([]);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [addHorizon, setAddHorizon] = useState("none");
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [roomMap, setRoomMap] = useState({}); // goalId → [roomId]
  const [krMap, setKrMap] = useState({}); // goalId → [keyResult]

  const load = useCallback(async () => {
    if (!activeTeamId || !userId) { setGoals([]); setRoomMap({}); setKrMap({}); return; }
    const [{ data }, { data: rooms }, { data: krs }] = await Promise.all([
      listTeamGoals(activeTeamId),
      listGoalRooms(activeTeamId),
      listGoalKeyResults(activeTeamId),
    ]);
    setGoals((data || []).filter((g) => g.owner_type === "user" && g.owner_id === userId));
    const map = {};
    for (const row of rooms || []) (map[row.goal_id] ||= []).push(row.room_id);
    setRoomMap(map);
    const km = {};
    for (const kr of krs || []) (km[kr.goal_id] ||= []).push(kr);
    setKrMap(km);
  }, [activeTeamId, userId]);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const body = draft.trim();
    if (!body || !isMe) return;
    setDraft(""); setAdding(false);
    await createGoal({ teamId: activeTeamId, ownerType: "user", ownerId: userId, ownerName: settings?.name || "", body, horizon: addHorizon });
    load();
  };
  const changeHorizon = async (g, h) => { if (!isMe) return; await updateGoal({ id: g.id, horizon: h }); load(); };
  const togglePin = async (g) => { if (!isMe) return; await updateGoal({ id: g.id, pinned: g.pinned === false }); load(); };
  const moveGoal = async (g, dir) => {
    if (!isMe) return;
    const act = goals.filter((x) => x.status !== "done");
    const dn = goals.filter((x) => x.status === "done");
    const i = act.findIndex((x) => x.id === g.id);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= act.length) return;
    const next = [...act];
    [next[i], next[j]] = [next[j], next[i]];
    setGoals([...next, ...dn]); // optimistic
    await reorderGoals([...next.map((x) => x.id), ...dn.map((x) => x.id)]);
    load();
  };
  const startEdit = (g) => { if (!isMe) return; setEditingId(g.id); setEditDraft(g.body || ""); };
  const saveEdit = async () => {
    const body = editDraft.trim();
    if (!body) { setEditingId(null); return; }
    const id = editingId;
    setEditingId(null);
    await updateGoal({ id, body });
    load();
  };
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
        {ordered.map((g) => {
          const aIdx = g.status === "done" ? -1 : active.findIndex((x) => x.id === g.id);
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
            {isMe && aIdx >= 0 && (
              <span className="shrink-0 mt-0.5 flex flex-col -my-0.5 opacity-0 group-hover:opacity-100">
                <button type="button" onClick={() => moveGoal(g, "up")} disabled={aIdx === 0} aria-label="Move up" className={`leading-none disabled:opacity-30 ${dark ? "text-slate-500 hover:text-slate-200" : "text-slate-400 hover:text-slate-700"}`}>
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button type="button" onClick={() => moveGoal(g, "down")} disabled={aIdx === active.length - 1} aria-label="Move down" className={`leading-none disabled:opacity-30 ${dark ? "text-slate-500 hover:text-slate-200" : "text-slate-400 hover:text-slate-700"}`}>
                  <ChevronDown className="w-3 h-3" />
                </button>
              </span>
            )}
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
            <div className={`text-sm flex-1 min-w-0 break-words ${g.status === "done" ? "line-through opacity-60" : g.pinned === false ? "opacity-50" : ""} ${dark ? "text-slate-200" : "text-slate-700"}`}>
              <MarkdownText dark={dark} compact>{g.body}</MarkdownText>
            </div>
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
            {isMe && (
              <GoalRoomsButton goalId={g.id} scopedRoomIds={roomMap[g.id] || []} onSaved={load} dark={dark} />
            )}
            {isMe && elevateTargets.length > 0 && (
              <GoalMoveMenu goal={g} targets={elevateTargets} onMoved={load} dark={dark} title="Elevate to team goal" icon={ArrowUpFromLine} />
            )}
            {isMe && (
              <button
                type="button"
                onClick={() => startEdit(g)}
                aria-label="Edit goal"
                className={`opacity-0 group-hover:opacity-100 shrink-0 mt-0.5 transition-colors ${dark ? "text-slate-500 hover:text-slate-200" : "text-slate-400 hover:text-slate-700"}`}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
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
            </div>
            <GoalProgress goal={g} krs={krMap[g.id] || []} manage={isMe} onChange={load} dark={dark} />
            </>
            )}
          </li>
        );
        })}
      </ul>

      {isMe && (adding ? (
        <div className="mt-2.5">
          <MarkdownEditor value={draft} onChange={setDraft} dark={dark} placeholder="Add a goal…" minHeight="64px" autoFocus />
          <div className="flex items-center justify-between gap-2 mt-1.5">
            <span className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>Markdown supported</span>
            <div className="flex items-center gap-2">
              <GoalHorizonSelect value={addHorizon} onChange={setAddHorizon} dark={dark} />
              <button type="button" onClick={() => { setAdding(false); setDraft(""); }} className={`text-xs px-2 py-1 rounded-md ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}>
                Cancel
              </button>
              <button type="button" onClick={add} disabled={!draft.trim()} className="text-sm px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-white disabled:opacity-40">
                Add goal
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={`mt-2.5 flex items-center gap-1.5 text-sm ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}>
          <Plus className="w-4 h-4" /> Add a goal
        </button>
      ))}
    </div>
  );
}
