import { lazy, Suspense, useState } from "react";
import { PenLine, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import WhiteboardPicker from "../WhiteboardPicker";

// The board editor, loaded only when a whiteboard is actually shown in a
// room (it's a heavy chunk — @xyflow + nodes/edges). Named export off the
// page module so the route and the panel share one chunk.
const WhiteboardBoard = lazy(() =>
  import("../../../pages/WhiteboardPage").then((m) => ({ default: m.WhiteboardBoard })),
);

// Room panel for the linked whiteboard. Shows the live board when the
// session has one attached (session.whiteboard_id), otherwise an empty
// state that lets a leader attach/create one via the same picker the
// sidebar widget uses.
export default function RoomWhiteboardPanel({ whiteboardId, canLink, dark, readOnly = false }) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const shell = `relative w-full h-full rounded-xl border overflow-hidden ${
    dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-white"
  }`;

  if (whiteboardId) {
    return (
      <div className={shell}>
        <Suspense fallback={<div className={`w-full h-full flex items-center justify-center text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>Loading board…</div>}>
          {/* readOnly (kiosk): pointer-events off → a live, non-interactive view.
              Realtime snapshot updates still flow; the device can't edit (RLS is
              SELECT-only anyway, this just stops it LOOKING editable). */}
          <div className={readOnly ? "w-full h-full pointer-events-none" : "w-full h-full"}>
            <WhiteboardBoard boardId={whiteboardId} embedded readOnly={readOnly} />
          </div>
        </Suspense>
        {readOnly && (
          <span className="absolute top-2 right-2 z-10 inline-flex items-center rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/80">
            View only
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`${shell} flex flex-col items-center justify-center text-center px-6 ${dark ? "text-slate-300" : "text-slate-500"}`}>
      <PenLine className="w-6 h-6 mb-2 opacity-70" />
      <p className="text-sm font-semibold">No whiteboard attached</p>
      {canLink ? (
        <>
          <p className="text-xs opacity-70 mt-1 mb-3 max-w-[260px]">
            Attach a board so everyone in this session sees the same canvas.
          </p>
          <Button onClick={() => setPickerOpen(true)} size="sm" className="rounded-full">
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Choose a whiteboard
          </Button>
        </>
      ) : (
        <p className="text-xs opacity-70 mt-1 max-w-[260px]">
          The session host can attach a whiteboard for the group.
        </p>
      )}
      <WhiteboardPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </div>
  );
}
