import { useEffect, useRef } from "react";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { setWorkStatus } from "../lib/workStatus";
import { emitSelfNotification } from "../lib/notifications";

// Mirrors this user's outward presence signals (no UI):
//  • auto-detects the browser timezone into user_settings (mirrored to the
//    profile) so hover cards show their local time — UNLESS they've set it
//    manually (timezone_manual);
//  • projects the private clock (AppContext clockIn) into the team-visible
//    work_status row, so teammates see who's working / on a break.
export default function PresenceSync() {
  const { clockIn, session, settings, updateSettingsField } = useApp();
  const { activeTeamId } = useTeam();
  const userId = session?.user?.id;

  // Auto timezone → settings (skip when the user set it manually).
  useEffect(() => {
    if (!userId || settings?.timezoneManual) return;
    let tz = null;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { tz = null; }
    if (!tz || tz === settings?.timezone) return;
    updateSettingsField({ timezone: tz });
  }, [userId, settings?.timezoneManual, settings?.timezone, updateSettingsField]);

  // Nudge once a week (until set) to fill in working hours, so teammates know
  // your availability. Gated on settings being loaded (timezone present).
  useEffect(() => {
    if (!userId || !settings?.timezone) return; // wait for settings to load
    if (settings.workStart || settings.workEnd) return; // already set
    const week = Math.floor(Date.now() / (7 * 86400000));
    const k = `whnudge:${userId}:${week}`;
    try { if (localStorage.getItem(k)) return; } catch { return; }
    emitSelfNotification({
      type: "reminder",
      title: "Set your working hours",
      body: "Add your usual hours so teammates in other timezones know when you're around.",
      payload: { route: "/settings" },
      dedupeKey: `set_work_hours:${userId}:${week}`,
      dedupeWindowMinutes: 10080, // ~1 week
    }).then((data) => {
      if (data != null) {
        try { localStorage.setItem(k, "1"); } catch { /* */ }
      }
    });
  }, [userId, settings?.timezone, settings?.workStart, settings?.workEnd]);

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
