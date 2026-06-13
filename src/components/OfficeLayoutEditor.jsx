import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useTheme } from "../context/ThemeContext";
import RoomTile from "./RoomTile";
import { updateRoomLayout } from "../lib/rooms";
import { GripVertical } from "lucide-react";

// Editable floor plan for rooms.
//
// Layout model: a 12-column CSS grid with fixed-height rows. Every room
// carries (layout_x, layout_y, layout_w, layout_h). x is the leftmost
// column (0..11), y is the row (0..N), w/h are spans.
//
// Drag uses @dnd-kit's PointerSensor with a small activation distance
// so single-clicks still pass through to the underlying RoomTile. On
// drag end we snap the delta to the nearest cell and persist via
// update_room_layout RPC.
//
// Resize is a separate pointer handler on a bottom-right grip — same
// snap-to-cell math, persisted on pointerup. We update local optimistic
// state during the drag so the tile reflects the move immediately,
// then the realtime channel reconciles when the server confirms.
//
// readOnly disables both interactions but keeps the same grid layout
// so non-admin viewers see the floor plan exactly as admins do.

const COLUMNS = 12;
// Tuned for the default 3×2 tile (12 cols → ~25% width per tile, two
// rows tall). Bigger ROW_HEIGHT gives the avatar strip + Start button
// real vertical breathing room.
const ROW_HEIGHT = 96;
const GAP = 10;

export default function OfficeLayoutEditor({
  rooms,
  readOnly,
  vibe,
  busy,
  onJoinRoom,
  sessionByRoomId,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";

  const gridRef = useRef(null);
  const [cellWidth, setCellWidth] = useState(80);

  // Optimistic overrides so a drag/resize feels instant before the
  // RPC round-trip + realtime echo land.
  const [overrides, setOverrides] = useState({}); // roomId -> {x, y, w, h}
  const applyOverride = useCallback((room) => {
    const o = overrides[room.id];
    return o ? { ...room, layout_x: o.x, layout_y: o.y, layout_w: o.w, layout_h: o.h } : room;
  }, [overrides]);

  // Compute cell width from container size so the snap math is honest.
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Without an activation distance, even a single click would be
      // interpreted as a drag and swallow the Join button click.
      activationConstraint: { distance: 6 },
    }),
  );

  const totalRowsNeeded = useMemo(() => {
    let max = 1;
    for (const r of rooms || []) {
      const o = applyOverride(r);
      max = Math.max(max, o.layout_y + o.layout_h);
    }
    return Math.max(4, max + 1); // always leave one empty row at the bottom
  }, [rooms, applyOverride]);

  async function persistLayout(roomId, x, y, w, h) {
    setOverrides((prev) => ({ ...prev, [roomId]: { x, y, w, h } }));
    const { error } = await updateRoomLayout(roomId, { x, y, w, h });
    if (error) {
      // Roll back the override on failure so the grid snaps back to
      // the server's view rather than silently lying to the user.
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[roomId];
        return next;
      });
      // eslint-disable-next-line no-console
      console.warn("Layout save failed:", error.message);
    } else {
      // Once the server has it, realtime will re-fetch and the override
      // becomes redundant. Clear it so we don't accumulate stale state.
      setTimeout(() => {
        setOverrides((prev) => {
          const next = { ...prev };
          delete next[roomId];
          return next;
        });
      }, 1500);
    }
  }

  function handleDragEnd(event) {
    const { active, delta } = event;
    const room = (rooms || []).find((r) => r.id === active.id);
    if (!room) return;
    const o = applyOverride(room);
    const dx = Math.round(delta.x / (cellWidth + GAP));
    const dy = Math.round(delta.y / (ROW_HEIGHT + GAP));
    if (dx === 0 && dy === 0) return;
    const x = Math.max(0, Math.min(COLUMNS - o.layout_w, o.layout_x + dx));
    const y = Math.max(0, o.layout_y + dy);
    persistLayout(room.id, x, y, o.layout_w, o.layout_h);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div
        ref={gridRef}
        className={`relative rounded-xl border p-2 ${
          dark ? "bg-slate-900/40 border-slate-700/60" : "bg-slate-50 border-slate-200"
        }`}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
          gridAutoRows: `${ROW_HEIGHT}px`,
          gap: `${GAP}px`,
        }}
      >
        {/* Grid backdrop: faint cells so empty space reads as "the floor"
            rather than a vague blob. */}
        {!readOnly && (
          <GridBackdrop columns={COLUMNS} rows={totalRowsNeeded} dark={dark} />
        )}

        {(rooms || []).map((room) => {
          const r = applyOverride(room);
          return (
            <LayoutTile
              key={room.id}
              room={r}
              readOnly={readOnly}
              cellWidth={cellWidth}
              rowHeight={ROW_HEIGHT}
              gap={GAP}
              vibe={vibe}
              busy={busy}
              activeSession={sessionByRoomId?.get(room.id) || null}
              onJoinRoom={onJoinRoom}
              onResize={(w, h) => persistLayout(room.id, r.layout_x, r.layout_y, w, h)}
            />
          );
        })}
      </div>
    </DndContext>
  );
}

