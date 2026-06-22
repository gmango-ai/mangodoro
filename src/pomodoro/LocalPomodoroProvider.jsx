import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { PomodoroContext } from "./PomodoroContext";
import { createElectronTimerBridge } from "./engine/electronTimerBridge";
import { DEFAULT_DURATIONS, defaultBreakForStreak } from "./constants";
import { playCompletionSound, warmupAudioContext } from "../lib/pomodoroSound";
import { startPersistentTimer, stopPersistentTimer } from "../lib/persistentTimer";

// A no-account pomodoro that is SHARED across windows — crucially the Electron
// main window and the menubar popover, and also browser tabs. Exposes the
// usePomodoro() shape with sync/collab fields stubbed, so the shared timer
// components render exactly as in the signed-in app.
//
// Why two transports? Electron BrowserWindows are isolated — localStorage is
// shared at rest but `storage`/BroadcastChannel events don't cross windows. So:
//
//   • Electron: reuse the existing IPC timer bridge (the same one the signed-in
//     engine uses). The MAIN window is the authoritative timer — it ticks,
//     completes, rings, and publishes its state; the popover is a FOLLOWER that
//     mirrors that state and forwards control taps as commands. No Electron
//     source changes — the bridge already relays main↔popover.
//   • Web: peer-to-peer across tabs via BroadcastChannel (+ storage fallback);
//     every tab runs the timer and derives the same countdown from the shared
//     absolute `deadline`.
//
// Either way the wire payload is the discrete state { mode, sessions, isRunning,
// deadline, remaining }. A running timer is an absolute `deadline`, so each
// window derives the live countdown locally with no per-tick chatter. The chime
// is fired per-window and de-dupes naturally: only the window whose audio the
// user actually unlocked produces sound.

const LOCAL_KEY = "ql_local_timer_v1";
const CHANNEL = "ql_local_timer";

function loadSaved() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && typeof s === "object" && DEFAULT_DURATIONS[s.mode] != null) return s;
  } catch {
    /* ignore corrupt / unavailable storage */
  }
  return null;
}

function initState() {
  const saved = loadSaved();
  const mode = saved && DEFAULT_DURATIONS[saved.mode] != null ? saved.mode : "work";
  const sessions = Number.isFinite(saved?.sessions) ? saved.sessions : 0;
  const running = !!(saved?.running && saved?.deadline && saved.deadline > Date.now());
  const remaining = Number.isFinite(saved?.remaining) ? saved.remaining : DEFAULT_DURATIONS[mode];
  return {
    mode,
    sessions,
    isRunning: running,
    deadline: running ? saved.deadline : null,
    remaining,
    completedDeadline: 0, // bumps to the just-elapsed deadline → triggers the chime (never persisted)
  };
}

function sameDiscrete(a, b) {
  return (
    a.mode === b.mode &&
    a.sessions === b.sessions &&
    a.isRunning === b.isRunning &&
    a.deadline === b.deadline &&
    a.remaining === b.remaining
  );
}

