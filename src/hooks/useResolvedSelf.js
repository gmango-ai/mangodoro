import { useEffect, useRef, useState } from "react";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { usePomodoro } from "../pomodoro/PomodoroContext";
import { buildSignals } from "../lib/presenceSignals";
import { resolveStatus } from "../lib/statusResolver";

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
  const { session, settings, clockIn, currentTask } = useApp();
  const { activeTeamId, rooms } = useTeam();
  const { syncSession } = useSyncSession();
  const pomodoro = usePomodoro();

  // Heartbeat so time-based transitions (idle, override expiry) surface.
  const [, bump] = useState(0);
  useEffect(() => {
    const id = setInterval(() => bump((n) => n + 1), 15000);
    return () => clearInterval(id);
  }, []);

  const room = syncSession?.room_id ? rooms?.find((r) => r.id === syncSession.room_id) : null;
  const now = Date.now();
  const resolved = resolveStatus(
    buildSignals({
      clockIn,
      currentTask,
      room,
      pomodoro: pomodoro ? { isRunning: pomodoro.isRunning, mode: pomodoro.mode } : null,
      presenceState: settings?.presenceState,
      lastActivityMs: getNum(ACT_KEY, now),
      online: true,
      now,
    })
  );

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
