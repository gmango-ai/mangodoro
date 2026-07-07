// Preference: what to do with your MANUAL status when a Pomodoro phase (focus
// or break) ends. Device-local behavior preference, so no migration.
//   "off"   — leave it as-is
//   "clear" — auto-clear your manual status (back to auto-derived)
//   "ask"   — pop a quick prompt to clear / update it
const KEY = "mango:statusOnCycle";
export const STATUS_CYCLE_EVENT = "mango:statusOnCycle";

export function readStatusOnCycle() {
  try { return localStorage.getItem(KEY) || "off"; } catch { return "off"; }
}

export function writeStatusOnCycle(v) {
  try { localStorage.setItem(KEY, v || "off"); } catch { /* */ }
  try { window.dispatchEvent(new Event(STATUS_CYCLE_EVENT)); } catch { /* */ }
}
