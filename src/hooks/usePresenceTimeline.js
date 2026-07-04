import { useEffect, useState } from "react";
import { appendSample, computeTotals, todayKey } from "../lib/presenceTimeline";

// Device-local presence timeline (active/away/offline through the day) — a
// verification tool for the resolver. Recording is driven from the always-
// mounted PresenceResolver (so it accrues on every page, not just the profile);
// the profile surface only reads it.

const storeKey = (dayKey) => `mango:presenceTimeline:${dayKey}`;
const read = (k) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : [];
  } catch {
    return [];
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* quota / private mode — best-effort */
  }
};

// Fold one presence sample into today's log. Called from PresenceResolver's tick.
export function recordPresenceSample(availability, now = Date.now()) {
  if (!availability) return;
  const k = storeKey(todayKey(now));
  write(k, appendSample(read(k), availability, now));
}

// Read-only view for the profile timeline; refreshes on a light interval.
export function usePresenceTimeline() {
  const [segments, setSegments] = useState(() => read(storeKey(todayKey(Date.now()))));
  useEffect(() => {
    const load = () => setSegments(read(storeKey(todayKey(Date.now()))));
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);
  return { segments, totals: computeTotals(segments) };
}
