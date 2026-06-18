import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { useApp } from "../context/AppContext";
import { useSyncSession } from "../context/SyncSessionContext";
import { useTeam } from "../context/TeamContext";
import { USER_SOUND_PREFIX, TEAM_SOUND_PREFIX } from "../lib/pomodoroSound";
import { getEngine, destroyEngine } from "./engine/createEngine.js";
import { isElectronPopover } from "./engine/electronTimerBridge.js";

const PomodoroContext = createContext(null);

export function PomodoroProvider({ userId, children, forceSlave = false }) {
  const appCtx = useApp();
  const teamCtx = useTeam();
  const { syncSession, leaveSession } = useSyncSession();

  const customSoundUrl = appCtx?.settings?.pomodoroSoundUrl || "";
  const customSoundsByPresetId = useMemo(() => {
    const map = {};
    for (const s of appCtx?.settings?.customSounds || []) {
      if (s?.url) map[`${USER_SOUND_PREFIX}${s.id}`] = { url: s.url, name: s.name };
    }
    for (const s of teamCtx?.teamSounds || []) {
      if (s?.url) map[`${TEAM_SOUND_PREFIX}${s.id}`] = { url: s.url, name: s.name };
    }
    return map;
  }, [appCtx?.settings?.customSounds, teamCtx?.teamSounds]);

  const engine = useMemo(() => (userId ? getEngine(userId) : null), [userId]);

  useEffect(() => {
    if (!engine) return;
    engine.configure({
      syncSession,
      leaveSession,
      customSoundUrl,
      customSoundsByPresetId,
      activeTeamId: teamCtx?.activeTeamId,
      userCustomSounds: appCtx?.settings?.customSounds || [],
      teamSounds: teamCtx?.teamSounds || [],
    });
  }, [
    engine,
    syncSession,
    leaveSession,
    customSoundUrl,
    customSoundsByPresetId,
    teamCtx?.activeTeamId,
    appCtx?.settings?.customSounds,
    teamCtx?.teamSounds,
  ]);

  useEffect(() => {
    if (!engine) return;
    engine.attach({ forceSlave: forceSlave || isElectronPopover() });
    return () => {
      engine.detach();
      destroyEngine();
    };
  }, [engine, forceSlave]);

  const snapshot = useSyncExternalStore(
    (cb) => (engine ? engine.subscribe(cb) : () => {}),
    () => (engine ? engine.getSnapshot() : null),
    () => (engine ? engine.getSnapshot() : null),
  );

  if (!engine) return null;

  return (
    <PomodoroContext.Provider value={snapshot}>{children}</PomodoroContext.Provider>
  );
}

export function usePomodoro() {
  const ctx = useContext(PomodoroContext);
  if (!ctx) {
    throw new Error("usePomodoro must be used within PomodoroProvider");
  }
  return ctx;
}
