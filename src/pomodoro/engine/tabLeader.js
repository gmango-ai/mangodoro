const LEASE_MS = 10_000;
const HEARTBEAT_MS = 5_000;

function tabId() {
  try {
    const key = "ql_pomodoro_tab_id";
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return `tab-${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * Cross-tab leader election via BroadcastChannel.
 * Only the leader runs Realtime + tick + server writes.
 */
export function createTabLeader(userId, { onBecomeLeader, onBecomeFollower, onCommand, onRemoteState }) {
  const myId = tabId();
  let channel = null;
  let isLeader = false;
  let lastLeaderBeat = 0;
  let heartbeatTimer = null;
  let checkTimer = null;

  function post(msg) {
    try {
      channel?.postMessage(msg);
    } catch { /* ignore */ }
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      post({ type: "heartbeat", tabId: myId, ts: Date.now() });
    }, HEARTBEAT_MS);
    post({ type: "heartbeat", tabId: myId, ts: Date.now() });
  }

  function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function becomeLeader() {
    if (isLeader) return;
    isLeader = true;
    lastLeaderBeat = Date.now();
    startHeartbeat();
    onBecomeLeader?.();
  }

  function becomeFollower() {
    if (!isLeader) return;
    isLeader = false;
    stopHeartbeat();
    onBecomeFollower?.();
  }

  function tryClaim() {
    post({ type: "claim", tabId: myId, ts: Date.now() });
    setTimeout(() => {
      if (Date.now() - lastLeaderBeat > LEASE_MS) becomeLeader();
    }, 300);
  }

  function start() {
    try {
      channel = new BroadcastChannel(`pomodoro-engine-leader:${userId}`);
    } catch {
      becomeLeader();
      return;
    }

    channel.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg || msg.tabId === myId) return;

      if (msg.type === "heartbeat" || msg.type === "claim") {
        lastLeaderBeat = msg.ts || Date.now();
        if (isLeader) {
          if (msg.type === "claim") {
            post({ type: "heartbeat", tabId: myId, ts: Date.now() });
          }
          if (msg.tabId < myId) becomeFollower();
        }
      } else if (msg.type === "command" && isLeader) {
        onCommand?.(msg.method, msg.args);
      } else if (msg.type === "state") {
        onRemoteState?.(msg.snapshot);
      }
    };

    checkTimer = setInterval(() => {
      if (!isLeader && Date.now() - lastLeaderBeat > LEASE_MS) {
        tryClaim();
      }
    }, 2000);

    tryClaim();
  }

  function stop() {
    stopHeartbeat();
    if (checkTimer) clearInterval(checkTimer);
    checkTimer = null;
    channel?.close();
    channel = null;
    isLeader = false;
  }

  function broadcastState(snapshot) {
    if (!isLeader) return;
    post({ type: "state", tabId: myId, snapshot, ts: Date.now() });
  }

  function sendCommand(method, args) {
    if (isLeader) return false;
    post({ type: "command", tabId: myId, method, args, ts: Date.now() });
    return true;
  }

  return {
    start,
    stop,
    broadcastState,
    sendCommand,
    getIsLeader: () => isLeader,
    forceLeader: becomeLeader,
    forceFollower: becomeFollower,
  };
}
