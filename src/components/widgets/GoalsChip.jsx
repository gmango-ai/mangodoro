import { Target } from "lucide-react";
import { useWeekGoals } from "../../hooks/useWeekGoals";
import { useSyncSession } from "../../context/SyncSessionContext";
import GoalsWidget from "../office/GoalsWidget";
import WidgetChip from "./WidgetChip";

// Pinned-strip chip for this week's goals: a count in the pill, the full goals
// card in the popover. Scoped to the active session's room so the pill count
// matches what the embedded GoalsWidget popover shows.
export default function GoalsChip({ dark }) {
    const { syncSession } = useSyncSession();
    const { goals } = useWeekGoals(syncSession?.room_id || null);
  return (
    <WidgetChip icon={Target} value={goals.length} label="goals" title="Goals this week" dark={dark}>
      {goals.length ? (
        <GoalsWidget dark={dark} />
      ) : (
        <p className={`px-2 py-2 text-[11px] leading-snug ${dark ? "text-slate-500" : "text-slate-500"}`}>
          No goals set for this week.
        </p>
      )}
    </WidgetChip>
  );
}