function GridBackdrop({ columns, rows, dark }) {
  const cells = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      cells.push(
        <span
          key={`${x}-${y}`}
          style={{ gridColumn: `${x + 1}`, gridRow: `${y + 1}` }}
          className={`rounded ${dark ? "bg-slate-800/30" : "bg-white/60"}`}
        />,
      );
    }
  }
  return <>{cells}</>;
}

function LayoutTile({
  room, readOnly, cellWidth, rowHeight, gap, vibe, busy,
  activeSession, onJoinRoom, onResize,
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: room.id,
    disabled: readOnly,
  });

  // Local resize overlay state. We mutate w/h visually as the user
  // drags the corner, then commit on pointerup via onResize. The
  // computed style for the tile uses these when set.
  const [resizing, setResizing] = useState(null); // {w, h} during drag

  const w = resizing?.w ?? room.layout_w;
  const h = resizing?.h ?? room.layout_h;

  const style = {
    gridColumn: `${room.layout_x + 1} / span ${w}`,
    gridRow: `${room.layout_y + 1} / span ${h}`,
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition: isDragging ? "none" : "transform 160ms ease-out",
    zIndex: isDragging || resizing ? 20 : undefined,
    cursor: readOnly ? "default" : isDragging ? "grabbing" : "grab",
  };

  function startResize(e) {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = room.layout_w;
    const startH = room.layout_h;
    function onMove(ev) {
      const dx = Math.round((ev.clientX - startX) / (cellWidth + gap));
      const dy = Math.round((ev.clientY - startY) / (rowHeight + gap));
      const newW = Math.max(1, Math.min(12 - room.layout_x, startW + dx));
      const newH = Math.max(1, Math.min(12, startH + dy));
      setResizing({ w: newW, h: newH });
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizing((prev) => {
        if (prev) onResize(prev.w, prev.h);
        return null;
      });
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {/* Drag handle wrapping the whole tile. We attach listeners only
          when not readOnly so non-admin viewers don't see the grabby
          cursor or accidentally start a drag. */}
      <div
        {...(!readOnly && { ...listeners, ...attributes })}
        className="h-full"
      >
        <RoomTile
          room={room}
          activeSession={activeSession}
          vibe={vibe}
          busy={busy}
          onJoin={onJoinRoom}
        />
      </div>
      {!readOnly && (
        <button
          type="button"
          onPointerDown={startResize}
          aria-label="Resize room"
          className="absolute bottom-1 right-1 p-1 rounded bg-slate-900/40 hover:bg-slate-900/60 text-white/80 hover:text-white cursor-nwse-resize touch-none"
        >
          <GripVertical className="w-3 h-3 rotate-45" />
        </button>
      )}
    </div>
  );
}
