import { useEffect, useState, useCallback } from "react";
import { ClipboardList } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { getTaskProviders } from "../../lib/tasks/providers";
import TasksWidget from "../office/TasksWidget";
import WidgetChip from "./WidgetChip";

// Pinned-strip chip for tasks: a count of open tasks in the pill, the full tasks
// card in the popover. Same source as the /tasks page (the task providers), so
// the count matches the page. The count loads on mount; edits in the card sync
// to the DB and the pill refreshes on next mount (good enough for a pill).
export default function TasksChip({ dark }) {
  const { session } = useApp();
  const userId = session?.user?.id;
  const [openCount, setOpenCount] = useState(0);

  const reload = useCallback(async () => {
    if (!userId) { setOpenCount(0); return; }
    const lists = await Promise.all(getTaskProviders().map((p) => p.listTasks({ userId })));
    setOpenCount(lists.flat().filter((t) => !t.done && !t.archived).length);
  }, [userId]);
  useEffect(() => { reload(); }, [reload]);

  return (
    <WidgetChip icon={ClipboardList} value={openCount} label="tasks" title="My tasks" dark={dark}>
      <TasksWidget dark={dark} />
    </WidgetChip>
  );
}
