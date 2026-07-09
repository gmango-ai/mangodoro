// Manual status override — the user-asserted status that wins over derivation.
// Stored in localStorage so it takes effect instantly and works offline / before
// the user_presence table is live (the resolver reads it every tick). The
// setter also mirrors it to user_presence for cross-device / teammate
// visibility once that table exists. A window event lets open surfaces re-read
// immediately instead of waiting for the next heartbeat.

const KEY = "mango:statusOverride";
export const OVERRIDE_EVENT = "mango:statusOverride";

// { availability, message?, expiresAt? } | null. Auto-clears once expired.
export function readOverride(now = Date.now()) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const ov = JSON.parse(raw);
    if (!ov?.availability) return null;
    if (ov.expiresAt && ov.expiresAt <= now) {
      localStorage.removeItem(KEY);
      return null;
    }
    return ov;
  } catch {
    return null;
  }
}

export function writeOverride(ov) {
  try { localStorage.setItem(KEY, JSON.stringify(ov)); } catch { /* */ }
  try { window.dispatchEvent(new Event(OVERRIDE_EVENT)); } catch { /* */ }
}

export function clearOverride() {
  try { localStorage.removeItem(KEY); } catch { /* */ }
  try { window.dispatchEvent(new Event(OVERRIDE_EVENT)); } catch { /* */ }
}

// Auto-state pin ("keep my status"): while set + unexpired, idle→away won't
// override the manual/derived intent. Stored as an epoch-ms deadline; the
// setter (P5 UI) uses now + 24h so it auto-re-enables after a day.
const PIN_KEY = "mango:autoPin";

export function readPin(now = Date.now()) {
  try {
    const raw = localStorage.getItem(PIN_KEY);
    if (!raw) return null;
    const until = Number(raw);
    if (!until || until <= now) {
      localStorage.removeItem(PIN_KEY);
      return null;
    }
    return until;
  } catch {
    return null;
  }
}

export function writePin(until) {
  try { localStorage.setItem(PIN_KEY, String(until)); } catch { /* */ }
  try { window.dispatchEvent(new Event(OVERRIDE_EVENT)); } catch { /* */ }
}

export function clearPin() {
  try { localStorage.removeItem(PIN_KEY); } catch { /* */ }
  try { window.dispatchEvent(new Event(OVERRIDE_EVENT)); } catch { /* */ }
}
