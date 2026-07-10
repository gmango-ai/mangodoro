import { useEffect, useMemo, useState } from "react";
import { ChevronDown, DoorOpen, Power, Moon } from "lucide-react";
import { supabase } from "../supabase";
import { applyAccent } from "../lib/accent";
import { currentDeviceRoom, setDeviceRoom, currentDeviceSleep, deviceSetSleep } from "../lib/orgDevices";
import { isAsleep, nextWakeAt, nextSleepAt, clockLabel } from "../lib/deviceSchedule";
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

// Room switcher for a MOVABLE device — switch which room this kiosk shows.
// `rooms` comes from RLS: a movable device reads all its org's rooms, a fixed
// one reads only its pinned room, so if there's nothing else to switch to we
// render nothing (non-movable devices never see a switcher).
function RoomSwitcher({ currentRoomId, currentName, rooms, onSwitch }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const others = (rooms || []).filter((r) => r.id !== currentRoomId);
  if (others.length === 0) return null;
  const pick = async (id) => {
    setBusy(true);
    await onSwitch(id);
    setBusy(false);
    setOpen(false);
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-full bg-white/10 hover:bg-white/15 text-[12px] font-semibold text-white/90 transition-colors disabled:opacity-50"
        title="Switch this device to another room"
      >
        <DoorOpen className="w-3.5 h-3.5" />
        <span className="max-w-[140px] truncate">{currentName || "Room"}</span>
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-40 w-56 max-h-[60vh] overflow-auto p-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl">
            <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/50">Move this device to…</div>
            {others.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => pick(r.id)}
                className="w-full text-left px-2.5 py-1.5 rounded-lg text-[12px] text-white/85 hover:bg-white/10"
              >
                {r.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Sleep screen — shown when the kiosk is off the clock (outside its scheduled
// hours, or manually put offline). The call + polling are torn down (the main
// content unmounts), so it's just a dim wall clock. Tap anywhere to wake.
function SleepScreen({ roomName, backAt, onWake }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  return (
    <button
      type="button"
      onClick={onWake}
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-3 bg-black text-white select-none"
    >
      <div className="text-7xl font-bold tabular-nums text-white/25" style={{ fontFamily: "'Parkinsans', sans-serif" }}>
        {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </div>
      <div className="flex items-center gap-2 text-white/40">
        <Moon className="w-4 h-4" />
        <span className="text-sm">{roomName} · offline{backAt ? ` until ${backAt}` : ""}</span>
      </div>
      <div className="mt-4 text-[11px] uppercase tracking-[0.2em] text-white/25">Tap to wake</div>
    </button>
  );
}

// Paired-device kiosk. Now a configurable room display: the same modular BSP
// layout members use (RoomLayout + useRoomLayout) but with the DEVICE panel set
// (portal video, read-only chat, embedded whiteboard, timer, presence) and
// device-local persistence. You can't leave the room — there's no leave; you
// arrange panels and unpair. Read-only throughout (device RLS is SELECT-only).
export default function DeviceKioskPage({ session }) {
  const meta = session?.user?.user_metadata || {};
  const deviceName = meta.name || "Device";
  const userId = session?.user?.id || null;

  // Live pinned room (authoritative — survives a room switch, unlike the JWT's
  // user_metadata.room_id). Seed from the JWT for a fast first paint, confirm via
  // current_device_room().
  const [roomId, setRoomId] = useState(meta.room_id || null);
  const [room, setRoom] = useState(null);
  const [sess, setSess] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [rooms, setRooms] = useState([]); // org rooms readable here (>1 ⇒ movable)
  const [arranging, setArranging] = useState(false);

  // Sleep schedule + manual override. `asleep` is re-derived on a tick so the
  // kiosk auto-sleeps/wakes at the schedule boundaries without a reload. Until
  // the first fetch lands we don't know the schedule, so treat that as asleep —
  // better to hold the call/polling off for a beat than to mount the full portal
  // for a device that should already be off the clock.
  const [sched, setSched] = useState(null);
  const [schedLoaded, setSchedLoaded] = useState(false);
  const [, setSleepTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await currentDeviceSleep();
      if (!alive) return;
      setSched(data);
      setSchedLoaded(true);
    };
    load();
    const poll = setInterval(load, 60000); // pick up admin schedule edits; keeps ticking while asleep
    return () => { alive = false; clearInterval(poll); };
  }, []);
  useEffect(() => {
    const id = setInterval(() => setSleepTick((n) => (n + 1) % 1e9), 30000);
    return () => clearInterval(id);
  }, []);
  // Hold the portal off until the schedule is known: a device that should be
  // asleep would otherwise mount the call + subscriptions for the fetch window.
  const asleep = !schedLoaded || isAsleep(sched);

  const goOffline = async () => {
    const until = nextWakeAt(sched);
    setSched((s) => ({ ...(s || {}), asleep_until: until.toISOString(), awake_until: null }));
    await deviceSetSleep(until, null);
  };
  const wake = async () => {
    const until = nextSleepAt(sched);
    setSched((s) => ({ ...(s || {}), awake_until: until.toISOString(), asleep_until: null }));
    await deviceSetSleep(null, until);
  };

  // Confirm the live room + load switch targets, and re-poll so an admin's
  // remote reassign is picked up. RLS does the gating: a fixed device only ever
  // sees its one room here, so RoomSwitcher renders nothing for it.
  useEffect(() => {
    let alive = true;
    const sync = async () => {
      const { data: live } = await currentDeviceRoom();
      if (alive && live) setRoomId(live);
      const { data: rs } = await supabase.from("rooms").select("id, name").order("name");
      if (alive) setRooms(rs || []);
    };
    sync();
    const poll = setInterval(sync, 20000);
    return () => { alive = false; clearInterval(poll); };
  }, []);

  const handleSwitch = async (newRoomId) => {
    const { error } = await setDeviceRoom(newRoomId);
    if (!error) setRoomId(newRoomId); // re-points session query, layout key, portal
  };

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

    // Asleep → don't subscribe or poll the session (and the call is unmounted
    // below). We still loaded the room name above so the sleep screen can show it.
    if (asleep) return () => { alive = false; };

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
          .select("user_id, display_name, avatar_url, joined_at")
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
  }, [roomId, asleep]);

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

  if (asleep) {
    if (!schedLoaded) {
      // Schedule still loading — don't mount the portal OR the interactive sleep
      // screen (no "Tap to wake" until we actually know the device's hours).
      return (
        <main className="min-h-[100dvh] flex items-center justify-center bg-black text-white/40 select-none">
          <div className="text-sm">{deviceName}</div>
        </main>
      );
    }
    const back = sched?.asleep_until ? new Date(sched.asleep_until) : nextWakeAt(sched);
    return <SleepScreen roomName={room?.name || deviceName} backAt={clockLabel(back)} onWake={wake} />;
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
          <RoomSwitcher currentRoomId={roomId} currentName={room?.name} rooms={rooms} onSwitch={handleSwitch} />
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
          <button
            type="button"
            onClick={goOffline}
            title="Put this display offline (ends the call until it wakes on schedule or you tap it)"
            className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-full bg-white/10 hover:bg-white/15 text-[12px] font-semibold text-white/80 transition-colors"
          >
            <Power className="w-3.5 h-3.5" /> Go offline
          </button>
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
