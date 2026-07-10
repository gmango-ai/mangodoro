import { useNavigate } from "react-router-dom";
import { Check, Circle, X, Rocket } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useTeam } from "../../context/TeamContext";
import { useTheme } from "../../context/ThemeContext";
import { useTour } from "../../context/TourContext";
import { openPomodoroSurface } from "../../lib/pomodoroSurface";
import { deriveChecklist, checklistComplete } from "../../lib/tours/logic";

// Getting-started checklist card. Item done-states come from real app facts
// (see logic.deriveChecklist + OnboardingFactTracker), NOT tour completion.
// Self-hides when every visible item is done, and can be dismissed. Rendered on
// the office (and the pomodoro landing for users with no org yet).
export default function GettingStartedChecklist() {
  const { settings, setChecklistItem } = useApp();
  const { teams, teamMembers } = useTeam();
  const { theme } = useTheme();
  const { startTour, isTourAvailable } = useTour();
  const navigate = useNavigate();
  const dark = theme === "dark";

  const cl = settings?.onboarding?.checklist || {};
  const facts = {
    name: !!settings?.name,
    hasOrg: (teams?.length || 0) > 0,
    hasTeammates: (teamMembers?.length || 0) > 1,
    madeTask: !!cl.task,
    enteredRoom: !!cl.room,
    startedFocus: !!cl.focus,
    hasGoal: !!cl.goal,
    messagedTeammate: !!cl.message,
  };
  const items = deriveChecklist(facts);
  if (cl._hidden || !items.length || checklistComplete(facts)) return null;

  const doneCount = items.filter((i) => i.done).length;

  // Each item's action: prefer starting its tutorial when one is registered +
  // available, otherwise deep-link to where the user does the thing.
  const act = (id) => {
    const tourId = { task: "tasks", room: "office-basics", focus: "meet-pomodoro" }[id];
    if (tourId && isTourAvailable?.(tourId)) { startTour(tourId); return; }
    if (id === "name") navigate("/settings");
    else if (id === "org") navigate("/team");
    else if (id === "task") navigate("/tasks");
    else if (id === "room") navigate("/office");
    else if (id === "focus") openPomodoroSurface();
    else if (id === "goal") navigate("/team");
    else if (id === "message") navigate("/messages");
  };

  return (
    <div
      className={`relative rounded-2xl border p-4 ${
        dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
      }`}
    >
      <button
        type="button"
        onClick={() => setChecklistItem("_hidden", true)}
        aria-label="Dismiss getting-started checklist"
        className={`absolute top-3 right-3 p-1 rounded-md ${dark ? "text-slate-500 hover:text-slate-200" : "text-slate-400 hover:text-slate-600"}`}
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-2 mb-3">
        <span className="w-7 h-7 rounded-lg bg-[var(--color-accent)] text-white flex items-center justify-center">
          <Rocket className="w-4 h-4" />
        </span>
        <div>
          <h3 className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>Get started with Mangodoro</h3>
          <p className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>{doneCount} of {items.length} done</p>
        </div>
      </div>

      <ul className="flex flex-col gap-1">
        {items.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => (it.done ? null : act(it.id))}
              disabled={it.done}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left text-sm transition-colors ${
                it.done
                  ? "cursor-default"
                  : dark ? "hover:bg-white/5" : "hover:bg-slate-50"
              }`}
            >
              {it.done ? (
                <Check className="w-4 h-4 text-[var(--color-accent)] shrink-0" />
              ) : (
                <Circle className={`w-4 h-4 shrink-0 ${dark ? "text-slate-600" : "text-slate-300"}`} />
              )}
              <span
                className={`flex-1 ${
                  it.done
                    ? dark ? "text-slate-500 line-through" : "text-slate-400 line-through"
                    : dark ? "text-slate-200" : "text-slate-700"
                }`}
              >
                {it.label}
              </span>
              {!it.done && <span className="text-[11px] font-semibold text-[var(--color-accent)]">Show me →</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
