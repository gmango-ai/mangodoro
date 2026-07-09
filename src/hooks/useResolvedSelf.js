import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { usePomodoro } from "../pomodoro/PomodoroContext";
import { buildSignals } from "../lib/presenceSignals";
import { resolveStatus } from "../lib/statusResolver";
import { readOverride, readPin, OVERRIDE_EVENT } from "../lib/statusOverride";

// Live resolved status for the current user. Recomputes on context changes and
// on a 15s heartbeat (so idle transitions + override expiry surface without a
// prop change). Shared by the nav StatusChip (display) and PresenceResolver
// (persistence) so both read ONE computation; all the real logic is in the pure
// resolver. Reads localStorage the same way IdlePresence writes it.

const ACT_KEY = "mango:lastActivity";
const getNum = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v ? Number(v) : d;
  } catch {
    return d;
  }
};

export function useResolvedSelf() {
  const { session, clockIn, currentTask } = useApp();
  const { activeTeamId, rooms } = useTeam();
  const { syncSession } = useSyncSession();
  const pomodoro = usePomodoro();

  // Heartbeat so time-based transitions (idle, override expiry) surface, plus an
  // immediate re-read when the manual override, pin, or network state changes.
  const [, bump] = useState(0);
  useEffect(() => {
    const id = setInterval(() => bump((n) => n + 1), 15000);
    const onBump = () => bump((n) => n + 1);
    window.addEventListener(OVERRIDE_EVENT, onBump);
    window.addEventListener("storage", onBump);
    window.addEventListener("online", onBump);
    window.addEventListener("offline", onBump);
    return () => {
      clearInterval(id);
      window.removeEventListener(OVERRIDE_EVENT, onBump);
      window.removeEventListener("storage", onBump);
      window.removeEventListener("online", onBump);
      window.removeEventListener("offline", onBump);
    };
  }, []);

  const room = syncSession?.room_id ? rooms?.find((r) => r.id === syncSession.room_id) : null;
  const now = Date.now();
  // Real liveness: network down → offline. (Tab-close / sleep can't be reported
  // by a dead client — the server sweep handles those in P3.) `navigator.onLine`
  // is unavailable during SSR, so default to online.
  const online = typeof navigator === "undefined" || navigator.onLine !== false;
  const resolved = resolveStatus({
    ...buildSignals({
      clockIn,
      currentTask,
      room,
      pomodoro: pomodoro ? { isRunning: pomodoro.isRunning, mode: pomodoro.mode } : null,
      lastActivityMs: getNum(ACT_KEY, now),
      online,
      now,
    }),
    override: readOverride(now),
    autoPinUntil: readPin(now),
  });

  // Track when the current availability began, for the display `since`.
  const sinceRef = useRef({ avail: null, sinceMs: null });
  const sr = sinceRef.current;
  if (resolved.availability !== sr.avail) {
    sr.avail = resolved.availability;
    sr.sinceMs = now;
  }
  resolved.since = sr.sinceMs ?? now;

  return { resolved, userId: session?.user?.id, teamId: activeTeamId, room };
}
