import { useTheme } from "../../context/ThemeContext";
import { Users, Timer, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import OfficeLayoutEditor from "../OfficeLayoutEditor";

// "Hallway" — the bare /office route. Shows the floor-plan of all
// rooms at a glance, click a tile to enter. Different from the room
// view in that there's no current-room context: you're standing in
// the office, not inside any particular room.
//
// Reuses OfficeLayoutEditor in readOnly mode (same component that
// admins use to edit the layout). Click handler navigates into the
// room.
export default function HallwayView({
  activeTeam, rooms, sessionByRoomId, onlineCount, canEdit,
  busy, onEnterRoom, onEditOffice,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const sessionCount = [...(sessionByRoomId?.values() || [])].length;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto">
      <header className={`px-6 py-4 border-b ${
        dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-white"
      }`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>
              {activeTeam?.name || "Office"}
            </p>
            <h1 className={`text-xl font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
              Hallway
            </h1>
            <p className={`text-xs mt-1 inline-flex items-center gap-3 ${dark ? "text-slate-400" : "text-slate-500"}`}>
              <span className="inline-flex items-center gap-1">
                <Users className="w-3 h-3" />
                <span className={`font-semibold ${onlineCount > 0 ? "text-[var(--color-accent)]" : ""}`}>
                  {onlineCount}
                </span>
                {onlineCount === 1 ? " person" : " people"} in the office
              </span>
              <span className="inline-flex items-center gap-1">
                <Timer className="w-3 h-3" />
                <span className="font-semibold">{sessionCount}</span>
                {sessionCount === 1 ? " active session" : " active sessions"}
              </span>
            </p>
          </div>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={onEditOffice} className="h-8 text-xs">
              <Pencil className="w-3.5 h-3.5 mr-1" /> Edit office
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 p-6">
        {(rooms || []).length === 0 ? (
          <div className={`text-center py-12 rounded-2xl border border-dashed ${
            dark ? "border-[var(--color-border)] text-slate-400" : "border-slate-300 text-slate-500"
          }`}>
            <p className="text-sm">No rooms yet.</p>
            {canEdit && (
              <Button onClick={onEditOffice} className="mt-3" size="sm">
                <Pencil className="w-3.5 h-3.5 mr-1" /> Set up the office
              </Button>
            )}
          </div>
        ) : (
          <OfficeLayoutEditor
            rooms={rooms}
            readOnly
            vibe={activeTeam?.office_vibe || "quiet"}
            busy={busy}
            onOpenRoom={(room) => onEnterRoom?.(room.id)}
            onJoinRoom={(room) => onEnterRoom?.(room.id)}
            sessionByRoomId={sessionByRoomId}
          />
        )}
      </div>
    </div>
  );
}
