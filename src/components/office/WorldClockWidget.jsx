import { useCallback, useEffect, useState } from "react";
import { Globe, Plus, X, Settings2, GripVertical } from "lucide-react";
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors,
  useDraggable, useDroppable,
} from "@dnd-kit/core";
import { useTeam } from "../../context/TeamContext";
import { localTimeLabel, tzAbbrev } from "../../lib/timezone";
import { getWorldClockLocations, saveWorldClockLocations, blankLocation } from "../../lib/worldClock";
import { ClockRow, CityTimezonePicker } from "../worldclock/clockShared";
import WidgetSection from "./WidgetSection";

// World clock — an admin-curated set of "where we operate" locations with the
// current local time in each. Org-level config (teams.world_clock_locations);
// admins edit it via the cog → modal, everyone sees it. The time rows + city
// picker are shared with the nav dropdown (../worldclock/clockShared).

export default function WorldClockWidget({ dark, bare = false }) {
  const { activeTeamId, isAdmin } = useTeam();
  const [locations, setLocations] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  // Tick so the displayed times stay fresh. The widget body only mounts when the
  // section is expanded (WidgetSection renders children lazily), so this interval
  // doesn't run while collapsed.
  const [, setTick] = useState(0);

  const reload = useCallback(async () => {
    if (!activeTeamId) { setLocations([]); setLoaded(true); return; }
    const { data } = await getWorldClockLocations(activeTeamId);
    setLocations(data);
    setLoaded(true);
  }, [activeTeamId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => (n + 1) % 1e9), 30000);
    return () => clearInterval(id);
  }, []);

  const action = isAdmin ? (
    <button
      type="button"
      onClick={() => setEditorOpen(true)}
      aria-label="Edit world clock locations"
      title="Edit locations"
      className={`p-1 rounded transition-colors ${
        dark ? "text-slate-500 hover:text-slate-200 hover:bg-white/5" : "text-slate-400 hover:text-slate-600 hover:bg-slate-200/60"
      }`}
    >
      <Settings2 className="w-3.5 h-3.5" />
    </button>
  ) : null;

  return (
    <WidgetSection id="world-clock" icon={Globe} title="World Clock" dark={dark} action={action} bare={bare}>
      {locations.length > 0 ? (
        <ul className="-my-0.5 divide-y divide-transparent">
          {locations.map((loc) => <ClockRow key={loc.id} loc={loc} dark={dark} />)}
        </ul>
      ) : (
        <div className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
          {!loaded ? (
            "Loading…"
          ) : isAdmin ? (
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              className="inline-flex items-center gap-1.5 font-medium text-[var(--color-accent)] hover:underline"
            >
              <Plus className="w-3.5 h-3.5" />
              Add the places your team operates
            </button>
          ) : (
            "An admin hasn't added any locations yet."
          )}
        </div>
      )}

      {editorOpen && (
        <WorldClockEditor
          dark={dark}
          initial={locations}
          onClose={() => setEditorOpen(false)}
          onSave={async (next) => {
            const { data, error } = await saveWorldClockLocations(activeTeamId, next);
            if (error) return error.message || "Could not save";
            setLocations(data);
            setEditorOpen(false);
            return null;
          }}
        />
      )}
    </WidgetSection>
  );
}