// Exported for unit tests — the cross-window sync correctness lives here.
export function reducer(state, action) {
  switch (action.type) {
    case "toggle": {
      if (state.isRunning) {
        const remaining =
          state.deadline != null
            ? Math.max(0, Math.ceil((state.deadline - action.now) / 1000))
            : state.remaining;
        return { ...state, isRunning: false, deadline: null, remaining };
      }
      const seconds = state.remaining > 0 ? state.remaining : DEFAULT_DURATIONS[state.mode];
      return { ...state, isRunning: true, deadline: action.now + seconds * 1000, remaining: seconds };
    }
    case "reset":
      return { ...state, isRunning: false, deadline: null, remaining: DEFAULT_DURATIONS[state.mode] };
    case "switchMode": {
      if (DEFAULT_DURATIONS[action.mode] == null) return state;
      if (action.mode === state.mode && !state.isRunning) return state;
      return {
        ...state,
        mode: action.mode,
        isRunning: false,
        deadline: null,
        remaining: DEFAULT_DURATIONS[action.mode],
      };
    }
    case "complete": {
      // Advance only the still-running window seeing this exact deadline; a
      // repeat (deadline already cleared) is a no-op. Every leader computes the
      // same next state from the same base, so a race is harmless.
      if (!state.isRunning || state.deadline == null || state.deadline !== action.deadline) return state;
      const wasWork = state.mode === "work";
      const sessions = wasWork ? state.sessions + 1 : state.sessions;
      const nextMode = wasWork ? defaultBreakForStreak(sessions) : "work";
      return {
        ...state,
        mode: nextMode,
        sessions,
        isRunning: false,
        deadline: null,
        remaining: DEFAULT_DURATIONS[nextMode],
        completedDeadline: action.deadline,
      };
    }
    case "adopt": {
      const p = action.payload;
      if (!p || DEFAULT_DURATIONS[p.mode] == null) return state;
      const running = !!(p.running && p.deadline);
      const completedDeadline = Number.isFinite(p.completedDeadline)
        ? p.completedDeadline
        : state.completedDeadline;
      const next = {
        ...state,
        mode: p.mode,
        sessions: Number.isFinite(p.sessions) ? p.sessions : state.sessions,
        isRunning: running,
        deadline: running ? p.deadline : null,
        remaining: Number.isFinite(p.remaining) ? p.remaining : DEFAULT_DURATIONS[p.mode],
        completedDeadline,
      };
      // No-op when nothing changed → stops feedback loops / redundant renders.
      if (sameDiscrete(next, state) && next.completedDeadline === state.completedDeadline) return state;
      return next;
    }
    default:
      return state;
  }
}

