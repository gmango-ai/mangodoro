import { useResolvedSelf } from "../hooks/useResolvedSelf";
import { availabilityDot, availabilityLabel } from "../lib/presence";
import { formatSince } from "../lib/utils";

// The always-visible self status chip (plan §5) — avatar-ring light + label +
// activity + duration. Reads the live resolved status (no DB), so it's safe to
// render even before go-live. Display-only for now; clicking will open the
// status editor in a later increment.
//
// NOT YET MOUNTED in Nav.jsx — added at the go-live step.

export default function StatusChip({ onClick }) {
  const { resolved } = useResolvedSelf();
  if (!resolved) return null;

  const { availability, activity } = resolved;
  const detail = activity && !activity.private ? activity.label : null;
  const dur = formatSince(activity?.since ?? resolved.since);
  const title = [availabilityLabel(availability), detail, dur].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${availabilityDot(availability)}`} />
      <span className="font-medium">{availabilityLabel(availability)}</span>
      {detail && <span className="max-w-[10rem] truncate text-slate-400">· {detail}</span>}
      {dur && <span className="text-slate-400">· {dur}</span>}
    </button>
  );
}
