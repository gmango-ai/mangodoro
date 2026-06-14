import { useState } from "react";
import { useApp } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";

const PRESET_COLORS = [
  "#14b8a6", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#64748b",
];

export default function ProjectPicker({ selectedIds = [], onChange }) {
  const { projects, addProjectQuick } = useApp();
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const containerCls = `flex flex-wrap gap-2 p-3 rounded-lg border ${dark ? "bg-[var(--color-surface)] border-[var(--color-border-light)]" : "bg-white/80 border-slate-200"}`;

  async function handleAdd() {
    if (!newName.trim()) return;
    setSaving(true);
    const project = await addProjectQuick(newName, newColor);
    setSaving(false);
    if (project) {
      onChange([...selectedIds, project.id]);
    }
    setNewName("");
    setNewColor(PRESET_COLORS[0]);
    setAdding(false);
  }

  function handleCancel() {
    setNewName("");
    setNewColor(PRESET_COLORS[0]);
    setAdding(false);
  }

  return (
    <div className={containerCls}>
      {projects.map((p) => {
        const selected = selectedIds.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(selected ? selectedIds.filter((id) => id !== p.id) : [...selectedIds, p.id])}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${selected ? "opacity-100" : "opacity-50 hover:opacity-75"}`}
            style={selected
              ? { backgroundColor: p.color + "22", color: p.color, borderColor: p.color + "66" }
              : { borderColor: dark ? "#475569" : "#e2e8f0", color: dark ? "#94a3b8" : "#64748b" }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color || "#14b8a6" }} />
            {p.name}{p.client_name ? ` · ${p.client_name}` : ""}
          </button>
        );
      })}

      {adding ? (
        <div className={`w-full mt-1 pt-2 border-t ${dark ? "border-[var(--color-border-light)]" : "border-slate-200"}`}>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setNewColor(c)}
                className="w-5 h-5 rounded-full transition-all"
                style={{
                  background: c,
                  outline: newColor === c ? `2px solid ${c}` : "none",
                  outlineOffset: "2px",
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: newColor }} />
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } if (e.key === "Escape") handleCancel(); }}
              placeholder="Project name"
              autoFocus
              className={`flex-1 text-xs px-2 py-1.5 rounded border outline-none focus:border-[var(--color-accent)] ${
                dark
                  ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-white placeholder:text-slate-500"
                  : "bg-white border-slate-300 text-slate-800 placeholder:text-slate-400"
              }`}
            />
            <button
              type="button"
              onClick={handleAdd}
              disabled={!newName.trim() || saving}
              className="text-xs px-2.5 py-1.5 rounded font-medium transition-all disabled:opacity-50 bg-[var(--color-accent-light)] text-[var(--color-accent)] hover:bg-[var(--color-accent-light-hover)]"
            >
              {saving ? "…" : "Add"}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className={`text-xs px-2 py-1.5 rounded font-medium transition-all ${
                dark ? "text-slate-400 hover:text-slate-300" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-dashed transition-all ${
            dark ? "border-slate-600 text-slate-500 hover:border-slate-500 hover:text-slate-400" : "border-slate-300 text-slate-400 hover:border-slate-400 hover:text-slate-600"
          }`}
        >
          + New
        </button>
      )}
    </div>
  );
}
