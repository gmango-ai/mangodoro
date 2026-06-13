import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Users, Pencil, Trash2, X, Check } from "lucide-react";
import {
  createOrgTeam, renameOrgTeam, archiveOrgTeam, setOrgTeamColor,
} from "../lib/orgTeam";

const PALETTE = [
  "#14b8a6", "#0ea5e9", "#6366f1", "#8b5cf6",
  "#ec4899", "#f43f5e", "#f59e0b", "#84cc16",
];

// Admin-only card on /team (Org page) for managing the org's teams
// (SWE, PM, HR, ...). Each row shows name, color, member count, and
// an "Manage members" button that opens a member-picker modal handled
// by the parent.
export default function OrgTeamsCard({
  dark, cardCls, labelCls, inputCls,
  teams, memberCountByTeamId, userId, orgId, onError, onSuccess, onManageMembers,
}) {
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState(PALETTE[0]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // org_team_id being inline-renamed

  async function handleAdd() {
    if (!draftName.trim()) return;
    setBusy(true);
    const { error } = await createOrgTeam(orgId, {
      name: draftName,
      color: draftColor,
      userId,
    });
    setBusy(false);
    if (error) { onError?.(error.message || "Could not create team."); return; }
    setDraftName("");
    setDraftColor(PALETTE[0]);
    setAdding(false);
    onSuccess?.("Team created");
  }

  async function handleRename(team, name) {
    const trimmed = (name || "").trim();
    if (!trimmed || trimmed === team.name) { setEditing(null); return; }
    const { error } = await renameOrgTeam(team.id, trimmed);
    if (error) { onError?.(error.message || "Could not rename team."); return; }
    setEditing(null);
    onSuccess?.("Team renamed");
  }

  async function handleArchive(team) {
    const ok = window.confirm(`Archive "${team.name}"? Members lose access to its rooms and retros.`);
    if (!ok) return;
    const { error } = await archiveOrgTeam(team.id);
    if (error) { onError?.(error.message || "Could not archive team."); return; }
    onSuccess?.("Team archived");
  }

  async function handleColor(team, hex) {
    const { error } = await setOrgTeamColor(team.id, hex);
    if (error) onError?.(error.message || "Could not save color.");
  }

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className={`w-4 h-4 ${dark ? "text-cyan-400" : "text-teal-600"}`} />
          <p className={labelCls}>Teams</p>
        </div>
        {!adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="w-3.5 h-3.5 mr-1" /> New team
          </Button>
        )}
      </div>

      <p className={`text-[11px] mb-3 ${dark ? "text-slate-500" : "text-slate-400"}`}>
        SWE, PM, HR, etc. Members of a team see its retros and rooms; non-members don't.
      </p>

      {/* Add form */}
      {adding && (
        <div className={`mb-3 rounded-lg border p-3 ${
          dark ? "bg-slate-800/40 border-slate-700/60" : "bg-slate-50 border-slate-200"
        }`}>
          <div className="flex gap-2 mb-2">
            <Input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value.slice(0, 30))}
              placeholder="e.g. SWE, PM, HR"
              className={`flex-1 ${inputCls}`}
            />
            <Button size="sm" onClick={handleAdd} disabled={!draftName.trim() || busy}>
              {busy ? "…" : "Create"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setAdding(false); setDraftName(""); }}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setDraftColor(c)}
                className={`w-6 h-6 rounded-md border-2 ${
                  draftColor === c
                    ? (dark ? "border-white" : "border-slate-900")
                    : "border-transparent"
                }`}
                style={{ background: c }}
                aria-label={c}
              />
            ))}
          </div>
        </div>
      )}

      {/* Existing teams */}
      {teams.length === 0 && !adding ? (
        <p className={`text-xs italic ${dark ? "text-slate-500" : "text-slate-400"}`}>
          No teams yet — add SWE, PM, HR or whatever fits your org.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {teams.map((t) => {
            const count = memberCountByTeamId.get(t.id) || 0;
            const isEditing = editing === t.id;
            return (
              <li
                key={t.id}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-lg ${
                  dark ? "bg-slate-800/40" : "bg-slate-50"
                }`}
              >
                {/* Color swatch (click cycles palette) */}
                <button
                  type="button"
                  onClick={() => {
                    const idx = PALETTE.indexOf(t.color);
                    const next = PALETTE[(idx + 1) % PALETTE.length];
                    handleColor(t, next);
                  }}
                  className="w-4 h-4 rounded-md shrink-0 border border-black/10"
                  style={{ background: t.color }}
                  title="Cycle color"
                />
                {/* Name (inline-editable) */}
                {isEditing ? (
                  <InlineRename
                    defaultName={t.name}
                    inputCls={inputCls}
                    onSubmit={(name) => handleRename(t, name)}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <span className={`text-sm font-semibold flex-1 truncate ${
                    dark ? "text-slate-100" : "text-slate-800"
                  }`}>
                    {t.name}
                  </span>
                )}
                <span className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
                  {count} {count === 1 ? "member" : "members"}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onManageMembers?.(t)}
                  className="h-7 text-xs"
                >
                  Members
                </Button>
                {!isEditing && (
                  <button
                    type="button"
                    onClick={() => setEditing(t.id)}
                    title="Rename"
                    className={`p-1 rounded ${dark ? "text-slate-400 hover:bg-slate-700/60" : "text-slate-500 hover:bg-slate-200"}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleArchive(t)}
                  title="Archive"
                  className={`p-1 rounded ${dark ? "text-slate-400 hover:text-red-300 hover:bg-red-500/15" : "text-slate-500 hover:text-red-600 hover:bg-red-50"}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function InlineRename({ defaultName, inputCls, onSubmit, onCancel }) {
  const [name, setName] = useState(defaultName);
  return (
    <form
      className="flex-1 flex gap-1"
      onSubmit={(e) => { e.preventDefault(); onSubmit(name); }}
    >
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 30))}
        className={`h-7 text-sm ${inputCls}`}
      />
      <Button size="sm" type="submit" className="h-7 px-2">
        <Check className="w-3.5 h-3.5" />
      </Button>
      <Button size="sm" variant="outline" type="button" onClick={onCancel} className="h-7 px-2">
        <X className="w-3.5 h-3.5" />
      </Button>
    </form>
  );
}
