import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "../supabase";
import { useApp } from "./AppContext";
import {
  leaveSyncSession,
  endSyncSession,
  fetchSyncParticipants,
  transferSyncLeader,
  kickSyncParticipant,
  setSyncParticipantStatus,
  takeSyncControl,
} from "../lib/syncSession";
import { notifySessionJoined, notifySessionCleared } from "../sync/joinSession";

const SYNC_SESSION_KEY = "ql_sync_session";

/** Fields owned by SyncSessionCoordinator — timer fields come from PomodoroEngine. */
const METADATA_FIELDS = [
  "leader_id",
  "controller_id",
  "status",
  "visibility",
  "join_code",
  "team_id",
];

function mergeSessionMetadata(prev, row) {
  if (!prev) return row;
  const merged = { ...prev };
  for (const key of METADATA_FIELDS) {
    if (row[key] !== undefined) merged[key] = row[key];
  }
  return merged;
}

const SyncSessionContext = createContext(null);

export function SyncSessionProvider({ session, children }) {
  const { settings } = useApp();
  const [syncSession, setSyncSession] = useState(null);
  const [syncParticipants, setSyncParticipants] = useState([]);
  const [presenceMap, setPresenceMap] = useState({});

  const clearLocalSession = useCallback(() => {
    setSyncSession(null);
    setSyncParticipants([]);
    setPresenceMap({});
    notifySessionCleared();
  }, []);

  const rehydrateSyncSessionFromStorage = useCallback(async () => {
    const stored = localStorage.getItem(SYNC_SESSION_KEY);
    if (!stored) {
      setSyncSession(null);
      setSyncParticipants([]);
      setPresenceMap({});
      return;
    }
    try {
      const { sessionId } = JSON.parse(stored);
      if (!sessionId) {
        setSyncSession(null);
        setSyncParticipants([]);
        setPresenceMap({});
        return;
      }
      const { data } = await supabase
        .from("sync_sessions")
        .select("*")
        .eq("id", sessionId)
        .eq("status", "active")
        .maybeSingle();
      if (data) {
        setSyncSession(data);
        const { data: p } = await fetchSyncParticipants(data.id);
        setSyncParticipants(p || []);
      } else {
        setSyncSession(null);
        setSyncParticipants([]);
        setPresenceMap({});
        notifySessionCleared();
      }
    } catch {
      setSyncSession(null);
      setSyncParticipants([]);
      setPresenceMap({});
      notifySessionCleared();
    }
  }, []);

  useEffect(() => {
    rehydrateSyncSessionFromStorage();
  }, [rehydrateSyncSessionFromStorage]);

  useEffect(() => {
    let channel;
    try {
      channel = new BroadcastChannel("pomodoro");
      channel.onmessage = (ev) => {
        if (ev.data?.type === "sync-changed") rehydrateSyncSessionFromStorage();
      };
    } catch {
      /* unsupported */
    }
    return () => channel?.close();
  }, [rehydrateSyncSessionFromStorage]);

  const joinSession = useCallback(
    async (sess, { openPomodoro } = {}) => {
      setSyncSession(sess);
      notifySessionJoined(sess);
      const { data: p } = await fetchSyncParticipants(sess.id);
      setSyncParticipants(p || []);
      if (openPomodoro) openPomodoro();
    },
    []
  );

  useEffect(() => {
    function onJoined(ev) {
      const sess = ev.detail?.session;
      if (sess?.id) {
        setSyncSession(sess);
        fetchSyncParticipants(sess.id).then(({ data: p }) => setSyncParticipants(p || []));
      }
    }
    window.addEventListener("ql-sync-session-joined", onJoined);
    return () => window.removeEventListener("ql-sync-session-joined", onJoined);
  }, []);

  useEffect(() => {
    if (!syncSession?.id || !session?.user?.id) return;
    const sessionId = syncSession.id;
    const userId = session.user.id;

    const refetch = async () => {
      const { data: myRow } = await supabase
        .from("sync_session_participants")
        .select("left_at")
        .eq("session_id", sessionId)
        .eq("user_id", userId)
        .maybeSingle();
      if (myRow?.left_at) {
        clearLocalSession();
        return;
      }

      const { data: p } = await fetchSyncParticipants(sessionId);
      const list = p || [];
      setSyncParticipants(list);

      const meMissing = !list.some((row) => row.user_id === userId);
      if (meMissing && syncSession.join_code && myRow == null) {
        await supabase.rpc("join_sync_session", {
          p_join_code: syncSession.join_code,
          p_display_name: settings?.name || "",
        });
        const { data: p2 } = await fetchSyncParticipants(sessionId);
        setSyncParticipants(p2 || []);
      }
    };

    const channel = supabase.channel(`sync-presence:${sessionId}`);

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const map = {};
      for (const key of Object.keys(state)) {
        for (const p of state[key]) {
          map[p.user_id] = true;
        }
      }
      setPresenceMap(map);
      refetch();
    });
    channel.on("presence", { event: "join" }, refetch);
    channel.on("presence", { event: "leave" }, refetch);

    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "sync_session_participants",
        filter: `session_id=eq.${sessionId}`,
      },
      refetch
    );

    channel.on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "sync_sessions",
        filter: `id=eq.${sessionId}`,
      },
      (payload) => {
        const row = payload.new;
        if (!row) return;
        if (row.status === "ended") {
          clearLocalSession();
          return;
        }
        setSyncSession((prev) => mergeSessionMetadata(prev, row));
      }
    );

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ user_id: userId });
      }
    });

    const pollId = setInterval(refetch, 15000);

    return () => {
      clearInterval(pollId);
      supabase.removeChannel(channel);
    };
  }, [syncSession?.id, syncSession?.join_code, session?.user?.id, settings?.name, clearLocalSession]);

  const leaveSession = useCallback(async () => {
    if (syncSession) {
      await leaveSyncSession(syncSession.id);
    }
    clearLocalSession();
  }, [syncSession, clearLocalSession]);

  const endSession = useCallback(async () => {
    if (syncSession) {
      await endSyncSession(syncSession.id);
    }
    clearLocalSession();
  }, [syncSession, clearLocalSession]);

  const transferLeader = useCallback(
    async (newLeaderId) => {
      if (!syncSession) return;
      const { data, error } = await transferSyncLeader(syncSession.id, newLeaderId);
      if (error) {
        console.warn("transfer leader:", error.message);
        return;
      }
      if (data?.session) {
        setSyncSession((prev) =>
          prev ? { ...prev, ...mergeSessionMetadata(prev, data.session) } : data.session
        );
      }
      fetchSyncParticipants(syncSession.id).then(({ data: p }) => setSyncParticipants(p || []));
    },
    [syncSession]
  );

  const setStatus = useCallback(
    async (status) => {
      if (!syncSession) return;
      const { error } = await setSyncParticipantStatus(syncSession.id, status);
      if (error) {
        console.warn("set status:", error.message);
        return;
      }
      fetchSyncParticipants(syncSession.id).then(({ data: p }) => setSyncParticipants(p || []));
    },
    [syncSession]
  );

  const takeControl = useCallback(async (sessionId) => {
    const { data, error } = await takeSyncControl(sessionId);
    if (error) {
      console.warn("take control:", error.message);
      return { error };
    }
    if (data?.session) {
      setSyncSession((prev) =>
        prev ? { ...prev, ...mergeSessionMetadata(prev, data.session) } : data.session
      );
    }
    return { error: null };
  }, []);

  const kickParticipant = useCallback(
    async (userIdToKick) => {
      if (!syncSession) return;
      const { error } = await kickSyncParticipant(syncSession.id, userIdToKick);
      if (error) {
        console.warn("kick participant:", error.message);
        return;
      }
      fetchSyncParticipants(syncSession.id).then(({ data: p }) => setSyncParticipants(p || []));
    },
    [syncSession]
  );

  const value = useMemo(
    () => ({
      syncSession,
      syncParticipants,
      presenceMap,
      joinSession,
      leaveSession,
      endSession,
      transferLeader,
      kickParticipant,
      setStatus,
      takeControl,
    }),
    [
      syncSession,
      syncParticipants,
      presenceMap,
      joinSession,
      leaveSession,
      endSession,
      transferLeader,
      kickParticipant,
      setStatus,
      takeControl,
    ]
  );

  return (
    <SyncSessionContext.Provider value={value}>{children}</SyncSessionContext.Provider>
  );
}

export function useSyncSession() {
  const ctx = useContext(SyncSessionContext);
  if (!ctx) {
    throw new Error("useSyncSession must be used within SyncSessionProvider");
  }
  return ctx;
}
