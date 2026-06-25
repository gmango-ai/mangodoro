import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { applyAccent } from "../lib/accent";
import LogoMark from "../components/LogoMark";
import RoomLayout from "../components/office/roomLayout/RoomLayout";
import LayoutBar from "../components/office/roomLayout/LayoutBar";
import { useRoomLayout } from "../components/office/roomLayout/useRoomLayout";
import { DEVICE_PANELS, DEVICE_PANEL_IDS } from "../components/office/roomLayout/devicePanels";
import { DEVICE_PRESETS, DEVICE_DEFAULT_PRESET } from "../components/office/roomLayout/devicePresets";
import { panelsIn } from "../components/office/roomLayout/layoutTree";

// Self-ticking wall clock — its own component so the per-second tick re-renders
// only this, not the whole kiosk (which would churn the video/whiteboard panels).
function WallClock() {
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="text-right leading-none">
      <div className="text-xl font-bold tabular-nums text-white/95" style={{ fontFamily: "'Parkinsans', sans-serif" }}>
        {clock.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-white/55 mt-0.5">
        {clock.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
      </div>
    </div>
  );
}

// Paired-device kiosk. Now a configurable room display: the same modular BSP
// layout members use (RoomLayout + useRoomLayout) but with the DEVICE panel set
// (portal video, read-only chat, embedded whiteboard, timer, presence) and
// device-local persistence. You can't leave the room — there's no leave; you
// arrange panels and unpair. Read-only throughout (device RLS is SELECT-only).
export default function DeviceKioskPage({ session }) {
  const meta = session?.user?.user_metadata || {};
  const roomId = meta.room_id || null;
  const deviceName = meta.name || "Device";
  const userId = session?.user?.id || null;

  const [room, setRoom] = useState(null);
  const [sess, setSess] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [arranging, setArranging] = useState(false);

  // Kiosk is always dark with the default accent (no member theme to inherit).
  useEffect(() => {
    document.documentElement.classList.add("dark");
    applyAccent("teal", true);
    return () => document.documentElement.classList.remove("dark");
  }, []);

  // Room + active session (incl. its linked whiteboard) + participants, kept
  // live by realtime; RLS scopes everything to this device's pinned room.
  useEffect(() => {
    if (!roomId) return undefined;
    let alive = true;

    supabase.from("rooms").select("id, name").eq("id", roomId).maybeSingle()
      .then(({ data }) => { if (alive) setRoom(data); });

    const loadSession = async () => {
      const { data } = await supabase
        .from("sync_sessions")
        .select("id, mode, is_running, remaining_seconds, ends_at, status, whiteboard_id")
        .eq("room_id", roomId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!alive) return;
      setSess(data || null);
      if (data) {
        const { data: parts } = await supabase
          .from("sync_session_participants")
          .select("user_id, display_name, avatar_url, presence_state, joined_at")
          .eq("session_id", data.id)
          .is("left_at", null)
          .order("joined_at", { ascending: true });
        if (alive) setParticipants(parts || []);
      } else {
        setParticipants([]);
      }
    };
    loadSession();

    const ch = supabase
      .channel(`kiosk:${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sync_sessions", filter: `room_id=eq.${roomId}` }, loadSession)
      .on("postgres_changes", { event: "*", schema: "public", table: "sync_session_participants" }, loadSession)
      .subscribe();
    const poll = setInterval(loadSession, 30000); // self-heal if a realtime event is missed
    return () => { alive = false; supabase.removeChannel(ch); clearInterval(poll); };
  }, [roomId]);

  // Device-local modular layout (own preset set + storage key prefix).
  const { tree, presetId, applyPreset, reset, setRatio, movePanel, addPanelAt, closePanel, togglePanel } =
    useRoomLayout(roomId, DEVICE_PANEL_IDS, {
      presets: DEVICE_PRESETS,
      defaultPreset: DEVICE_DEFAULT_PRESET,
      keyPrefix: "ql_device_layout",
    });

  const activePanels = panelsIn(tree);
  const quickPanels = DEVICE_PANEL_IDS.map((id) => ({ id, title: DEVICE_PANELS[id].title, Icon: DEVICE_PANELS[id].icon }));

  // Memoized so the per-second WallClock tick (separate component) never churns
  // the layout — ctx identity changes only on real room/session/participant data.
  const ctx = useMemo(() => ({
    room: room || { id: roomId },
    userId,
    displayName: `${room?.name || deviceName} · Portal`,
    dark: true,
    sess,
    participants,
    whiteboardId: sess?.whiteboard_id || null,
  }), [room, roomId, userId, deviceName, sess, participants]);

  const unpair = async () => { await supabase.auth.signOut(); };

  if (!roomId) {
    return (
      <main className="min-h-[100dvh] flex items-center justify-center bg-[var(--color-bg)] text-slate-300">
        <div className="text-center">
          <p className="text-lg font-semibold">{deviceName}</p>
          <p className="mt-2 text-slate-500">This device isn't paired to a room.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative h-[100dvh] flex flex-col bg-[var(--color-bg)] text-slate-100 overflow-hidden select-none">
      <header className="shrink-0 flex items-center justify-between gap-3 px-5 py-2.5 border-b border-[var(--color-border)]">
        <span className="inline-flex items-center gap-2.5 min-w-0">
          <span className="text-[var(--color-accent)] shrink-0"><LogoMark size={24} /></span>
          <span className="text-lg font-semibold text-white/95 truncate">{room?.name || deviceName}</span>
          {participants.length > 0 && (
            <span className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/85 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> {participants.length} here
            </span>
          )}
        </span>
        <div className="flex items-center gap-3 shrink-0">
          <LayoutBar
            presetId={presetId}
            onApply={applyPreset}
            onReset={reset}
            accent="var(--color-accent)"
            dark
            arranging={arranging}
            onToggleArrange={() => setArranging((v) => !v)}
            panels={quickPanels}
            activePanels={activePanels}
            onTogglePanel={togglePanel}
            presets={DEVICE_PRESETS}
          />
          <WallClock />
          <button type="button" onClick={unpair} className="text-[11px] text-white/45 hover:text-white/80 transition-colors">
            Unpair
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 p-3 overflow-hidden">
        <RoomLayout
          tree={tree}
          ctx={ctx}
          panels={DEVICE_PANELS}
          onRatioChange={setRatio}
          arranging={arranging}
          onMove={movePanel}
          onAddAt={addPanelAt}
          onClose={closePanel}
        />
      </div>
    </main>
  );
}