// Admin editor — add/remove locations (label + IANA timezone via a datalist
// combobox) and save. A fixed overlay so it escapes the narrow sidebar column.
function WorldClockEditor({ dark, initial, onClose, onSave }) {
  const [rows, setRows] = useState(() => (initial.length ? initial.map((l) => ({ ...l })) : [blankLocation()]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const setRow = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id) => setRows((rs) => rs.filter((r) => r.id !== id));
  const addRow = () => setRows((rs) => [...rs, blankLocation()]);

  // Drag a row's grip to reorder the locations; the saved order is the array
  // order (persisted as-is to teams.world_clock_locations). 5px activation so a
  // click on the handle doesn't count as a drag, and only the handle carries the
  // listeners — the label input stays fully editable.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    setRows((rs) => {
      const from = rs.findIndex((r) => r.id === active.id);
      const to = rs.findIndex((r) => r.id === over.id);
      if (from === -1 || to === -1) return rs;
      const next = rs.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  // Picking a city sets its timezone, and fills the label with the city name
  // when the admin hasn't typed their own (so "London" is one step, but a custom
  // "HQ — London" is preserved).
  const onPickCity = (row, { city, tz }) =>
    setRow(row.id, { tz, ...(row.label.trim() ? {} : { label: city }) });

  const save = async () => {
    setSaving(true);
    setError(null);
    const msg = await onSave(rows);
    setSaving(false);
    if (msg) setError(msg);
  };

  const fieldCls = dark
    ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500"
    : "bg-white border-slate-300 text-slate-800 placeholder:text-slate-400";

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="World clock locations">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={`relative w-full max-w-md rounded-2xl border shadow-2xl ${
        dark ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-100" : "bg-white border-slate-200 text-slate-800"
      }`}>
        <div className={`flex items-center justify-between px-4 py-3 border-b ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[var(--color-accent)]" />
            <h2 className="text-sm font-semibold">Where we operate</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={`p-1 rounded hover:bg-black/10 ${dark ? "hover:bg-white/10" : ""}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 max-h-[55vh] overflow-y-auto space-y-2">
          {rows.length > 1 && (
            <p className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
              Drag <GripVertical className="inline w-3 h-3 -mt-0.5" /> to reorder.
            </p>
          )}
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className="space-y-2">
              {rows.map((row) => (
                <SortableClockRow key={row.id} id={row.id} dark={dark} draggable={rows.length > 1}>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={row.label}
                      onChange={(e) => setRow(row.id, { label: e.target.value })}
                      placeholder="Label (e.g. HQ — London)"
                      className={`flex-1 min-w-0 rounded-md border px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-[var(--color-accent)] ${fieldCls}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      aria-label="Remove location"
                      className={`p-1 rounded shrink-0 ${dark ? "text-slate-500 hover:text-rose-400 hover:bg-white/5" : "text-slate-400 hover:text-rose-500 hover:bg-slate-100"}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <CityTimezonePicker tz={row.tz} dark={dark} fieldCls={fieldCls} onPick={(sel) => onPickCity(row, sel)} />
                  {row.tz && (
                    <div className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
                      {[row.tz, tzAbbrev(row.tz), localTimeLabel(row.tz)].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </SortableClockRow>
              ))}
            </div>
          </DndContext>
          <button
            type="button"
            onClick={addRow}
            className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${dark ? "text-slate-300 hover:text-white" : "text-slate-600 hover:text-slate-900"}`}
          >
            <Plus className="w-3.5 h-3.5" /> Add location
          </button>
        </div>

        {error && <p className="px-4 text-[11px] text-rose-500">{error}</p>}

        <div className={`flex items-center justify-end gap-2 px-4 py-3 border-t ${dark ? "border-[var(--color-border)]" : "border-slate-200"}`}>
          <button
            type="button"
            onClick={onClose}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium ${dark ? "text-slate-300 hover:bg-white/5" : "text-slate-600 hover:bg-slate-100"}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// One location row in the editor — a drop target + drag source (same node),
// with the grip as the only drag handle so the label input stays editable.
function SortableClockRow({ id, dark, draggable, children }) {
  const drag = useDraggable({ id });
  const drop = useDroppable({ id });
  const setRef = (el) => { drag.setNodeRef(el); drop.setNodeRef(el); };
  const style = drag.transform
    ? {
        transform: `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)`,
        zIndex: drag.isDragging ? 20 : "auto",
        opacity: drag.isDragging ? 0.95 : 1,
      }
    : undefined;
  return (
    <div
      ref={setRef}
      style={style}
      className={`rounded-lg border p-2 flex gap-1.5 ${
        dark ? "border-[var(--color-border)]" : "border-slate-200"
      } ${drop.isOver && !drag.isDragging ? "outline outline-2 outline-[var(--color-accent)]" : ""}`}
    >
      {draggable && (
        <button
          type="button"
          {...drag.listeners}
          {...drag.attributes}
          aria-label="Drag to reorder"
          title="Drag to reorder"
          className={`shrink-0 self-stretch flex items-center px-0.5 rounded cursor-grab active:cursor-grabbing touch-none ${
            dark ? "text-slate-500 hover:text-slate-300 hover:bg-white/5" : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          }`}
        >
          <GripVertical className="w-4 h-4" />
        </button>
      )}
      <div className="flex-1 min-w-0 space-y-2">{children}</div>
    </div>
  );
}

