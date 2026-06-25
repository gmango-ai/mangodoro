// Timezone + availability helpers for the hover card / profile (and a future
// team timezone strip). Pure formatting over a person's IANA timezone +
// optional working hours (HH:MM[:SS] strings).

// All IANA zones for a picker (fallback to a tiny list on old engines).
export const TIMEZONES = (() => {
  try { return Intl.supportedValuesOf("timeZone"); }
  catch { return ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Kolkata", "Asia/Tokyo", "Australia/Sydney"]; }
})();

export function browserTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; }
}

// Short zone label like "EDT" / "GMT+2" for the current moment.
export function tzAbbrev(tz) {
  if (!tz) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value || null;
  } catch { return null; }
}

// Is `today` (in `tz`, or the viewer's local date when omitted) within an OOO
// [start,end] (date strings, inclusive)?
export function isOutOfOffice(start, end, tz) {
  if (!start && !end) return false;
  let today;
  if (tz) {
    try {
      today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
    } catch {
      today = new Date().toLocaleDateString("en-CA");
    }
  } else {
    today = new Date().toLocaleDateString("en-CA");
  }
  if (start && today < start) return false;
  if (end && today > end) return false;
  return true;
}

export function localTimeLabel(tz) {
  if (!tz) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date());
  } catch { return null; }
}

// Minutes-into-the-day in the given timezone right now (0–1439), or null.
export function localMinutes(tz) {
  if (!tz) return null;
  try {
    const s = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    const [h, m] = s.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  } catch { return null; }
}

export function parseHm(t) {
  if (!t) return null;
  const [h, m] = String(t).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

// Current weekday (0=Sun..6=Sat) in the given timezone, or null.
export function localWeekday(tz) {
  if (!tz) return null;
  try {
    const s = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date());
    const i = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(s);
    return i < 0 ? null : i;
  } catch { return null; }
}

// { label, badge } — badge is "off hours" | "wrapping up" | null. Off-hours if
// today isn't a working day (when workDays is set) or local time is outside
// working hours. workDays = array of 0–6, or null = no day filter.
export function availability(tz, workStart, workEnd, workDays) {
  const label = localTimeLabel(tz);
  const lm = localMinutes(tz);
  const ws = parseHm(workStart);
  const we = parseHm(workEnd);

  if (Array.isArray(workDays) && workDays.length) {
    const wd = localWeekday(tz);
    if (wd != null && !workDays.includes(wd)) return { label, badge: "off hours" };
  }

  let badge = null;
  if (lm != null && ws != null && we != null && ws !== we) {
    const off = ws < we ? (lm < ws || lm >= we) : (lm < ws && lm >= we); // overnight-safe
    if (off) badge = "off hours";
    else if (we - lm > 0 && we - lm <= 30) badge = "wrapping up";
  }
  return { label, badge };
}
