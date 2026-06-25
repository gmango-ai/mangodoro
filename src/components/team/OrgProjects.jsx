import { useCallback, useEffect, useState } from "react";
import { Plus, X, FolderKanban } from "lucide-react";
import { useTeam } from "../../context/TeamContext";
import { listOrgProjects, createOrgProject, updateOrgProject, archiveOrgProject } from "../../lib/orgProjects";

// Org projects on the Team page — the shared list people pick from to say what
// they're working on (a stand-in until tasks connect). Admins curate; members
// see the list (read-only).
export default function OrgProjects({ dark }) {
  const { activeTeamId, isAdmin } = useTeam();
  const [projects, setProjects] = useState([]);
  const [draft, setDraft] = useState("");
  const [color, setColor] = useState("#14b8a6");

  const load = useCallback(async () => {
    if (!activeTeamId) { setProjects([]); return; }
    setProjects(await listOrgProjects(activeTeamId));
  }, [activeTeamId]);
  useEffect(() => { load(); }, [load]);

  if (!activeTeamId) return null;
  const surface = dark ? "var(--color-surface)" : "#fff";
  const border = dark ? "var(--color-border)" : "rgb(226,232,240)";

  const add = async () => {
    const name = draft.trim();
    if (!name) return;
    setDraft("");
    await createOrgProject({ teamId: activeTeamId, name, color });
    load();
  };
  const rename = async (p, name) => { if (name.trim() && name.trim() !== p.name) { await updateOrgProject(p.id, { name: name.trim() }); load(); } };
  const recolor = async (p, c) => { await updateOrgProject(p.id, { color: c }); load(); };
  const archive = async (p) => { await archiveOrgProject(p.id); load(); };

  return (
    <div className="rounded-2xl border p-4" style={{ background: surface, borderColor: border }}>
      <div className="flex items-center gap-2 mb-3">
        <FolderKanban className="w-4 h-4 text-[var(--color-accent)]" />
        <span className={`text-sm font-bold ${dark ? "text-slate-200" : "text-slate-700"}`}>Projects</span>
        <span className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>what people pick from when tracking time</span>
      </div>

      {projects.length === 0 && <p className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>No projects yet.</p>}

      <ul className="flex flex-col gap-1.5">
        {projects.map((p) => (
          <li key={p.id} className="flex items-center gap-2 group">
            <input
              type="color"
              value={p.color || "#14b8a6"}
              disabled={!isAdmin}
              onChange={(e) => recolor(p, e.target.value)}
              className="w-5 h-5 rounded shrink-0 cursor-pointer disabled:cursor-default bg-transparent border-0 p-0"
              aria-label="Project color"
            />
            {isAdmin ? (
              <input
                defaultValue={p.name}
                onBlur={(e) => rename(p, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                className={`flex-1 text-sm bg-transparent outline-none border-b border-transparent focus:border-[var(--color-accent)] ${dark ? "text-slate-200" : "text-slate-700"}`}
              />
            ) : (
              <span className={`flex-1 text-sm ${dark ? "text-slate-200" : "text-slate-700"}`}>{p.name}</span>
            )}
            {isAdmin && (
              <button type="button" onClick={() => archive(p)} aria-label="Archive project" className={`opacity-0 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100 shrink-0 ${dark ? "text-slate-500 hover:text-red-300" : "text-slate-400 hover:text-red-500"}`}>
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {isAdmin && (
        <div className="flex items-center gap-2 mt-2.5">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-7 h-7 rounded shrink-0 cursor-pointer bg-transparent border-0 p-0" aria-label="New project color" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            placeholder="Add a project…"
            className={`flex-1 text-sm px-2.5 py-1.5 rounded-lg border outline-none ${dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500" : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"}`}
          />
          <button type="button" onClick={add} disabled={!draft.trim()} aria-label="Add project" className="shrink-0 w-8 h-8 rounded-lg bg-[var(--color-accent)] text-white flex items-center justify-center disabled:opacity-40">
            <Plus className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
