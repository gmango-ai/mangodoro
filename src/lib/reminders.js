// Built-in wellbeing / break reminders. Each is an interval nudge the client
// fires (HealthReminders) during the user's active hours, routed through the
// notification layer as the shared `reminder` type. Per-reminder config
// (on + every) lives in user_settings.wellbeing_reminders.
export const REMINDERS = [
  { key: "hydration", label: "Hydration",   emoji: "💧", title: "Time to hydrate",  body: "Take a sip of water 💧",                    defaultEvery: 60 },
  { key: "move",      label: "Move",        emoji: "🧍", title: "Stand up & move",  body: "Stretch your legs for a minute 🧍",         defaultEvery: 60 },
  { key: "eyes",      label: "Eye rest",    emoji: "👀", title: "Rest your eyes",   body: "20·20·20 — look 20ft away for 20 seconds 👀", defaultEvery: 20 },
  { key: "posture",   label: "Posture",     emoji: "🪑", title: "Posture check",    body: "Sit up tall, relax your shoulders 🪑",       defaultEvery: 90 },
  { key: "stretch",   label: "Stretch",     emoji: "🤸", title: "Stretch break",    body: "Roll your neck and shoulders 🤸",            defaultEvery: 120 },
  { key: "breathe",   label: "Breathe",     emoji: "🌬️", title: "Take a breath",    body: "Three slow breaths 🌬️",                     defaultEvery: 120 },
];

export const REMINDER_INTERVALS = [20, 30, 45, 60, 90, 120, 180];

export const REMINDER_DEFAULT_START = "09:00";
export const REMINDER_DEFAULT_END = "17:00";

// One reminder's effective config: { on, every } with the registry default.
export function reminderConfig(reminders, key) {
  const def = REMINDERS.find((r) => r.key === key);
  const c = reminders?.[key] || {};
  return { on: !!c.on, every: c.every || def?.defaultEvery || 60 };
}
