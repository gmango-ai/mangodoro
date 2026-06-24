import { useEffect, useRef, useState } from "react";
import { MapPin, Check } from "lucide-react";
import { useTeam } from "../../context/TeamContext";
import { setGoalRooms } from "../../lib/goals";
import Popover from "./Popover";

// Per-goal room scoping. A goal with no rooms picked is global (shows in every
// room); pick rooms to restrict where it surfaces. Saves on each toggle and
// calls onSaved so the parent can refresh its scope map.
export default function GoalRoomsButton({ goalId, scopedRoomIds = [], onSaved, dark }) {
  const { visibleRooms = [] } = useTeam();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(() => new Set(scopedRoomIds));
  const anchorRef = useRef(null);

  const key = scopedRoomIds.join(",");
  useEffect(() => { setSel(new Set(scopedRoomIds)); }, [key]); // resync when parent reloads

  const scoped = sel.size > 0;
  const toggle = async (id) => {
    const next = new Set(sel);
    next.has(id) ? next.delete(id) : next.add(id);
    setSel(next);
    await setGoalRooms({ goalId, roomIds: [...next] });
    onSaved?.();
  };

  return (
    <span className="relative shrink-0">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={scoped ? `Shown in ${sel.size} room${sel.size === 1 ? "" : "s"}` : "Shown in every room"}
        aria-label="Scope to rooms"
        className={`mt-0.5 flex items-center gap-0.5 transition-colors ${
          scoped ? "text-[var(--color-accent)]" : dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"
        }`}
      >
        <MapPin className="w-3.5 h-3.5" />
        {scoped && <span className="text-[10px] font-semibold leading-none">{sel.size}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={176} dark={dark}>
        <p className={`px-2 py-1 text-[10px] uppercase tracking-wide ${dark ? "text-slate-500" : "text-slate-400"}`}>Show in rooms</p>
        {visibleRooms.length === 0 && (
          <p className={`px-2 py-1.5 text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>No rooms yet.</p>
        )}
        {visibleRooms.map((r) => {
          const on = sel.has(r.id);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => toggle(r.id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs ${dark ? "hover:bg-white/5 text-slate-200" : "hover:bg-slate-50 text-slate-700"}`}
            >
              <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                on ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-white" : dark ? "border-slate-500" : "border-slate-300"
              }`}>
                {on && <Check className="w-2.5 h-2.5" />}
              </span>
              <span className="truncate">{r.name}</span>
            </button>
          );
        })}
        {scoped && (
          <p className={`px-2 pt-1 text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>Uncheck all to show everywhere.</p>
        )}
      </Popover>
    </span>
  );
}
