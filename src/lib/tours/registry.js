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
  { id: "rooms", label: "Rooms & calls" },
  { id: "collaboration", label: "Collaboration" },
  { id: "productivity", label: "Productivity" },
];

export const TOURS = [
  {
    id: "meet-pomodoro",
    title: "Your focus timer",
    description: "Find and open the pomodoro timer from anywhere.",
    category: "productivity",
    entry: { to: "/time-tracker", await: "[data-pomodoro-tab]" },
    steps: [
      {
        element: "[data-pomodoro-tab]",
        popover: {
          title: "Focus timer",
          description:
            "This tab is always here on the right. Click it any time to start a focus session or check the time left — it follows you across the app.",
          side: "left",
          align: "center",
        },
      },
    ],
  },

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
          description: "Every room is a space you can drop into for focused work or a video call. Let's look at one.",
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
    entry: { to: "/team#office", await: '[data-tour="create-room"]' },
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
