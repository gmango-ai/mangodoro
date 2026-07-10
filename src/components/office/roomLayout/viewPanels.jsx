import { useState } from "react";
import { Timer, Users, Globe, CalendarDays, Target, Activity, Clock } from "lucide-react";
import TeamStatusRoster from "../TeamStatusRoster";
import WorldClockWidget from "../WorldClockWidget";
import UpcomingMeetingsWidget from "../UpcomingMeetingsWidget";
import GoalsWidget from "../GoalsWidget";
import { DeviceTimerPanel } from "./devicePanels";
import UserAvatar from "../../UserAvatar";
import { useTeam } from "../../../context/TeamContext";
import { useOfficePresence } from "../../../hooks/useOfficePresence";
import { useVisibilityPausedInterval } from "../../../hooks/useVisibilityPausedInterval";
import { availabilityDot, availabilityLabel } from "../../../lib/presence";

// Extra room-layout views ("widgets as views"). These reuse the sidebar widget
// bodies (rendered `bare` — no card chrome, since the tile supplies its own
// title bar) plus a couple of purpose-built displays. Merged into ROOM_PANELS.
// render(ctx) receives the room panelCtx: { room, userId, dark, sess, ... }.

// Big glanceable wall clock + date — for a shared room screen.
function ClockView({ dark }) {
  const [now, setNow] = useState(() => new Date());
  useVisibilityPausedInterval(() => setNow(new Date()), 1000, { enabled: true });
  return (
    <div
      className={`w-full h-full flex flex-col items-center justify-center p-4 overflow-hidden ${dark ? "text-slate-100" : "text-slate-800"}`}
      style={{ containerType: "size" }}
    >
      <div
        className="font-bold tabular-nums leading-none"
        style={{ fontSize: "min(20cqw, 42cqh)", fontFamily: "'Parkinsans', sans-serif", whiteSpace: "nowrap" }}
      >
        {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </div>
      <div
        className={`mt-3 font-medium ${dark ? "text-slate-400" : "text-slate-500"}`}
        style={{ fontSize: "clamp(11px, 5cqmin, 20px)", whiteSpace: "nowrap" }}
      >
        {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
      </div>
    </div>
  );
}

// "Who's on what" — online teammates and their current focus/activity.
function FocusView({ dark }) {
  const { teamMembers } = useTeam();
  const identity = {};
  (teamMembers || []).forEach((tm) => {
    if (tm.user_id) identity[tm.user_id] = { name: tm.name || tm.display_name || "", avatar: tm.avatar || tm.avatar_url || "" };
  });
  const people = useOfficePresence(identity).filter((p) => identity[p.userId] && p.online);
  const sorted = [...people].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return (
    <div className="w-full h-full overflow-y-auto p-3">
      {sorted.length === 0 ? (
        <p className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>No one's online right now.</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((p) => (
            <li key={p.userId} className="flex items-center gap-2.5">
              <span className="relative shrink-0">
                <UserAvatar url={p.avatar} name={p.name || "Member"} size={28} />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ${availabilityDot(p.availability)} ${dark ? "ring-[var(--color-surface)]" : "ring-white"}`}
                  aria-hidden
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-medium truncate ${dark ? "text-slate-200" : "text-slate-700"}`}>
                  {p.name || "Member"}
                </span>
                <span className={`block text-xs truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
                  {p.activity?.label || availabilityLabel(p.availability)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const VIEW_PANELS = {
  pomodoro: {
    id: "pomodoro",
    title: "Pomodoro",
    icon: Timer,
    min: 200,
    render: ({ sess }) => <DeviceTimerPanel sess={sess} />,
  },
  team: {
    id: "team",
    title: "Team",
    icon: Users,
    min: 200,
    render: ({ dark }) => (
      <div className="h-full overflow-y-auto p-3"><TeamStatusRoster dark={dark} /></div>
    ),
  },
  focus: {
    id: "focus",
    title: "Focus",
    icon: Activity,
    min: 200,
    render: ({ dark }) => <FocusView dark={dark} />,
  },
  "world-clock": {
    id: "world-clock",
    title: "World clock",
    icon: Globe,
    min: 200,
    render: ({ dark }) => <WorldClockWidget dark={dark} bare />,
  },
  meetings: {
    id: "meetings",
    title: "Meetings",
    icon: CalendarDays,
    min: 220,
    render: ({ dark }) => <UpcomingMeetingsWidget dark={dark} bare />,
  },
  goals: {
    id: "goals",
    title: "Goals",
    icon: Target,
    min: 200,
    render: ({ dark }) => <GoalsWidget dark={dark} bare />,
  },
  clock: {
    id: "clock",
    title: "Clock",
    icon: Clock,
    min: 200,
    render: ({ dark }) => <ClockView dark={dark} />,
  },
};
