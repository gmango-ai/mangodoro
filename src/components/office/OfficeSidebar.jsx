import { useTheme } from "../../context/ThemeContext";
import { Hash, Briefcase, MessageSquare, Lock, Pencil, Users, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import OfficeMinimap from "./OfficeMinimap";

const KIND_ICON = {
  general: Hash,
  department: Briefcase,
  meeting: MessageSquare,
  private: Lock,
};

function RoomRow({ room, active, isSelected, onSelect, dark }) {
  const accent = room.color || "#14b8a6";
  const Icon = KIND_ICON[room.kind] || Hash;
  const occupants = active?.occupants || [];
  const isOccupied = !!active;

  return (
    <button
      type="button"
      onClick={() => onSelect(room.id)}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
        isSelected
          ? (dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-100")
          : (dark ? "hover:bg-[var(--color-surface-raised)]/60" : "hover:bg-slate-50")
      }`}
    >
      <span
        className="w-1 h-5 rounded-full shrink-0"
        style={{ background: accent }}
        aria-hidden
      />
      <Icon
        className="w-3.5 h-3.5 shrink-0 opacity-70"
        style={{ color: accent }}
      />
      <span
        className={`text-xs font-semibold truncate flex-1 ${
          dark ? "text-slate-200" : "text-slate-700"
        }`}
      >
        {room.name}
      </span>
      {isOccupied && (
        <span
          className="inline-flex items-center gap-1 text-[10px] font-bold shrink-0"
          style={{ color: accent }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: accent }}
          />
          {occupants.length}
        </span>
      )}
    </button>
  );
}

export default function OfficeSidebar({
  activeTeam, onlineCount, activeSessionsCount, canEdit,
  rooms, sessionByRoomId, selectedRoomId, onSelectRoom, onEditOffice,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";

  return (
    <aside
      className={`flex flex-col h-full border-r ${
        dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
      }`}
    >
      {/* Office header */}
      <div className={`px-3 py-3 border-b ${
        dark ? "border-[var(--color-border)]" : "border-slate-200"
      }`}>
        <p className={`text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>
          {activeTeam?.name || "Office"}
        </p>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <h2 className={`text-base font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
            Office
          </h2>
          {canEdit && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onEditOffice}
              title="Edit office layout"
              className="h-7 w-7"
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        <p className={`text-[11px] mt-1 inline-flex items-center gap-2 ${dark ? "text-slate-400" : "text-slate-500"}`}>
          <span className="inline-flex items-center gap-1">
            <Users className="w-2.5 h-2.5" />
            <span className={`font-semibold ${onlineCount > 0 ? "text-[var(--color-accent)]" : ""}`}>
              {onlineCount}
            </span>
          </span>
          <span className="inline-flex items-center gap-1">
            <Timer className="w-2.5 h-2.5" />
            <span className="font-semibold">{activeSessionsCount}</span>
          </span>
        </p>
      </div>

      {/* Minimap */}
      <div className="px-3 py-3">
        <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${dark ? "text-slate-500" : "text-slate-400"}`}>
          Map
        </p>
        <OfficeMinimap
          rooms={rooms}
          sessionByRoomId={sessionByRoomId}
          selectedRoomId={selectedRoomId}
          onSelect={onSelectRoom}
        />
      </div>

      {/* Room list */}
      <div className={`flex-1 overflow-y-auto px-2 py-2 border-t ${
        dark ? "border-[var(--color-border)]" : "border-slate-200"
      }`}>
        <p className={`px-2 text-[10px] font-semibold uppercase tracking-wider mb-1 ${dark ? "text-slate-500" : "text-slate-400"}`}>
          Rooms
        </p>
        <div className="space-y-0.5">
          {(rooms || []).map((room) => (
            <RoomRow
              key={room.id}
              room={room}
              active={sessionByRoomId?.get(room.id) || null}
              isSelected={room.id === selectedRoomId}
              onSelect={onSelectRoom}
              dark={dark}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}
