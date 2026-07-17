import { Timer, Users, Activity, Globe, CalendarDays, Target, Clock, Cloud, ClipboardList } from "lucide-react";
import PomodoroWidget from "../../components/office/PomodoroWidget";
import TeamStatusWidget from "../../components/office/TeamStatusWidget";
import WorldClockWidget from "../../components/office/WorldClockWidget";
import UpcomingMeetingsWidget from "../../components/office/UpcomingMeetingsWidget";
import GoalsWidget from "../../components/office/GoalsWidget";
import WeatherWidget from "../../components/office/WeatherWidget";
import TasksWidget from "../../components/office/TasksWidget";
import TeamStatusRoster from "../../components/office/TeamStatusRoster";
import { DeviceTimerPanel } from "../../components/office/roomLayout/devicePanels";
import { FocusView, ClockView } from "../../components/office/roomLayout/roomViews";
// Chip (one-line) renderers. The pomodoro / team / world-clock chips reuse the
// existing bespoke nav gadgets as-is; meetings / goals / tasks are new pills.
import NavPomodoroClock from "../../components/nav/NavPomodoroClock";
import WorldClockNav from "../../components/WorldClockNav";
import TeamChip from "../../components/widgets/TeamChip";
import MeetingsChip from "../../components/widgets/MeetingsChip";
import GoalsChip from "../../components/widgets/GoalsChip";
import TasksChip from "../../components/widgets/TasksChip";
import WeatherChip from "../../components/widgets/WeatherChip";

// ── Canonical widget registry ─────────────────────────────────────────────
// The ONE catalog of app widgets. It replaces the two lists that had drifted:
// the sidebar's `widgetById` (WidgetsSidebar) and rooms' `VIEW_PANELS`
// (roomLayout). Each surface derives what it needs from here, so there's a
// single place to add a widget.
//
// Each entry can render at up to three sizes:
//   • `card` — the full widget with its own WidgetSection chrome (sidebar / drawer)
//   • `bare` — chrome-less body for a room BSP tile (the tile draws the header)
//   • `chip` — a one-line pill for the pinned topbar strip (opens the card on click)
// A renderer that's absent means the widget doesn't support that size.
//
// Two id namespaces are preserved verbatim so existing persisted state keeps
// resolving:
//   • `sidebarId` — the key used in `ql_widget_order` (sidebar reorder)
//   • `tileId`    — the key used in room-layout trees + presets (ROOM_PANELS)
// They only differ where the old lists disagreed (team-status↔team,
// upcoming-meetings↔meetings). `title`/`icon`/`min` are the TILE header
// metadata; sidebar cards self-title via their own WidgetSection.
//
// Order matters: entries with a `tile` are emitted into ROOM_PANELS in THIS
// order, matching the previous VIEW_PANELS ordering (pomodoro, team, focus,
// world-clock, meetings, goals, clock) so PANEL_IDS / the Add menu are stable.
//
// `scope` (global | team | session | room) is metadata for later phases — the
// pinned strip + drawer will use it to hide widgets that can't work in context.
export const WIDGETS = [
  {
    id: "pomodoro", title: "Pomodoro", icon: Timer, min: 200, scope: "global",
    sidebarId: "pomodoro", tileId: "pomodoro",
    card: ({ dark }) => <PomodoroWidget dark={dark} />,
    bare: ({ sess }) => <DeviceTimerPanel sess={sess} />,
    chip: () => <NavPomodoroClock />,
  },
  {
    id: "team-status", title: "Team", icon: Users, min: 200, scope: "team",
    sidebarId: "team-status", tileId: "team",
    card: ({ dark }) => <TeamStatusWidget dark={dark} />,
    bare: ({ dark }) => <div className="h-full overflow-y-auto p-3"><TeamStatusRoster dark={dark} /></div>,
    chip: ({ dark }) => <TeamChip dark={dark} />,
  },
  {
    id: "focus", title: "Focus", icon: Activity, min: 200, scope: "room",
    sidebarId: null, tileId: "focus",
    card: null,
    bare: ({ dark }) => <FocusView dark={dark} />,
  },
  {
    id: "world-clock", title: "World clock", icon: Globe, min: 200, scope: "team",
    sidebarId: "world-clock", tileId: "world-clock",
    card: ({ dark }) => <WorldClockWidget dark={dark} />,
    bare: ({ dark }) => <WorldClockWidget dark={dark} bare />,
    chip: ({ dark }) => <WorldClockNav dark={dark} />,
  },
  {
    id: "weather", title: "Weather", icon: Cloud, min: 200, scope: "global",
    sidebarId: "weather", tileId: null,
    card: ({ dark }) => <WeatherWidget dark={dark} />,
    bare: ({ dark }) => <WeatherWidget dark={dark} bare />,
    chip: ({ dark }) => <WeatherChip dark={dark} />,
  },
  {
    id: "upcoming-meetings", title: "Meetings", icon: CalendarDays, min: 220, scope: "team",
    sidebarId: "upcoming-meetings", tileId: "meetings",
    card: ({ dark }) => <UpcomingMeetingsWidget dark={dark} />,
    bare: ({ dark }) => <UpcomingMeetingsWidget dark={dark} bare />,
    chip: ({ dark }) => <MeetingsChip dark={dark} />,
  },
  {
    id: "goals", title: "Goals", icon: Target, min: 200, scope: "team",
    sidebarId: "goals", tileId: "goals",
    card: ({ dark }) => <GoalsWidget dark={dark} />,
    bare: ({ dark }) => <GoalsWidget dark={dark} bare />,
    chip: ({ dark }) => <GoalsChip dark={dark} />,
  },
  {
    id: "clock", title: "Clock", icon: Clock, min: 200, scope: "room",
    sidebarId: null, tileId: "clock",
    card: null,
    bare: ({ dark }) => <ClockView dark={dark} />,
  },
  {
    id: "tasks", title: "Tasks", icon: ClipboardList, min: 200, scope: "global",
    sidebarId: "tasks", tileId: null,
    card: ({ dark }) => <TasksWidget dark={dark} />,
    bare: null,
    chip: ({ dark }) => <TasksChip dark={dark} />,
  },
];

// The pinned topbar strip's default set — mirrors the informational gadgets Row 2
// carried before it became pinnable, so the out-of-the-box strip is unchanged.
export const DEFAULT_PINNED = ["pomodoro", "team-status", "world-clock"];

// Widgets that can appear in the pinned strip (have a chip renderer), in
// registry order — powers the "Pin a widget" menu.
export const chipWidgets = WIDGETS.filter((w) => w.chip);

// Canonical id → entry, for surfaces that resolve pinned ids to their chip.
export const widgetById = Object.fromEntries(WIDGETS.map((w) => [w.id, w]));

// Sidebar / drawer (card) surface: sidebarId → { scope, render(ctx) }. Scope
// lets the app-wide drawer hide session/room widgets when not in a room. An id
// with no entry (stale localStorage from a removed widget) is harmlessly absent.
export const sidebarWidgetById = Object.fromEntries(
  WIDGETS.filter((w) => w.sidebarId && w.card).map((w) => [w.sidebarId, { scope: w.scope, render: w.card }]),
);

// Room-tile (bare) surface: tileId → panel entry, in registry order. Shape
// matches ROOM_PANELS's other entries exactly ({ id, title, icon, min, render }).
export const widgetTilePanels = Object.fromEntries(
  WIDGETS.filter((w) => w.tileId && w.bare).map((w) => [
    w.tileId,
    { id: w.tileId, title: w.title, icon: w.icon, min: w.min, render: w.bare },
  ]),
);
