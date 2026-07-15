import { useState } from "react";
import { PenLine, X as XIcon } from "lucide-react";
import { useSyncSession } from "../../context/SyncSessionContext";
import { useTeam } from "../../context/TeamContext";
import { useApp } from "../../context/AppContext";
import { Button } from "@/components/ui/button";
import { unlinkWhiteboardFromSession } from "../../lib/syncSession";
import WhiteboardPicker from "./WhiteboardPicker";
import WidgetSection from "./WidgetSection";

// Whiteboard link picker. WidgetSection owns the chrome + drag handle.
// (Replaces the deprecated retro widget — the whiteboard is now what a
// room attaches for shared work.)
export default function WhiteboardWidget({ dark }) {
  const { syncSession } = useSyncSession();
  const { rooms, isAdmin, myOrgTeamLeadIds } = useTeam();
  const { session } = useApp();
  const [pickerOpen, setPickerOpen] = useState(false);

  const inSession = !!syncSession;
  const linkedId = inSession ? (syncSession.whiteboard_id || null) : null;
  // Anyone in the room may attach/swap the shared whiteboard (a shared surface,
  // like opening a shared doc) — the server gates on session participation, not
  // leadership. EXCEPT when a manager has locked the board for this room: then
  // only managers can change it (server enforces; UI hides the controls).
  const room = syncSession?.room_id ? rooms?.find((r) => r.id === syncSession.room_id) : null;
  const locked = room?.whiteboard_locked === true;
  const gatingTeamIds = (room?.room_teams || []).map((rt) => rt.org_team_id);
  const canManageRoom = isAdmin
    || (!!room && room.created_by === session?.user?.id)
    || gatingTeamIds.some((id) => myOrgTeamLeadIds?.has(id));
  const canLead = inSession && (!locked || canManageRoom);

  async function unlink() {
    if (!syncSession?.id) return;
    await unlinkWhiteboardFromSession(syncSession.id);
  }

  return (
    <WidgetSection id="whiteboard" icon={PenLine} title="Whiteboard" dark={dark}>
      {!inSession && (
        <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
          Join a session to attach a whiteboard everyone can see.
        </p>
      )}

      {inSession && !linkedId && canLead && (
        <Button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="w-full justify-start"
          size="sm"
        >
          <PenLine className="w-3.5 h-3.5 mr-2" />
          Attach a whiteboard
        </Button>
      )}

      {inSession && !linkedId && !canLead && locked && (
        <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
          A room manager has locked the whiteboard — only they can attach one here.
        </p>
      )}


      {linkedId && (
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold w-full bg-[var(--color-accent-light)] text-[var(--color-accent)]">
            <PenLine className="w-3 h-3" />
            <span className="truncate flex-1">Whiteboard attached</span>
            {canLead && (
              <button
                type="button"
                onClick={unlink}
                aria-label="Unlink whiteboard"
                title="Unlink whiteboard"
                className="p-0.5 rounded-full hover:bg-[var(--color-accent)]/15"
              >
                <XIcon className="w-3 h-3" />
              </button>
            )}
          </div>
          <p className={`text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
            Pick a "Whiteboard" layout in the room's layout menu to focus it.
          </p>
        </div>
      )}

      <WhiteboardPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </WidgetSection>
  );
}
