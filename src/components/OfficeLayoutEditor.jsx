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
// Cells stay square regardless of container width by setting
// gridAutoRows = cellWidth (computed in a ResizeObserver below).
// The constant is just a clamp ceiling so the floor plan doesn't
// blow up on very wide screens.
const MAX_CELL = 96;
const GAP = 10;

export default function OfficeLayoutEditor({
  rooms,
  readOnly,
  vibe,
  busy,
  onJoinRoom,
  onOpenRoom,
  sessionByRoomId,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";

  const gridRef = useRef(null);
  const [cellWidth, setCellWidth] = useState(80);
  // Cells are square: row height === cell width.
  const cellHeight = Math.min(cellWidth, MAX_CELL);

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

  // Axis-aligned bounding-box intersection. Returns true if A and B
  // overlap by at least one cell. Used to refuse drag/resize moves
  // that would put two rooms on top of each other.
  function rectsOverlap(a, b) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  // Does the proposed rect collide with any other (non-self) room's
  // current visual rect? Uses the same override-applied geometry so
  // mid-flight optimistic moves get checked too.
  function hasCollision(roomId, proposed) {
    for (const other of rooms || []) {
      if (other.id === roomId) continue;
      const o = applyOverride(other);
      const otherRect = { x: o.layout_x, y: o.layout_y, w: o.layout_w, h: o.layout_h };
      if (rectsOverlap(proposed, otherRect)) return true;
    }
    return false;
  }

  function handleDragEnd(event) {
    const { active, delta } = event;
    const room = (rooms || []).find((r) => r.id === active.id);
    if (!room) return;
    const o = applyOverride(room);
    const dx = Math.round(delta.x / (cellWidth + GAP));
    const dy = Math.round(delta.y / (cellHeight + GAP));
    if (dx === 0 && dy === 0) return;
    const x = Math.max(0, Math.min(COLUMNS - o.layout_w, o.layout_x + dx));
    const y = Math.max(0, o.layout_y + dy);
    // Refuse the move if it would land on another room. The tile
    // visually springs back to its origin via the transform reset.
    if (hasCollision(room.id, { x, y, w: o.layout_w, h: o.layout_h })) return;
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
          gridAutoRows: `${cellHeight}px`,
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
              rowHeight={cellHeight}
              gap={GAP}
              vibe={vibe}
              busy={busy}
              activeSession={sessionByRoomId?.get(room.id) || null}
              onJoinRoom={onJoinRoom}
              onOpenRoom={onOpenRoom}
              canResizeTo={(w, h) =>
                !hasCollision(room.id, { x: r.layout_x, y: r.layout_y, w, h })
              }
              onResize={(w, h) => {
                if (hasCollision(room.id, { x: r.layout_x, y: r.layout_y, w, h })) return;
                persistLayout(room.id, r.layout_x, r.layout_y, w, h);
              }}
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
  activeSession, onJoinRoom, onOpenRoom, onResize, canResizeTo,
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

  // Generic edge-grab resize. `axis` controls which dimensions move:
  //   "e" — width only (right edge)
  //   "s" — height only (bottom edge)
  //   "se" — both (bottom-right corner)
  // Edge zones feel more natural than a small icon: you reach for the
  // boundary where the tile ends.
  function startResize(axis) {
    return function handler(e) {
      if (readOnly) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startW = room.layout_w;
      const startH = room.layout_h;
      function onMove(ev) {
        const dx = axis.includes("e") ? Math.round((ev.clientX - startX) / (cellWidth + gap)) : 0;
        const dy = axis.includes("s") ? Math.round((ev.clientY - startY) / (rowHeight + gap)) : 0;
        const newW = axis.includes("e")
          ? Math.max(1, Math.min(12 - room.layout_x, startW + dx))
          : startW;
        const newH = axis.includes("s")
          ? Math.max(1, Math.min(12, startH + dy))
          : startH;
        if (canResizeTo && !canResizeTo(newW, newH)) return;
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
    };
  }

  return (
    <div ref={setNodeRef} style={style} className="relative group">
      {/* Drag handle wrapping the whole tile. Single-click clicks pass
          through to RoomTile (dnd-kit only activates after 6px). */}
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
          onOpen={onOpenRoom}
        />
      </div>
      {!readOnly && (
        <>
          {/* Right edge — drag to resize width. Invisible by default,
              accent appears on hover so the affordance is discoverable
              without being noisy. */}
          <span
            onPointerDown={startResize("e")}
            className="absolute right-0 top-2 bottom-2 w-1.5 cursor-ew-resize touch-none rounded bg-transparent hover:bg-cyan-500/40 transition-colors"
            aria-label="Resize width"
          />
          {/* Bottom edge — drag to resize height. */}
          <span
            onPointerDown={startResize("s")}
            className="absolute bottom-0 left-2 right-2 h-1.5 cursor-ns-resize touch-none rounded bg-transparent hover:bg-cyan-500/40 transition-colors"
            aria-label="Resize height"
          />
          {/* Bottom-right corner — drag to resize both. Small visible
              chevron-style dot peeks on hover so users discover it. */}
          <span
            onPointerDown={startResize("se")}
            className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize touch-none rounded-br-2xl"
            aria-label="Resize"
          >
            <span className="block w-full h-full opacity-0 group-hover:opacity-100 transition-opacity">
              <span
                className="absolute right-1 bottom-1 w-1.5 h-1.5 rounded-full bg-cyan-400"
                aria-hidden
              />
            </span>
          </span>
        </>
      )}
    </div>
  );
}
