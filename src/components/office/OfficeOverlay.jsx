import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { X, LogOut, Hash, Briefcase, MessageSquare, Lock } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { Button } from "@/components/ui/button";
import OfficeMinimap from "./OfficeMinimap";

const KIND_ICON = {
  general: Hash,
  department: Briefcase,
  meeting: MessageSquare,
  private: Lock,
};

// Room-switcher / hallway-exit overlay triggered from the room
// header's room-name button.
//
// Two layouts, one component:
//   Desktop (md+) — centered modal, wide. Minimap on the left, room
//                   list on the right. The minimap gets the bigger
//                   half because it's the spatial view that benefits
//                   from real estate; the list is one-line rows.
//   Mobile        — right-edge slideout, full height. Stacks
//                   vertically inside: minimap up top, list below.
//                   A drawer feels more native than a modal on
//                   phones; the slide-in animation makes the modal
//                   ↔ drawer transition feel intentional.
//
// Closes on backdrop click, Escape, or the X.
export default function OfficeOverlay({
  open, onClose,
  rooms, lockedRooms, sessionByRoomId, selectedRoomId,
  onLeaveToHallway,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const enterRoom = (id) => {
    navigate(`/office/r/${id}`);
    onClose();
  };
  // Explicit leave: unlike picking another room (a switch), heading to
  // the hallway means "I'm done here", so it routes through the
  // connection-aware leave (removes the user from the session across
  // their tabs) rather than just navigating. Falls back to a plain nav
  // if no leave handler was supplied.
  const goToHallway = () => {
    if (onLeaveToHallway) onLeaveToHallway();
    else navigate("/office");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[180] flex md:items-center md:justify-center md:p-6"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden />

      {/* Panel — drawer on mobile, modal on md+. The Tailwind
          breakpoint reset on md (md:m-0 md:max-w-... md:rounded-2xl)
          flips us from "stuck to the right edge, full height" to
          "centered overlay". */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative ml-auto w-[92vw] max-w-md h-full shadow-2xl border-l overflow-hidden flex flex-col
          md:m-0 md:ml-0 md:h-auto md:max-h-[85vh] md:w-[calc(100vw-3rem)] md:max-w-4xl
          md:rounded-2xl md:border-l md:border ${
          dark
            ? "bg-[var(--color-surface)] border-[var(--color-border)]"
            : "bg-white border-slate-200"
        }`}
      >
        {/* Header — spans the whole panel */}
        <header className={`flex items-center justify-between px-4 py-3 border-b shrink-0 ${
          dark ? "border-[var(--color-border)]" : "border-slate-200"
        }`}>
          <div>
            <h2 className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
              Switch room
            </h2>
            <p className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
              Pick a room to enter, or leave to the hallway
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
            className="h-7 w-7"
          >
            <X className="w-4 h-4" />
          </Button>
        </header>

        {/* Body — minimap + room list, stacked on mobile, side-by-
            side on md+. Minimap takes the larger half so the office
            grid has room to breathe. */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          {/* Minimap pane */}
          <div className={`md:flex-1 p-4 overflow-auto border-b md:border-b-0 md:border-r ${
            dark ? "border-[var(--color-border)]" : "border-slate-200"
          }`}>
            <p className={`text-[10px] font-bold uppercase tracking-wider mb-3 ${
              dark ? "text-slate-500" : "text-slate-400"
            }`}>
              Map
            </p>
            <OfficeMinimap
              rooms={[...(rooms || []), ...(lockedRooms || [])]}
              sessionByRoomId={sessionByRoomId}
              selectedRoomId={selectedRoomId}
              lockedRoomIds={new Set((lockedRooms || []).map((r) => r.id))}
              onSelect={(id) => {
                if ((lockedRooms || []).some((r) => r.id === id)) return;
                enterRoom(id);
              }}
            />
          </div>

          {/* Room list pane */}
          <div className="md:w-72 lg:w-80 shrink-0 flex flex-col min-h-0 overflow-hidden">
            <p className={`px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-wider ${
              dark ? "text-slate-500" : "text-slate-400"
            }`}>
              Rooms
            </p>
            <div className="flex-1 px-2 pb-2 space-y-0.5 overflow-y-auto">
              {[
                ...(rooms || []).map((r) => ({ room: r, locked: false })),
                ...(lockedRooms || []).map((r) => ({ room: r, locked: true })),
              ].map(({ room, locked }) => {
                const Icon = KIND_ICON[room.kind] || Hash;
                const accent = room.color || "#14b8a6";
                const active = sessionByRoomId?.get(room.id) || null;
                const occupants = active?.occupants || [];
                const isSelected = room.id === selectedRoomId;
                return (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => {
                      if (locked) return;
                      enterRoom(room.id);
                    }}
                    disabled={locked}
                    title={locked ? "Locked — not a member of the gating team" : undefined}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                      locked
                        ? "opacity-60 cursor-not-allowed"
                        : isSelected
                          ? dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-100"
                          : dark ? "hover:bg-[var(--color-surface-raised)]/60" : "hover:bg-slate-50"
                    }`}
                  >
                    <span className="w-1 h-5 rounded-full shrink-0" style={{ background: accent }} aria-hidden />
                    <Icon className="w-3.5 h-3.5 shrink-0 opacity-70" style={{ color: accent }} />
                    <span className={`text-xs font-semibold truncate flex-1 ${
                      dark ? "text-slate-200" : "text-slate-700"
                    }`}>
                      {room.name}
                    </span>
                    {locked && <Lock className="w-3 h-3 shrink-0 opacity-60" />}
                    {!locked && isSelected && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[var(--color-accent-light)] text-[var(--color-accent)]">
                        Here
                      </span>
                    )}
                    {!locked && occupants.length > 0 && !isSelected && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold shrink-0" style={{ color: accent }}>
                        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: accent }} />
                        {occupants.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Hallway exit */}
        <footer className={`px-4 py-3 border-t shrink-0 ${
          dark ? "border-[var(--color-border)]" : "border-slate-200"
        }`}>
          <button
            type="button"
            onClick={goToHallway}
            className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold transition-colors ${
              dark
                ? "text-slate-300 hover:bg-[var(--color-surface-raised)]"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <LogOut className="w-3.5 h-3.5" />
            Leave to hallway
          </button>
        </footer>
      </div>
    </div>
  );
}
