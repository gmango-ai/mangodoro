// Declarative tour registry. Each tour is data — the engine (engine.js) turns it
// into a driver.js run, and TourContext gates it on `prerequisite(ctx)`. Adding a
// tutorial is a code-only change (state lives in the single settings.onboarding
// jsonb).
//
// Tour shape:
//   { id, title, description, category,
//     prerequisite?: (ctx) => ({ ok } | { ok:false, reason, remedy }),
//     entry?: { to, await },          // navigate + wait before step 0
//     trigger?: { path?: string, element?: selector }, // auto-offer surface
//     announce?: { marker },          // "new feature" nudge (WhatsNew-style)
//     steps: [ { element, popover:{title,description,side,align}, when?(ctx), onNext?(ctx) } ] }
//
// Selectors prefer existing stable hooks (data-*, aria-label, title, role, ids).
// New `data-tour="..."` anchors were added surface-by-surface for these tours.

const TOUR_MARKER = "2026-07-tours-v1";

export const TOUR_CATEGORIES = [
  { id: "getting-started", label: "Getting started" },
  { id: "productivity", label: "Focus & planning" },
  { id: "rooms", label: "Rooms & calls" },
  { id: "collaboration", label: "Collaboration" },
];

export const TOURS = [
  // ── Getting started ──────────────────────────────────────────────────────
  {
    // The first-run guided tour — a single cross-route walk through the app's
    // spine. Launched explicitly by WelcomeFlow (no auto-offer trigger) and
    // replayable from the Help center. Each step's onNext navigates to the next
    // surface, then the engine waits for that surface's anchor before advancing.
    // Robust to a brand-new user with no org: the office stop is gated on having
    // a team, and the prior step's onNext branches to skip straight to the wrap.
    id: "welcome",
    title: "Take the tour",
    description: "A quick guided walk through Mangodoro.",
    category: "getting-started",
    entry: { to: "/pomodoro", await: '[data-tour="pomodoro-timer"]' },
    steps: [
      {
        element: '[data-tour="pomodoro-timer"]',
        popover: {
          title: "Start here: your focus timer",
          description:
            "Mangodoro is built around focused work sprints. Press play to start a session — the timer then follows you across the whole app, even when you leave this page.",
          side: "bottom",
          align: "start",
        },
        onNext: async (ctx) => { ctx.navigate("/tasks"); await ctx.waitFor('[data-tour="tasks-new"]', { timeout: 6000 }); },
      },
      {
        element: '[data-tour="tasks-new"]',
        popover: {
          title: "Everything you're working on",
          description:
            "Your tasks live on a timeline sorted by when they're due. Add one, mark it as your focus, and it shows up in your timer, calendar, and rooms.",
          side: "bottom",
          align: "end",
        },
        onNext: async (ctx) => { ctx.navigate("/calendar"); await ctx.waitFor(".cal-ocean__gridwrap", { timeout: 6000 }); },
      },
      {
        element: ".cal-ocean__gridwrap",
        popover: {
          title: "Your week at a glance",
          description:
            "The calendar pulls together tasks, deadlines, meetings and goals in one place. Drag across any day to block time or schedule an event.",
          side: "top",
          align: "center",
        },
        // Branch: only detour through the office if the user is actually in an
        // org (the hallway anchor won't exist otherwise). Mirrors the office
        // step's `when` so navigation always matches the next visible step.
        onNext: async (ctx) => {
          if (ctx.activeTeam) { ctx.navigate("/office"); await ctx.waitFor('[data-tour="hallway"]', { timeout: 6000 }); }
        },
      },
      {
        element: '[data-tour="hallway"]',
        when: (ctx) => !!ctx.activeTeam,
        popover: {
          title: "Your team's office",
          description:
            "Drop into a room for video coworking or a synced focus session. The hallway shows who's around and what everyone's up to.",
          side: "bottom",
          align: "start",
        },
      },
      {
        // Centered wrap-up (no element) — always shows.
        popover: {
          title: "You're all set 🎉",
          description:
            "That's the quick tour. Explore at your own pace — and replay any tutorial any time from Learn Mangodoro (the ? in the top bar).",
          side: "bottom",
          align: "center",
        },
      },
    ],
  },

  // ── Focus & planning (productivity) ──────────────────────────────────────
  {
    id: "meet-pomodoro",
    title: "Your focus timer",
    description: "Run a pomodoro sprint and focus on one task.",
    category: "productivity",
    trigger: { path: "/pomodoro" },
    entry: { to: "/pomodoro", await: '[data-tour="pomodoro-timer"]' },
    steps: [
      {
        element: '[data-tour="pomodoro-timer"]',
        popover: {
          title: "Your focus timer",
          description:
            "The countdown shows time left in the current sprint, with the mode below it. It keeps running as you move around the app — and can even pop out into its own window.",
          side: "bottom",
          align: "start",
        },
      },
      {
        element: '[data-tour="pomodoro-mode"]',
        popover: {
          title: "Focus or break",
          description: "Switch between a Focus sprint and a short or long break. Mangodoro can auto-advance you from one to the next.",
          side: "bottom",
          align: "center",
        },
      },
      {
        element: '[data-tour="pomodoro-play"]',
        popover: {
          title: "Start & pause",
          description: "Press play to begin the sprint. Tap again to pause — your progress is kept.",
          side: "top",
          align: "center",
        },
      },
      {
        element: '[data-tour="pomodoro-focus-task"]',
        popover: {
          title: "Work on one thing",
          description:
            "Pick a focus task and its subtasks and progress show right here — and your status can update to match, so teammates see what you're heads-down on.",
          side: "top",
          align: "center",
        },
      },
    ],
  },

  {
    id: "tasks",
    title: "Manage your tasks",
    description: "Add tasks, set a focus, and track status on the timeline.",
    category: "productivity",
    trigger: { path: "/tasks" },
    entry: { to: "/tasks", await: '[data-tour="tasks-new"]' },
    steps: [
      {
        element: '[data-tour="tasks-new"]',
        popover: {
          title: "Add a task",
          description: "Create a task here — it drops onto the timeline at its due date. Open any task to add a deadline, labels, and subtasks.",
          side: "bottom",
          align: "end",
        },
      },
      {
        element: '[data-tour="task-focus"]',
        popover: {
          title: "Set your focus",
          description:
            "The mango target marks your current focus — the one task your pomodoro timer counts toward. You focus on one thing at a time.",
          side: "right",
          align: "start",
        },
      },
      {
        element: '[data-tour="task-status"]',
        popover: {
          title: "Track status",
          description: "This pill sets To do, In progress, or Done. Marking a task Done checks it off everywhere it appears.",
          side: "left",
          align: "start",
        },
      },
      {
        element: '[data-tour="tasks-focus-banner"]',
        popover: {
          title: "Your focus, front and center",
          description: "Whatever you're focusing on sits up here with live subtask progress, so it's the first thing you see.",
          side: "bottom",
          align: "center",
        },
      },
      {
        element: '[data-tour="tasks-views"]',
        popover: {
          title: "Active, completed, archived",
          description: "Switch views to review finished work or dig up something you archived. Search filters whichever view you're in.",
          side: "bottom",
          align: "center",
        },
      },
    ],
  },

  {
    id: "calendar",
    title: "Plan on the calendar",
    description: "See tasks, deadlines, and meetings together — and schedule by dragging.",
    category: "productivity",
    trigger: { path: "/calendar" },
    entry: { to: "/calendar", await: ".cal-ocean__gridwrap" },
    steps: [
      {
        element: ".cal-ocean__seg",
        popover: {
          title: "Personal or team",
          description: "Toggle between your own calendar and your team's shared view. Use the layers panel to show or hide tasks, deadlines, meetings, and goals.",
          side: "right",
          align: "start",
        },
      },
      {
        element: ".cal-ocean__gridwrap",
        popover: {
          title: "Drag to schedule",
          description:
            "Everything with a date shows here — tasks, deadlines, meetings, goals, even logged hours. Drag across a day to block time or create an event.",
          side: "top",
          align: "center",
        },
      },
      {
        element: ".cal-ocean__new",
        popover: {
          title: "New event",
          description: "Or add an event straight from here, then invite teammates and pick a room to meet in.",
          side: "bottom",
          align: "end",
        },
      },
    ],
  },

  {
    id: "whiteboards",
    title: "Sketch on a whiteboard",
    description: "Create a shared canvas for stickies, drawing, and diagrams.",
    category: "productivity",
    prerequisite: (ctx) => (ctx.activeTeam
      ? { ok: true }
      : { ok: false, reason: "Join or create an org first — whiteboards are shared with your team.", remedy: { type: "deep-link", to: "/team" } }),
    trigger: { path: "/whiteboards" },
    entry: { to: "/whiteboards", await: '[data-tour="whiteboards-new"]' },
    steps: [
      {
        element: '[data-tour="whiteboards-new"]',
        popover: {
          title: "Create a whiteboard",
          description:
            "Spin up a collaborative canvas — sticky notes, freehand pen, shapes and templates. Open one and the toolbar down the left has every tool; you can link a board to a room so your team sketches together in real time.",
          side: "bottom",
          align: "end",
        },
      },
    ],
  },

  {
    id: "time-tracking",
    title: "Track your hours",
    description: "Clock in live or log hours manually, then review totals.",
    category: "productivity",
    trigger: { path: "/time-tracker" },
    entry: { to: "/time-tracker/log", await: '[data-tour="log-mode"]' },
    steps: [
      {
        element: '[data-tour="log-mode"]',
        popover: {
          title: "Two ways to log time",
          description: "Use Automatic to clock in and time yourself live, or Manual to enter hours after the fact. Both land in the same log.",
          side: "left",
          align: "start",
        },
      },
      {
        element: '[data-tour="tt-tab-overview"]',
        popover: {
          title: "See your totals",
          description: "Overview rolls up your hours and earnings with a month-at-a-glance calendar, so you can spot your patterns.",
          side: "bottom",
          align: "start",
        },
      },
    ],
  },

  // ── Rooms & calls ────────────────────────────────────────────────────────
  {
    id: "office-basics",
    title: "Join a room",
    description: "Find your office and step into a room.",
    category: "rooms",
    announce: { marker: TOUR_MARKER },
    trigger: { path: "/office" },
    prerequisite: (ctx) => (ctx.activeTeam
      ? { ok: true }
      : { ok: false, reason: "Join or create an org first — your office rooms live inside it.", remedy: { type: "deep-link", to: "/team" } }),
    entry: { to: "/office", await: '[data-tour="hallway"]' },
    steps: [
      {
        element: '[data-tour="hallway"]',
        popover: {
          title: "This is your office",
          description: "Every room is a space you can drop into for focused work or a video call. The hallway shows who's around. Let's look at a room.",
          side: "bottom",
          align: "start",
        },
        // Switch to the list view so a room tile is reliably on screen for the
        // next step (the default floor plan renders rooms on a canvas).
        onNext: async (ctx) => {
          document.querySelector('[title="List view"]')?.click();
          await ctx.waitFor('[data-tour="room-tile"]', { timeout: 3000 });
        },
      },
      {
        element: '[data-tour="room-tile"]',
        popover: {
          title: "Step into a room",
          description:
            "Click any room to enter. You'll land in a green room to set up your camera and mic first, then Join — no surprise hot-mic.",
          side: "bottom",
          align: "start",
        },
      },
    ],
  },

  {
    id: "green-room",
    title: "Set up before you join",
    description: "Check your camera and mic in the green room.",
    category: "rooms",
    // Contextual: only surfaces when you're actually in a green room.
    trigger: { element: '[data-tour="greenroom-join"]' },
    steps: [
      {
        element: '[data-tour="greenroom-devices"]',
        popover: {
          title: "Camera & mic",
          description:
            "Toggle your mic and camera, and use the little carets to pick a device, add background blur, or turn on noise cancellation — all before anyone sees or hears you.",
          side: "top",
          align: "center",
        },
      },
      {
        element: '[data-tour="greenroom-join"]',
        popover: {
          title: "Join when you're ready",
          description: "Happy with your setup? Join the call. If others are already in, you can Watch first instead.",
          side: "top",
          align: "center",
        },
      },
    ],
  },

  {
    id: "call-views",
    title: "Change your call view",
    description: "Switch between Grid, Presenter, and Spotlight.",
    category: "rooms",
    announce: { marker: TOUR_MARKER },
    // Contextual: only surfaces while you're in a call (the control bar exists).
    trigger: { element: '[data-tour="call-layout"]' },
    steps: [
      {
        element: '[data-tour="call-layout"]',
        popover: {
          title: "Your call layout",
          description:
            "Tap here to switch views: Grid shows everyone evenly, Presenter puts one person or a screen share front-and-centre with the rest in a strip, and Spotlight fills the screen with the active speaker.",
          side: "top",
          align: "center",
        },
      },
    ],
  },

  {
    id: "create-room",
    title: "Create a room",
    description: "Add a room to your office (admins & leads).",
    category: "rooms",
    prerequisite: (ctx) => (ctx.canManageRooms
      ? { ok: true }
      : { ok: false, reason: "Only admins and team leads can add rooms — ask an admin to set one up.", remedy: { type: "blocked" } }),
    entry: { to: "/team#rooms", await: '[data-tour="create-room"]' },
    steps: [
      {
        element: '[data-tour="create-room"]',
        popover: {
          title: "Add a room",
          description:
            "Create meeting rooms, department spaces, or private rooms here. You can set who can enter and even lock them with a code.",
          side: "bottom",
          align: "end",
        },
      },
    ],
  },

  // ── Collaboration ────────────────────────────────────────────────────────
  {
    id: "messaging",
    title: "Message your team",
    description: "Send DMs and use channels — outside of rooms.",
    category: "collaboration",
    announce: { marker: TOUR_MARKER },
    // The Messages button lives in the nav (always mounted), so no navigation
    // needed. Gated on having someone to message.
    prerequisite: (ctx) => ((ctx.teamMembers?.length || 0) > 1
      ? { ok: true }
      : { ok: false, reason: "Invite a teammate to your org first — then you can message them.", remedy: { type: "deep-link", to: "/team" } }),
    steps: [
      {
        element: '[aria-label="Messages"]',
        popover: {
          title: "Messages",
          description:
            "Direct messages, group chats, and team channels live here — reach anyone in your org without having to be in the same room.",
          side: "bottom",
          align: "end",
        },
      },
    ],
  },

  {
    id: "synced-pomodoro",
    title: "Focus together",
    description: "Run a synced pomodoro with your team.",
    category: "collaboration",
    prerequisite: (ctx) => (ctx.activeTeam
      ? { ok: true }
      : { ok: false, reason: "Join or create an org to sync focus sessions with others.", remedy: { type: "deep-link", to: "/team" } }),
    entry: { to: "/pomodoro", await: '[data-tour="pomodoro-sync"]' },
    steps: [
      {
        element: '[data-tour="pomodoro-sync"]',
        popover: {
          title: "Focus together",
          description:
            "Start or join a shared timer so your whole team focuses and breaks on the same countdown. Great for coworking and body-doubling.",
          side: "bottom",
          align: "end",
        },
      },
    ],
  },
];

export function getTour(id) {
  return TOURS.find((t) => t.id === id) || null;
}

// Tours whose trigger matches the current surface (path prefix or a present
// element). Pure-ish: element checks touch the DOM, so this lives with the
// registry rather than logic.js.
export function toursForSurface(pathname) {
  return TOURS.filter((t) => {
    if (!t.trigger) return false;
    if (t.trigger.path) return pathname === t.trigger.path || pathname.startsWith(`${t.trigger.path}/`);
    if (t.trigger.element && typeof document !== "undefined") return !!document.querySelector(t.trigger.element);
    return false;
  });
}
