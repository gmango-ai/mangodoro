// Declarative tour registry. Each tour is data — the engine (engine.js) turns it
// into a driver.js run, and TourContext gates it on `prerequisite(ctx)`. Adding a
// tutorial is a code-only change (state lives in the single settings.onboarding
// jsonb). This file is intentionally lean in Phase 1 (foundation); Phases 3 & 5
// fill in the room/call/collaboration tours.
//
// Tour shape:
//   { id, title, description, category,
//     prerequisite?: (ctx) => ({ ok } | { ok:false, reason, remedy }),
//     entry?: { to, await },          // navigate + wait before step 0
//     announce?: { marker },          // "new feature" nudge (WhatsNew-style)
//     steps: [ { element, popover:{title,description,side,align}, when?(ctx), onNext?(ctx) } ] }
//
// Selectors prefer existing stable hooks (data-*, aria-label, role, ids); new
// `data-tour="..."` anchors are added surface-by-surface as tours land.

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
    // Solo feature — no org required. The FAB is a global overlay on every page
    // except /pomodoro, so send the user somewhere it's visible first.
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
];

export function getTour(id) {
  return TOURS.find((t) => t.id === id) || null;
}
