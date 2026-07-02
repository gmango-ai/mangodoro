import { useEffect, useRef } from "react";
import { useApp } from "../../context/AppContext";
import { useTeam } from "../../context/TeamContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { useMessages } from "../../context/MessagesContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import { listTeamGoals } from "../../lib/goals";

// Invisible, always-mounted observer that flips getting-started checklist flags
// from REAL app activity — not from tour completion. Mounted inside every app
// provider (AppLayout) so it catches "started a focus session" / "entered a
// room" wherever they happen, not just on the office page where the checklist
// card renders. Flags persist in settings.onboarding.checklist and sync across
// devices via AppContext realtime. Each flag is written at most once (guarded by
// the current value) so this can't write-loop.
export default function OnboardingFactTracker() {
  const { settings, session, dataLoaded, setChecklistItem } = useApp();
  const { activeTeamId } = useTeam();
  const { syncSession } = useSyncSession();
  const { conversations } = useMessages();
  const pomo = usePomodoro();
  const cl = settings?.onboarding?.checklist || {};

  // Entered a room = currently in a room-bound sync session.
  useEffect(() => {
    if (syncSession?.room_id && !cl.room) setChecklistItem("room");
  }, [syncSession?.room_id, cl.room, setChecklistItem]);

  // Started a focus session = pomodoro running a work phase.
  useEffect(() => {
    if (pomo?.isRunning && pomo?.mode === "work" && !cl.focus) setChecklistItem("focus");
  }, [pomo?.isRunning, pomo?.mode, cl.focus, setChecklistItem]);

  // Messaged a teammate = a conversation exists.
  useEffect(() => {
    if ((conversations?.length || 0) > 0 && !cl.message) setChecklistItem("message");
  }, [conversations?.length, cl.message, setChecklistItem]);

  // Set a goal — one-time historical probe (goal creation happens off the
  // office page, so there's no live signal to piggyback). Any goal owned by me
  // in the active org counts. Runs once per org once settings have loaded.
  const goalProbedFor = useRef(null);
  useEffect(() => {
    if (!dataLoaded || !activeTeamId || !session?.user?.id) return;
    if (cl.goal) return;
    if (goalProbedFor.current === activeTeamId) return;
    goalProbedFor.current = activeTeamId;
    listTeamGoals(activeTeamId).then(({ data }) => {
      if ((data || []).some((g) => g.owner_id === session.user.id)) setChecklistItem("goal");
    }).catch(() => { /* probe is best-effort */ });
  }, [dataLoaded, activeTeamId, session?.user?.id, cl.goal, setChecklistItem]);

  return null;
}
