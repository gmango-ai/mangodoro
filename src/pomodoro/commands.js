import { supabase } from "../supabase.js";
import { stopCompletionSound } from "../lib/pomodoroSound.js";
import { remoteUpdatedAtMs } from "./derive.js";

// Best-effort: push the new running state to the activity-push edge function
// so the user's Live Activities on OTHER devices update via APNs even when
// that device's app is backgrounded (fixes "paused on the browser but the
// phone's Live Activity didn't update until I opened the app"). When `ended`
// is set, the function sends an APNs "end" push instead — this is how a reset
// on web/desktop dismisses the phone's lingering Live Activity. Fire-and-
// forget — never blocks or fails the flush; no-ops server-side if the user
// has no registered Live Activity.
function pushCrossDeviceLiveActivity({ isRunning, endsAtMs, pausedSecondsLeft, ended = false, mode, isSynced = false }) {
  try {
    supabase.functions
      .invoke("activity-push", {
        // mode / isSynced let the silent home-widget push carry enough to
        // render even when the user has no Live Activity to merge onto.
        body: { ended, isRunning, endsAtMs: endsAtMs ?? undefined, pausedSecondsLeft, mode, isSynced },
      })
      .catch(() => { /* best-effort */ });
  } catch { /* best-effort */ }
}

export async function flushToServer({
  userId,
  syncSession,
  latestRef,
  endsAtMsRef,
  suppressRemoteUntilRef,
  lastLocalWriteAtMsRef,
  override = {},
}) {
  if (!userId) return null;
  const base = latestRef.current;
  suppressRemoteUntilRef.current = Date.now() + 450;

  // Reset / mode-switch / custom-duration set this so the cross-device push
  // dismisses other devices' Live Activities instead of just pausing them.
  // It's a push-only signal — never written to the DB payload below.
  const clearActivity = override.ended === true;

  const canWriteSync = syncSession && syncSession.controller_id === userId;
  if (canWriteSync) {
    const payload = {
      mode: override.mode ?? base.mode,
      sessions: override.sessions ?? base.sessions,
      is_running: override.is_running ?? base.isRunning,
      remaining_seconds: Math.max(0, override.remaining_seconds ?? base.secondsLeft),
      pending_mode: Object.prototype.hasOwnProperty.call(override, "pending_mode")
        ? override.pending_mode
        : base.pendingMode,
    };
    if (Object.prototype.hasOwnProperty.call(override, "durations")) {
      payload.durations = override.durations;
    }
    if (Object.prototype.hasOwnProperty.call(override, "auto_transition")) {
      payload.auto_transition = override.auto_transition;
    }
    const { data, error } = await supabase
      .from("sync_sessions")
      .update(payload)
      .eq("id", syncSession.id)
      .select()
      .single();
    if (error) {
      console.warn("sync session flush:", error.message);
      return null;
    }
    if (data?.ends_at) endsAtMsRef.current = new Date(data.ends_at).getTime();
    else endsAtMsRef.current = null;
    const writeMs = remoteUpdatedAtMs(data);
    if (writeMs != null) lastLocalWriteAtMsRef.current = writeMs;
    pushCrossDeviceLiveActivity({
      ended: clearActivity,
      isRunning: payload.is_running,
      endsAtMs: data?.ends_at ? new Date(data.ends_at).getTime() : null,
      pausedSecondsLeft: payload.remaining_seconds,
      mode: payload.mode,
      isSynced: true,
    });
    return data;
  }

  if (!syncSession) {
    const payload = {
      user_id: userId,
      mode: override.mode ?? base.mode,
      sessions: override.sessions ?? base.sessions,
      is_running: override.is_running ?? base.isRunning,
      remaining_seconds: Math.max(0, override.remaining_seconds ?? base.secondsLeft),
      pending_mode: Object.prototype.hasOwnProperty.call(override, "pending_mode")
        ? override.pending_mode
        : base.pendingMode,
    };
    if (Object.prototype.hasOwnProperty.call(override, "durations")) {
      payload.durations = override.durations;
    }
    if (Object.prototype.hasOwnProperty.call(override, "auto_transition")) {
      payload.auto_transition = override.auto_transition;
    }
    const { data, error } = await supabase
      .from("user_pomodoro_state")
      .upsert(payload, { onConflict: "user_id" })
      .select()
      .single();
    if (error) {
      console.warn("pomodoro sync:", error.message);
      return null;
    }
    if (data?.ends_at) endsAtMsRef.current = new Date(data.ends_at).getTime();
    else endsAtMsRef.current = null;
    const writeMs = remoteUpdatedAtMs(data);
    if (writeMs != null) lastLocalWriteAtMsRef.current = writeMs;
    pushCrossDeviceLiveActivity({
      ended: clearActivity,
      isRunning: payload.is_running,
      endsAtMs: data?.ends_at ? new Date(data.ends_at).getTime() : null,
      pausedSecondsLeft: payload.remaining_seconds,
      mode: payload.mode,
      isSynced: false,
    });
    return data;
  }

  return null;
}

export async function commitToPhase({
  nextMode,
  sessionsVal,
  autoStart,
  durationsRef,
  flushDeps,
  setters,
  markUserMutated,
  completionHandledRef,
}) {
  stopCompletionSound();
  completionHandledRef.current = null;
  markUserMutated();
  const d = durationsRef.current;
  const secs = d[nextMode];
  setters.setMode(nextMode);
  setters.setPendingMode(null);
  setters.setSecondsLeft(secs);
  setters.setIsRunning(autoStart);
  flushDeps.endsAtMsRef.current = null;
  await flushToServer({
    ...flushDeps,
    override: {
      mode: nextMode,
      pending_mode: null,
      remaining_seconds: secs,
      is_running: autoStart,
      sessions: sessionsVal,
    },
  });
}

export async function beginTransition({
  nextBreak,
  sessionsVal,
  transitionSeconds,
  flushDeps,
  setters,
  markUserMutated,
  completionHandledRef,
}) {
  stopCompletionSound();
  completionHandledRef.current = null;
  markUserMutated();
  setters.setPendingMode(nextBreak);
  setters.setSecondsLeft(transitionSeconds);
  setters.setIsRunning(true);
  flushDeps.endsAtMsRef.current = null;
  await flushToServer({
    ...flushDeps,
    override: {
      pending_mode: nextBreak,
      remaining_seconds: transitionSeconds,
      is_running: true,
      sessions: sessionsVal,
    },
  });
}
