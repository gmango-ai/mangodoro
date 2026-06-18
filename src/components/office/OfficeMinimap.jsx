import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../context/ThemeContext";
import { Hash, Briefcase, MessageSquare, Lock } from "lucide-react";

const COLUMNS = 12;
const GAP = 4;
const PRESENCE_DOT = {
  active: "bg-emerald-500",
  available: "bg-sky-500",
  heads_down: "bg-violet-500",
  in_meeting: "bg-rose-500",
  away: "bg-amber-500",
};

const KIND_ICON = {
  general: Hash,
  department: Briefcase,
  meeting: MessageSquare,
  private: Lock,
};

// Compressed read-only floor plan. Shares the 12-column / square-cell
// model with OfficeLayoutEditor so the spatial layout matches the
// admin's edit view exactly — just rendered at sidebar density. Each
// tile shows: accent fill, kind glyph, occupant dots, and (for the
// currently-selected room) an accent ring.
//
// Empty rooms render as soft tinted shapes so the floor plan still
// reads as a "place" rather than an empty diagram.
export default function OfficeMinimap({
  rooms, sessionByRoomId, selectedRoomId, onSelect, lockedRoomIds,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const gridRef = useRef(null);
  const [cellWidth, setCellWidth] = useState(20);

  useEffect(() => {
    if (!gridRef.current) return;
    const el = gridRef.current;
    const update = () => {
      const w = el.clientWidth;
      setCellWidth((w - GAP * (COLUMNS - 1)) / COLUMNS);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cellHeight = cellWidth;

  // Need at least 1 row past the last placed tile so the grid doesn't
  // collapse on a sparse layout.
  const totalRows = (() => {
    let max = 1;
    for (const r of rooms || []) {
      max = Math.max(max, (r.layout_y || 0) + (r.layout_h || 2));
    }
    return Math.max(3, max);
  })();

  const containerHeight = totalRows * cellHeight + (totalRows - 1) * GAP;

  return (
    <div
      ref={gridRef}
      className="relative w-full"
      style={{
        height: containerHeight,
        display: "grid",
        gridTemplateColumns: `repeat(${COLUMNS}, 1fr)`,
        gridAutoRows: `${cellHeight}px`,
        gap: `${GAP}px`,
      }}
    >
      {(rooms || []).map((room) => {
        const active = sessionByRoomId?.get(room.id) || null;
        const occupants = active?.occupants || [];
        const isSelected = room.id === selectedRoomId;
        const accent = room.color || "#14b8a6";
        const Icon = KIND_ICON[room.kind] || Hash;
        const x = (room.layout_x || 0) + 1;
        const y = (room.layout_y || 0) + 1;
        const w = room.layout_w || 4;
        const h = room.layout_h || 2;
        const locked = lockedRoomIds?.has?.(room.id) || false;

        // Tile interior: subtle accent wash, tiny icon, occupant dots
        // when present. Selected room gets a 2px accent ring; occupied
        // rooms get a soft accent border so a glance reads the office.
        return (
          <button
            key={room.id}
            type="button"
            onClick={() => { if (!locked) onSelect?.(room.id); }}
            disabled={locked}
            title={
              locked
                ? `${room.name} — locked`
                : `${room.name}${active ? ` · ${occupants.length} here` : ""}`
            }
            style={{
              gridColumn: `${x} / span ${w}`,
              gridRow: `${y} / span ${h}`,
              background: `linear-gradient(135deg, ${accent}22, ${accent}10)`,
              borderColor: isSelected ? accent : (active ? `${accent}80` : "transparent"),
            }}
            className={`relative rounded-md border-2 transition-all overflow-hidden flex flex-col items-center justify-center gap-1 ${
              locked
                ? "opacity-50 cursor-not-allowed"
                : isSelected ? "shadow-md" : "hover:brightness-110"
            }`}
          >
            <Icon
              className="w-3 h-3 opacity-70"
              style={{ color: accent }}
            />
            {occupants.length > 0 && (
              <div className="flex items-center justify-center gap-0.5 flex-wrap max-w-full px-1">
                {occupants.slice(0, 5).map((o) => (
                  <span
                    key={o.user_id}
                    className={`w-1 h-1 rounded-full ${PRESENCE_DOT[o.presence_state] || "bg-emerald-500"}`}
                  />
                ))}
                {occupants.length > 5 && (
                  <span className={`text-[7px] font-bold leading-none ${dark ? "text-slate-300" : "text-slate-600"}`}>
                    +{occupants.length - 5}
                  </span>
                )}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
