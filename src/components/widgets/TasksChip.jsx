import { useEffect, useState, useCallback } from "react";
import { ClipboardList } from "lucide-react";
import { useTeam } from "../../context/TeamContext";
import { listPersonalTasks } from "../../lib/personalTasks";
import TasksWidget from "../office/TasksWidget";
import WidgetChip from "./WidgetChip";

// Pinned-strip chip for personal tasks: a count of open tasks in the pill, the
// full tasks card in the popover. The count loads on mount; edits made in the
// card sync to the DB but the pill count refreshes on next mount (good enough
// for a glanceable pill).
export default function TasksChip({ dark }) {
  const { activeTeamId } = useTeam();
  const [openCount, setOpenCount] = useState(0);

  const reload = useCallback(async () => {
    if (!activeTeamId) { setOpenCount(0); return; }
    const { data } = await listPersonalTasks(activeTeamId);
    setOpenCount((data || []).filter((t) => !t.done && !t.archived).length);
  }, [activeTeamId]);
  useEffect(() => { reload(); }, [reload]);

  return (
    <WidgetChip icon={ClipboardList} value={openCount} label="tasks" title="My tasks" dark={dark}>
      <TasksWidget dark={dark} />
    </WidgetChip>
  );
}
