/** True when running inside the Electron menubar popover window. */
export function isElectronPopover() {
  return typeof document !== "undefined"
    && document.documentElement.classList.contains("electron-popover");
}

/** True when running in the Electron main renderer (not popover). */
export function isElectronMain() {
  return typeof window !== "undefined"
    && !!window.__electronTimer
    && !isElectronPopover();
}

/**
 * Electron cross-window timer bridge. Main window owns the engine;
 * popover receives state snapshots and forwards commands via IPC.
 */
export function createElectronTimerBridge({ onState, onCommand }) {
  const bridge = typeof window !== "undefined" ? window.__electronTimerBridge : null;
  if (!bridge) {
    return {
      start: () => {},
      stop: () => {},
      broadcastState: () => {},
      sendCommand: () => false,
      isSlave: false,
      isMain: false,
    };
  }

  const isSlave = bridge.role === "slave";
  const isMain = bridge.role === "main";

  function start() {
    if (isSlave) {
      bridge.onState?.((snapshot) => onState?.(snapshot));
    }
    if (isMain) {
      bridge.onCommand?.((method, args) => onCommand?.(method, args));
    }
  }

  function stop() {
    bridge.offState?.();
    bridge.offCommand?.();
  }

  return {
    start,
    stop,
    broadcastState: (snapshot) => {
      if (isMain) bridge.publishState?.(snapshot);
    },
    sendCommand: (method, args) => {
      if (isSlave) {
        bridge.sendCommand?.(method, args);
        return true;
      }
      return false;
    },
    isSlave,
    isMain,
  };
}
