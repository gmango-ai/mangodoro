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

// Today's schedule entry for a profile: { start, end, loc } if a work day,
// null if a day off, or undefined if no schedule is configured at all.
// Prefers the per-day work_schedule; falls back to the legacy single hours+days.
function scheduleForToday(p) {
  const tz = p?.timezone;
  const wd = localWeekday(tz);
  const sched = p?.work_schedule;
  if (sched && typeof sched === "object" && Object.keys(sched).length) {
    if (wd == null) return undefined;
    return sched[String(wd)] || null;
  }
  const ws = p?.work_start, we = p?.work_end, days = p?.work_days;
  if (!ws && !we && (!days || !days.length)) return undefined;
  if (Array.isArray(days) && days.length && wd != null && !days.includes(wd)) return null;
  if (ws || we) return { start: ws, end: we, loc: null };
  return undefined;
}

// Availability for a profile-like object (timezone + work_schedule|legacy hours).
// { label, badge, loc } — badge is "off hours" | "wrapping up" | null; loc is
// "office" | "home" | null for today.
export function availability(p) {
  const tz = p?.timezone;
  const label = localTimeLabel(tz);
  const today = scheduleForToday(p);
  if (today === undefined) return { label, badge: null, loc: null };
  if (today === null) return { label, badge: "off hours", loc: null }; // day off
  const lm = localMinutes(tz);
  const ws = parseHm(today.start), we = parseHm(today.end);
  let badge = null;
  if (lm != null && ws != null && we != null && ws !== we) {
    const off = ws < we ? (lm < ws || lm >= we) : (lm < ws && lm >= we);
    if (off) badge = "off hours";
    else if (we - lm > 0 && we - lm <= 30) badge = "wrapping up";
  }
  return { label, badge, loc: today.loc || null };
}

// The OOO range covering today (from the ranges list, else the legacy single), or null.
export function isOutOfOfficeAny(p) {
  const today = new Date().toLocaleDateString("en-CA");
  const ranges = Array.isArray(p?.ooo_ranges) ? p.ooo_ranges : [];
  for (const r of ranges) {
    if (!r) continue;
    if (!r.start && !r.end) continue;
    if ((!r.start || today >=UserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesateUserChoicesate.png
  if (isOutOfOffice(p?.ooo_start, p?.ooo_end)) return { start: p?.ooo_start, end: p?.ooo_end, note: p?.ooo_note };
  return null;
}
