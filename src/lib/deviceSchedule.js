// Kiosk sleep schedule math. A device sleeps outside its active window (local
// wall-clock + active days), with manual asleep_until / awake_until overrides
// that win until they expire. All evaluated against the device's OWN local time.

export function parseHm(t) {
  if (!t) return null;
  const [h, m] = String(t).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

// Is `d` inside the schedule's active window? No time window = active all day on
// active days. No schedule at all (no window, no days) = always active.
export function inActiveWindow(sched, d) {
  const days = sched?.active_days;
  if (Array.isArray(days) && days.length && !days.includes(d.getDay())) return false;
  const s = parseHm(sched?.active_start);
  const e = parseHm(sched?.active_end);
  if (s == null || e == null) return true; // day-only (or no) schedule
  const cur = d.getHours() * 60 + d.getMinutes();
  return s <= e ? (cur >= s && cur < e) : (cur >= s || cur < e); // s>e = overnight
}

// Should the kiosk be asleep right now? Manual override (absolute, self-expiring)
// beats the schedule.
export function isAsleep(sched, now = new Date()) {
  if (!sched) return false;
  const awake = sched.awake_until && new Date(sched.awake_until);
  if (awake && now < awake) return false;
  const asleep = sched.asleep_until && new Date(sched.asleep_until);
  if (asleep && now < asleep) return true;
  return !inActiveWindow(sched, now);
}

// Next minute the schedule flips to `targetActive`. Steps minute-by-minute up to
// 8 days; returns null if it never does (e.g. no schedule → never sleeps; no
// active days → never wakes), so callers can fall back to "indefinite".
function nextBoundary(sched, targetActive, now = new Date()) {
  const d = new Date(now);
  d.setSeconds(0, 0);
  for (let i = 0; i < 8 * 24 * 60; i++) {
    d.setMinutes(d.getMinutes() + 1);
    if (inActiveWindow(sched, d) === targetActive) return new Date(d);
  }
  return null;
}

// "Go offline" → asleep until the next time the schedule would wake it. No
// schedule → ~indefinite (a year out; tap to wake clears it).
export function nextWakeAt(sched, now = new Date()) {
  return nextBoundary(sched, true, now) || new Date(now.getTime() + 365 * 24 * 3600 * 1000);
}

// "Wake" → awake until the next time the schedule would sleep it. Always-active
// (no schedule) → ~indefinite.
export function nextSleepAt(sched, now = new Date()) {
  return nextBoundary(sched, false, now) || new Date(now.getTime() + 365 * 24 * 3600 * 1000);
}

// A short "back at 8:00 AM" / "until 6:00 PM" label for the sleep/awake screen.
export function clockLabel(date) {
  if (!date) return "";
  const within = date.getTime() - Date.now() < 360 * 24 * 3600 * 1000; // not the indefinite sentinel
  if (!within) return "";
  return new Date(date).toLocaleTimeString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}
