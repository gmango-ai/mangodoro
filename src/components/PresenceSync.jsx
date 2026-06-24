import { useEffect, useRef } from "react";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { updateMyProfile } from "../lib/profiles";
import { setWorkStatus } from "../lib/workStatus";

// Mirrors this user's outward presence signals (no UI):
//  • captures the browser timezone into their profile (once per tz), so hover
//    cards can show their local time;
//  • projects the private clock (AppContext clockIn) into the team-visible
//    work_status row, so teammates see who's working / on a break.
export default function PresenceSync() {
  const { clockIn, session } = useApp();
  const { activeTeamId } = useTeam();
  const userId = session?.user?.id;

  // Timezone → profile (write only when it changes / first seen).
  useEffect(() => {
    if (!userId) return;
    let tz = null;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { tz = null; }
    if (!tz) return;
    const k = `tz_synced:${userId}`;
    try { if (localStorage.getItem(k) === tz) return; } catch { /* */ }
    updateMyProfile(userId, { timezone: tz }).then(({ error }) => {
      if (!error) { try { localStorage.setItem(k, tz); } catch { /* */ } }
    });
  }, [userId]);

  // Clock → work_status (debounced, deduped on a signature).
  const lastRef = useRef("");
  useEffect(() => {
    if (!userId) return undefined;
    const clockedInAt = clockIn?.start && clockIn?.date
      ? (() => { try { return new Date(`${clockIn.date}T${clockIn.start}:00`).toISOString(); } catch { return null; } })()
      : null;
    const onBreak = !!clockIn?.activeBreak;
    const task = clockIn?.description || "";
    const sig = `${clockedInAt}|${onBreak}|${task}|${activeTeamId || ""}`;
    if (sig === lastRef.current) return undefined;
    lastRef.current = sig;
    const id = setTimeout(() => {
      setWorkStatus({ userId, teamId: activeTeamId || null, clockedInAt, onBreak, task });
    }, 600);
    return () => clearTimeout(id);
  }, [userId, clockIn, activeTeamId]);

  return null;
}
