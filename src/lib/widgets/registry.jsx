import { Timer, Users, Activity, Globe, CalendarDays, Target, Clock, PenLine, ClipboardList } from "lucide-react";
import PomodoroWidget from "../../components/office/PomodoroWidget";
import TeamStatusWidget from "../../components/office/TeamStatusWidget";
import WorldClockWidget from "../../components/office/WorldClockWidget";
import UpcomingMeetingsWidget from "../../components/office/UpcomingMeetingsWidget";
import GoalsWidget from "../../components/office/GoalsWidget";
import WhiteboardWidget from "../../components/office/WhiteboardWidget";
import TasksWidget from "../../components/office/TasksWidget";
import TeamStatusRoster from "../../components/office/TeamStatusRoster";
import { DeviceTimerPanel } from "../../components/office/roomLayout/devicePanels";
import { FocusView, ClockView } from "../../components/office/roomLayout/roomViews";

// ── Canonical widget registry ─────────────────────────────────────────────
// The ONE catalog of app widgets. It replaces the two lists that had drifted:
// the sidebar's `widgetById` (WidgetsSidebar) and rooms' `VIEW_PANELS`
// (roomLayout). Each surface derives what it needs from here, so there's a
// single place to add a widget.
//
// Each entry can render at up to three sizes (chip is added in a later phase):
//   • `card` — the full widget with its own WidgetSection chrome (sidebar / drawer)
//   • `bare` — chrome-less body for a room BSP tile (the tile draws the header)
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
  },
  {
    id: "team-status", title: "Team", icon: Users, min: 200, scope: "team",
    sidebarId: "team-status", tileId: "team",
    card: ({ dark }) => <TeamStatusWidget dark={dark} />,
    bare: ({ dark }) => <div className="h-full overflow-y-auto p-3"><TeamStatusRoster dark={dark} /></div>,
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
  },
  {
    id: "upcoming-meetings", title: "Meetings", icon: CalendarDays, min: 220, scope: "team",
    sidebarId: "upcoming-meetings", tileId: "meetings",
    card: ({ dark }) => <UpcomingMeetingsWidget dark={dark} />,
    bare: ({ dark }) => <UpcomingMeetingsWidget dark={dark} bare />,
  },
  {
    id: "goals", title: "Goals", icon: Target, min: 200, scope: "team",
    sidebarId: "goals", tileId: "goals",
    card: ({ dark }) => <GoalsWidget dark={dark} />,
    bare: ({ dark }) => <GoalsWidget dark={dark} bare />,
  },
  {
    id: "clock", title: "Clock", icon: Clock, min: 200, scope: "room",
    sidebarId: null, tileId: "clock",
    card: null,
    bare: ({ dark }) => <ClockView dark={dark} />,
  },
  {
    id: "whiteboard-link", title: "Whiteboard", icon: PenLine, min: 200, scope: "session",
    sidebarId: "whiteboard", tileId: null,
    card: ({ dark }) => <WhiteboardWidget dark={dark} />,
    bare: null,
  },
  {
    id: "tasks", title: "Tasks", icon: ClipboardList, min: 200, scope: "global",
    sidebarId: "tasks", tileId: null,
    card: ({ dark }) => <TasksWidget dark={dark} />,
    bare: null,
  },
];

// Sidebar (card) surface: sidebarId → render(ctx). An id with no entry (stale
// localStorage from a removed widget) is harmlessly absent.
export const sidebarWidgetById = Object.fromEntries(
  WIDGETS.filter((w) => w.sidebarId && w.card).map((w) => [w.sidebarId, w.card]),
);

// Room-tile (bare) surface: tileId → panel entry, in registry order. Shape
// matches ROOM_PANELS's other entries exactly ({ id, title, icon, min, render }).
export const widgetTilePanels = Object.fromEntries(
  WIDGETS.filter((w) => w.tileId && w.bare).map((w) => [
    w.tileId,
    { id: w.tileId, title: w.title, icon: w.icon, min: w.min, render: w.bare },
  ]),
);
