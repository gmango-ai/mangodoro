// A local, device-side record of your presence through the day — built to
// *verify* the resolver's active/away/offline detection is working. The hook
// samples the resolved availability on a heartbeat; between heartbeats that are
// too far apart (tab closed) we infer "offline". Pure here; localStorage IO is
// in usePresenceTimeline.

// Missing this long between samples ⇒ the tab was gone ⇒ offline.
export const GAP_MS = 120_000; // 2 missed 60s heartbeats

// Collapse the rich availability vocabulary onto the three states asked for.
const ACTIVE = new Set(["available", "pairing", "focusing", "in_meeting"]);
const AWAY = new Set(["away", "lunch", "commuting", "off"]);
export function presenceClass(a) {
  if (ACTIVE.has(a)) return "active";
  if (AWAY.has(a)) return "away";
  return "offline"; // 'offline' + anything unknown
}

export function todayKey(now) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Fold a new sample into the day's segment list. Returns a NEW array (segments
// are {start, end, a}). Extends the current run, closes+opens on a state change,
// and inserts an explicit 'offline' segment when the gap since the last sample
// is too large (the tab was closed).
export function appendSample(segments, availability, now, gapMs = GAP_MS) {
  const segs = (segments || []).map((s) => ({ ...s }));
  const last = segs[segs.length - 1];

  if (!last) {
    segs.push({ start: now, end: now, a: availability });
    return segs;
  }
  if (now < last.end) return segs; // clock skew / stale — ignore

  if (now - last.end > gapMs) {
    segs.push({ start: last.end, end: now, a: "offline" });
    segs.push({ start: now, end: now, a: availability });
    return segs;
  }
  if (last.a === availability) {
    last.end = now;
    return segs;
  }
  last.end = now;
  segs.push({ start: now, end: now, a: availability });
  return segs;
}

// Total ms per class across the day.
export function computeTotals(segments) {
  const t = { active: 0, away: 0, offline: 0 };
  for (const s of segments || []) {
    t[presenceClass(s.a)] += Math.max(0, s.end - s.start);
  }
  return t;
}