export function LocalPomodoroProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, initState);
  const channelRef = useRef(null);

  // Electron cross-window bridge (no-op object on web). Created once; its
  // handlers close over the stable `dispatch`.
  const bridgeRef = useRef(null);
  if (bridgeRef.current === null) {
    bridgeRef.current = createElectronTimerBridge({
      // Popover (follower) receives the main window's published state.
      onState: (snap) => {
        if (snap?.local) dispatch({ type: "adopt", payload: snap });
      },
      // Main (leader) applies commands the popover forwards.
      onCommand: (method, args) => {
        if (method === "toggle") dispatch({ type: "toggle", now: Date.now() });
        else if (method === "reset") dispatch({ type: "reset" });
        else if (method === "switchMode") dispatch({ type: "switchMode", mode: args?.[0] });
      },
    });
  }
  const isFollower = bridgeRef.current.isSlave;

  // Display clock: re-derive secondsLeft from the absolute deadline a few times
  // a second while running. Local-only, so windows stay in lock-step.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!state.isRunning) return undefined;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [state.isRunning]);

  const secondsLeft =
    state.isRunning && state.deadline != null
      ? Math.max(0, Math.ceil((state.deadline - now) / 1000))
      : state.remaining;

  // Advance when the deadline is reached — leaders only (the popover follower
  // mirrors the main window's advance instead of computing its own).
  useEffect(() => {
    if (isFollower) return;
    if (state.isRunning && state.deadline != null && now >= state.deadline) {
      dispatch({ type: "complete", deadline: state.deadline });
    }
  }, [isFollower, state.isRunning, state.deadline, now]);

  // Ring on completion. No cross-window de-dup: playCompletionSound() silently
  // no-ops where audio is locked, so in practice only the window the user is
  // driving (whose audio they unlocked by clicking) actually sounds.
  useEffect(() => {
    if (state.completedDeadline) playCompletionSound().catch(() => {});
  }, [state.completedDeadline]);

  // Wire the transports once.
  useEffect(() => {
    const bridge = bridgeRef.current;
    bridge.start(); // slave→onState / main→onCommand (no-op on web)

    let ch = null;
    const onStorage = (e) => {
      if (e.key === LOCAL_KEY && e.newValue) {
        try {
          dispatch({ type: "adopt", payload: JSON.parse(e.newValue) });
        } catch {
          /* ignore */
        }
      }
    };
    // Web only (no Electron bridge): peer-to-peer across tabs.
    if (!bridge.isMain && !bridge.isSlave) {
      if (typeof BroadcastChannel !== "undefined") {
        try {
          ch = new BroadcastChannel(CHANNEL);
          ch.onmessage = (e) => {
            if (e.data?.t === "state" && e.data.s?.local) dispatch({ type: "adopt", payload: e.data.s });
          };
          channelRef.current = ch;
        } catch {
          ch = null;
        }
      }
      window.addEventListener("storage", onStorage);
    }
    return () => {
      bridge.stop();
      window.removeEventListener("storage", onStorage);
      if (ch) ch.close();
      channelRef.current = null;
    };
  }, []);

  // Persist + publish discrete changes. The popover follower does neither — the
  // main window owns the state; the follower only mirrors + forwards commands.
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (bridge.isSlave) return;
    const persisted = {
      mode: state.mode,
      sessions: state.sessions,
      running: state.isRunning,
      deadline: state.deadline,
      remaining: state.remaining,
    };
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(persisted));
    } catch {
      /* ignore */
    }
    // `local` tags the payload so a follower ignores any stale engine snapshot;
    // `completedDeadline` lets the follower ring without running its own clock.
    const live = { ...persisted, local: 1, completedDeadline: state.completedDeadline };
    if (bridge.isMain) {
      bridge.broadcastState(live);
    } else if (channelRef.current) {
      try {
        channelRef.current.postMessage({ t: "state", s: live });
      } catch {
        /* ignore */
      }
    }
  }, [state.mode, state.sessions, state.isRunning, state.deadline, state.remaining, state.completedDeadline]);

  // Drive the OS menu-bar countdown (the Electron tray) so an active local
  // timer shows up top exactly like the signed-in app. Only the leader owns the
  // single global tray — the popover follower and web don't (window.__electronTimer
  // is also a no-op off Electron). The tray ticks itself from endsAtMs.
  useEffect(() => {
    if (!bridgeRef.current.isMain) return undefined;
    if (state.isRunning && state.deadline) {
      startPersistentTimer({
        endsAtMs: state.deadline,
        mode: state.mode,
        isSynced: false,
        durationSeconds: DEFAULT_DURATIONS[state.mode],
      });
    } else {
      stopPersistentTimer();
    }
    return undefined;
  }, [state.isRunning, state.deadline, state.mode]);

  // Clear the tray when leaving the local timer (on sign-in the engine takes
  // over and drives it itself).
  useEffect(
    () => () => {
      if (bridgeRef.current.isMain) stopPersistentTimer();
    },
    []
  );

  const value = useMemo(
    () => ({
      mode: state.mode,
      secondsLeft,
      isRunning: state.isRunning,
      sessions: state.sessions,
      durations: DEFAULT_DURATIONS,
      pendingMode: null,
      pendingAction: null,
      isSynced: false,
      isController: true,
      canControl: true,
      realtimeStatus: "SUBSCRIBED",
      toggleRun: () => {
        // Unlock THIS window's audio during the click so it can ring later.
        warmupAudioContext().catch(() => {});
        const bridge = bridgeRef.current;
        if (bridge.isSlave) bridge.sendCommand("toggle");
        else dispatch({ type: "toggle", now: Date.now() });
      },
      resetTimer: () => {
        const bridge = bridgeRef.current;
        if (bridge.isSlave) bridge.sendCommand("reset");
        else dispatch({ type: "reset" });
      },
      switchMode: (m) => {
        const bridge = bridgeRef.current;
        if (bridge.isSlave) bridge.sendCommand("switchMode", [m]);
        else dispatch({ type: "switchMode", mode: m });
      },
      skipTransition: () => {},
      switchAlternateBreak: () => {
        const m = state.mode === "longBreak" ? "shortBreak" : "longBreak";
        const bridge = bridgeRef.current;
        if (bridge.isSlave) bridge.sendCommand("switchMode", [m]);
        else dispatch({ type: "switchMode", mode: m });
      },
    }),
    [state, secondsLeft]
  );

  return <PomodoroContext.Provider value={value}>{children}</PomodoroContext.Provider>;
}
