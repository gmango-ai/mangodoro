import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../../supabase";

// Shared "website views" for a room — the set of web tiles everyone sees, their
// URLs, and (for YouTube) synced playback. State is EPHEMERAL: it lives on a
// board-style realtime broadcast channel (no DB), mirroring WhiteboardTimer. A
// late joiner asks for the current state on subscribe; anyone holding state
// answers, so people walking in mid-session catch up. If everyone leaves, the
// session is gone — fine for a watch-together.
//
// Anyone in the room may mutate (add/remove a site, change a URL, drive
// playback) — every change is a fire-and-forget broadcast applied by all peers
// (including the sender, so there's one code path and state stays consistent).
//
// Shape:
//   webs        — [{ id, url }]  (order = insertion)
//   playback    — { [id]: { playing, time, rate, ts, by } }  (YouTube sync)

function newId() {
  try { return `w_${crypto.randomUUID().slice(0, 8)}`; }
  catch { return `w_${Math.random().toString(36).slice(2, 10)}`; }
}

export function useRoomWeb(roomId, meId) {
  const [webs, setWebs] = useState([]);
  const [playback, setPlayback] = useState({});
  const chanRef = useRef(null);
  // Latest state for the late-joiner responder (avoids a stale closure).
  const stateRef = useRef({ webs: [], playback: {} });
  stateRef.current = { webs, playback };

  // Local appliers (also used when we receive a peer's broadcast).
  const applyAdd = useCallback((w) => {
    if (!w?.id) return;
    setWebs((prev) => (prev.some((x) => x.id === w.id) ? prev : [...prev, { id: w.id, url: w.url || "" }]));
  }, []);
  const applyRemove = useCallback((id) => {
    setWebs((prev) => prev.filter((x) => x.id !== id));
    setPlayback((prev) => { if (!(id in prev)) return prev; const n = { ...prev }; delete n[id]; return n; });
  }, []);
  const applyUrl = useCallback((id, url) => {
    setWebs((prev) => prev.map((x) => (x.id === id ? { ...x, url } : x)));
  }, []);
  const applyPlayback = useCallback((id, p) => {
    setPlayback((prev) => ({ ...prev, [id]: p }));
  }, []);

  const send = useCallback((event, payload) => {
    const ch = chanRef.current;
    if (ch) { try { ch.send({ type: "broadcast", event, payload }); } catch { /* */ } }
  }, []);

  // ── public mutators (apply locally + broadcast) ──
  const addWeb = useCallback((url = "") => {
    const id = newId();
    applyAdd({ id, url });
    send("web-add", { id, url });
    return id;
  }, [applyAdd, send]);

  const removeWeb = useCallback((id) => {
    applyRemove(id);
    send("web-remove", { id });
  }, [applyRemove, send]);

  const setWebUrl = useCallback((id, url) => {
    applyUrl(id, url);
    send("web-url", { id, url });
  }, [applyUrl, send]);

  const sendPlayback = useCallback((id, p) => {
    const full = { ...p, by: meId, ts: Date.now() };
    applyPlayback(id, full);
    send("web-playback", { id, ...full });
  }, [applyPlayback, send, meId]);

  useEffect(() => {
    if (!roomId) return undefined;
    const ch = supabase.channel(`room-web:${roomId}`, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "web-add" }, (m) => applyAdd(m.payload));
    ch.on("broadcast", { event: "web-remove" }, (m) => applyRemove(m.payload?.id));
    ch.on("broadcast", { event: "web-url" }, (m) => applyUrl(m.payload?.id, m.payload?.url || ""));
    ch.on("broadcast", { event: "web-playback" }, (m) => {
      const { id, ...p } = m.payload || {};
      if (id) applyPlayback(id, p);
    });
    // Late-joiner sync: ask for the current state; anyone who has webs answers.
    ch.on("broadcast", { event: "web-sync-req" }, () => {
      const s = stateRef.current;
      if (!s.webs.length) return;
      try { ch.send({ type: "broadcast", event: "web-state", payload: s }); } catch { /* */ }
    });
    ch.on("broadcast", { event: "web-state" }, (m) => {
      const s = m.payload || {};
      // Only adopt if we have nothing yet (don't clobber local edits).
      setWebs((prev) => (prev.length ? prev : (Array.isArray(s.webs) ? s.webs : [])));
      setPlayback((prev) => (Object.keys(prev).length ? prev : (s.playback || {})));
    });
    ch.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      try { ch.send({ type: "broadcast", event: "web-sync-req" }); } catch { /* */ }
    });
    chanRef.current = ch;
    return () => { try { supabase.removeChannel(ch); } catch { /* */ } chanRef.current = null; };
  }, [roomId, applyAdd, applyRemove, applyUrl, applyPlayback]);

  return { webs, playback, addWeb, removeWeb, setWebUrl, sendPlayback };
}
