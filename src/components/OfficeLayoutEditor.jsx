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
  lockedRoomIds,
  lockedReasonFor,
  displayRoomIds,
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
    const targetX = Math.max(0, Math.min(COLUMNS - o.layout_w, o.layout_x + dx));
    const targetY = Math.max(0, o.layout_y + dy);
    const rect = { w: o.layout_w, h: o.layout_h };
    // If the drop lands on an empty spot, take it. Otherwise look for
    // the nearest free w×h slot — searching in concentric Chebyshev
    // rings — instead of refusing the move outright. That way you can
    // slide a room "under" another even when the rest of the floor
    // is densely packed.
    if (!hasCollision(room.id, { x: targetX, y: targetY, ...rect })) {
      persistLayout(room.id, targetX, targetY, rect.w, rect.h);
      return;
    }
    const snapped = findNearestFreeCell(room.id, targetX, targetY, rect);
    if (snapped) persistLayout(room.id, snapped.x, snapped.y, rect.w, rect.h);
  }

  // Concentric-ring search for the nearest free cell to (cx, cy).
  // Caps at 12 rings (covers >144 candidate cells) before giving up;
  // a totally-jammed grid just returns null and the move is dropped.
  function findNearestFreeCell(roomId, cx, cy, rect) {
    for (let r = 1; r <= 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x + rect.w > COLUMNS) continue;
          if (!hasCollision(roomId, { x, y, w: rect.w, h: rect.h })) {
            return { x, y };
          }
        }
      }
    }
    return null;
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div
        ref={gridRef}
        className={`relative rounded-xl border p-2 ${
          dark ? "bg-[var(--color-bg)] border-[var(--color-border)]" : "bg-slate-50 border-slate-200"
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
          const isLocked = lockedRoomIds?.has?.(room.id) || false;
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
              locked={isLocked}
              lockedReason={isLocked ? lockedReasonFor?.(room) : undefined}
              displayOn={displayRoomIds?.has?.(room.id) || false}
              canResizeTo={(x, y, w, h) =>
                !hasCollision(room.id, { x, y, w, h })
              }
              onResize={(x, y, w, h) => {
                if (hasCollision(room.id, { x, y, w, h })) return;
                persistLayout(room.id, x, y, w, h);
              }}
            />
          );
        })}
      </div>
    </DndContext>
  );
}

// Small corner hot zone with a hover dot. `pos` is "nw"|"ne"|"sw"|"se".
function CornerHandle({ pos, cursor, onPointerDown }) {
  const posCls = {
    nw: "top-0 left-0",
    ne: "top-0 right-0",
    sw: "bottom-0 left-0",
    se: "bottom-0 right-0",
  }[pos];
  const dotPos = {
    nw: "top-1 left-1",
    ne: "top-1 right-1",
    sw: "bottom-1 left-1",
    se: "bottom-1 right-1",
  }[pos];
  return (
    <span
      onPointerDown={onPointerDown}
      className={`absolute w-3 h-3 ${posCls} ${cursor} touch-none`}
      aria-label={`Resize ${pos}`}
    >
      <span
        className={`absolute ${dotPos} w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] opacity-0 group-hover:opacity-100 transition-opacity`}
        aria-hidden
      />
    </span>
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
          className={`rounded ${dark ? "bg-[var(--color-surface-raised)]" : "bg-white/60"}`}
        />,
      );
    }
  }
  return <>{cells}</>;
}

function LayoutTile({
  room, readOnly, cellWidth, rowHeight, gap, vibe, busy,
  activeSession, onJoinRoom, onOpenRoom, onResize, canResizeTo,
  locked, lockedReason, displayOn,
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: room.id,
    disabled: readOnly,
  });

  // Local resize overlay state. We mutate x/y/w/h visually as the user
  // drags an edge or corner, then commit on pointerup via onResize.
  // Storing x/y here too — top/left edges move the tile origin while
  // they resize, so the visual must update both.
  const [resizing, setResizing] = useState(null); // {x, y, w, h} during drag

  const x = resizing?.x ?? room.layout_x;
  const y = resizing?.y ?? room.layout_y;
  const w = resizing?.w ?? room.layout_w;
  const h = resizing?.h ?? room.layout_h;

  const style = {
    gridColumn: `${x + 1} / span ${w}`,
    gridRow: `${y + 1} / span ${h}`,
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition: isDragging ? "none" : "transform 160ms ease-out",
    zIndex: isDragging || resizing ? 20 : undefined,
    cursor: readOnly ? "default" : isDragging ? "grabbing" : "grab",
  };

  // Generic edge-grab resize. `dirs` is an object with which sides
  // are being dragged: any of {n, e, s, w}. Top/left edges (n, w) move
  // the tile's origin in addition to changing w/h — they pull the
  // boundary toward the pointer instead of growing from a fixed
  // corner.
  function startResize(dirs) {
    return function handler(e) {
      if (readOnly) return;
      e.preventDefault();
      e.stopPropagation();
      const startPX = e.clientX;
      const startPY = e.clientY;
      const startX = room.layout_x;
      const startY = room.layout_y;
      const startW = room.layout_w;
      const startH = room.layout_h;
      function onMove(ev) {
        const dx = Math.round((ev.clientX - startPX) / (cellWidth + gap));
        const dy = Math.round((ev.clientY - startPY) / (rowHeight + gap));

        let nx = startX;
        let ny = startY;
        let nw = startW;
        let nh = startH;
        if (dirs.e) nw = startW + dx;
        if (dirs.w) { nx = startX + dx; nw = startW - dx; }
        if (dirs.s) nh = startH + dy;
        if (dirs.n) { ny = startY + dy; nh = startH - dy; }

        // Clamp sizes to a sane range; bound positions so the tile
        // stays inside the 12-column grid.
        nw = Math.max(1, Math.min(12, nw));
        nh = Math.max(1, Math.min(12, nh));
        nx = Math.max(0, Math.min(12 - nw, nx));
        ny = Math.max(0, ny);

        // Refuse moves that would overlap a neighbor — the tile stops
        // at the last collision-free position, mirroring drag behavior.
        if (canResizeTo && !canResizeTo(nx, ny, nw, nh)) return;
        setResizing({ x: nx, y: ny, w: nw, h: nh });
      }
      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setResizing((prev) => {
          if (prev) onResize(prev.x, prev.y, prev.w, prev.h);
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
          locked={locked}
          lockedReason={lockedReason}
          displayOn={displayOn}
        />
      </div>
      {!readOnly && (
        <>
          {/* Edge zones — invisible by default, fade in a cyan accent on
              hover so the affordance is discoverable without being noisy. */}
          <span
            onPointerDown={startResize({ n: true })}
            className="absolute top-0 left-3 right-3 h-1.5 cursor-ns-resize touch-none rounded bg-transparent hover:bg-[var(--color-accent-light-hover)] transition-colors"
            aria-label="Resize from top"
          />
          <span
            onPointerDown={startResize({ s: true })}
            className="absolute bottom-0 left-3 right-3 h-1.5 cursor-ns-resize touch-none rounded bg-transparent hover:bg-[var(--color-accent-light-hover)] transition-colors"
            aria-label="Resize from bottom"
          />
          <span
            onPointerDown={startResize({ w: true })}
            className="absolute left-0 top-3 bottom-3 w-1.5 cursor-ew-resize touch-none rounded bg-transparent hover:bg-[var(--color-accent-light-hover)] transition-colors"
            aria-label="Resize from left"
          />
          <span
            onPointerDown={startResize({ e: true })}
            className="absolute right-0 top-3 bottom-3 w-1.5 cursor-ew-resize touch-none rounded bg-transparent hover:bg-[var(--color-accent-light-hover)] transition-colors"
            aria-label="Resize from right"
          />
          {/* Corner zones — rendered after edges so they sit on top and
              own the corner regions. Each corner shows a small cyan dot
              on tile hover for discoverability. */}
          <CornerHandle pos="nw" cursor="cursor-nwse-resize" onPointerDown={startResize({ n: true, w: true })} />
          <CornerHandle pos="ne" cursor="cursor-nesw-resize" onPointerDown={startResize({ n: true, e: true })} />
          <CornerHandle pos="sw" cursor="cursor-nesw-resize" onPointerDown={startResize({ s: true, w: true })} />
          <CornerHandle pos="se" cursor="cursor-nwse-resize" onPointerDown={startResize({ s: true, e: true })} />
        </>
      )}
    </div>
  );
}
