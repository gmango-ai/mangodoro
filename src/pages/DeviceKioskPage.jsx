import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { applyAccent } from "../lib/accent";
import { LIVEKIT_URL } from "../lib/livekit";
import UserAvatar from "../components/UserAvatar";
import LogoMark from "../components/LogoMark";
import DevicePortalCall from "../components/video/DevicePortalCall";

// Full-screen read-only room display for a paired device account. Shows the
// room's active pomodoro timer + who's present, driven by the device's
// least-privilege RLS access (its pinned room only). No controls — a kiosk.
const MODE_LABEL = { work: "Focus", shortBreak: "Short break", longBreak: "Long break" };

export default function DeviceKioskPage({ session }) {
  const meta = session?.user?.user_metadata || {};
  const roomId = meta.room_id || null;
  const deviceName = meta.name || "Device";

  const [room, setRoom] = useState(null);
  const [sess, setSess] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  const [clock, setClock] = useState(() => new Date());

  // Kiosk is always dark with the default accent (no member theme to inherit).
  useEffect(() => {
    document.documentElement.classList.add("dark");
    applyAccent("teal", true);
    return () => document.documentElement.classList.remove("dark");
  }, []);

  useEffect(() => {
    if (!roomId) return undefined;
    let alive = true;

    supabase.from("rooms").select("id, name").eq("id", roomId).maybeSingle()
      .then(({ data }) => { if (alive) setRoom(data); });

    const loadSession = async () => {
      const { data } = await supabase
        .from("sync_sessions")
        .select("id, mode, is_running, remaining_seconds, ends_at, status")
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

    // Realtime keeps the display live; RLS scopes events to this room only.
    const ch = supabase
      .channel(`kiosk:${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sync_sessions", filter: `room_id=eq.${roomId}` }, loadSession)
      .on("postgres_changes", { event: "*", schema: "public", table: "sync_session_participants" }, loadSession)
      .subscribe();
    const poll = setInterval(loadSession, 30000); // self-heal if a realtime event is missed
    return () => { alive = false; supabase.removeChannel(ch); clearInterval(poll); };
  }, [roomId]);

  // Tick the countdown while running.
  useEffect(() => {
    if (!sess?.is_running) return undefined;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [sess?.is_running]);

  // Always-on wall clock for the communal display.
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const secondsLeft = useMemo(() => {
    if (!sess) return 0;
    if (sess.is_running && sess.ends_at) {
      return Math.max(0, Math.ceil((new Date(sess.ends_at).getTime() - now) / 1000));
    }
    return Math.max(0, sess.remaining_seconds || 0);
  }, [sess, now]);

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const isBreak = sess && sess.mode !== "work";
  const clockHHMM = clock.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const clockDate = clock.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });

  const unpair = async () => { await supabase.auth.signOut(); };

  // When LiveKit is configured the kiosk is a two-way video portal (camera + mic
  // published; remote members can drop in). The timer then rides as a compact
  // overlay. With no LiveKit, fall back to the big centered timer display.
  const portal = !!LIVEKIT_URL && !!roomId;

  return (
    <main className="relative min-h-[100dvh] bg-[var(--color-bg)] text-slate-100 overflow-hidden select-none">
      {portal && (
        <div className="absolute inset-0">
          <DevicePortalCall roomId={roomId} displayName={`${room?.name || deviceName} · Portal`} />
        </div>
      )}
      {portal && (
        <>
          <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/55 to-transparent pointer-events-none" />
          <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/55 to-transparent pointer-events-none" />
        </>
      )}

      <header className="absolute top-0 inset-x-0 z-10 flex items-start justify-between px-6 pt-4">
        <span className="inline-flex items-center gap-2.5">
          <span className="text-[var(--color-accent)]"><LogoMark size={26} /></span>
          <span className="text-xl font-semibold text-white/95 drop-shadow">{room?.name || deviceName}</span>
          {portal && participants.length > 0 && (
            <span className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/85">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> {participants.length} here
            </span>
          )}
        </span>
        <div className="flex flex-col items-end gap-1">
          <div className="text-right leading-none">
            <div className="text-2xl font-bold tabular-nums text-white/95 drop-shadow" style={{ fontFamily: "'Parkinsans', sans-serif" }}>{clockHHMM}</div>
            <div className="text-[11px] uppercase tracking-wider text-white/55 mt-1">{clockDate}</div>
          </div>
          <button type="button" onClick={unpair} className="text-[11px] text-white/45 hover:text-white/80 transition-colors drop-shadow">
            Unpair
          </button>
        </div>
      </header>

      {portal ? (
        sess && (
          <div className="absolute top-20 left-6 z-10 rounded-2xl bg-black/45 backdrop-blur px-5 py-3">
            <div className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${isBreak ? "text-[var(--color-break)]" : "text-[var(--color-accent)]"}`}>
              {MODE_LABEL[sess.mode] || "Focus"}{!sess.is_running ? " · Paused" : ""}
            </div>
            <div className="font-bold tabular-nums leading-none mt-1" style={{ fontSize: "clamp(2.5rem, 7vw, 4rem)", fontFamily: "'Parkinsans', sans-serif" }}>
              {mm}:{ss}
            </div>
          </div>
        )
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6">
          {sess ? (
            <>
              <div className={`text-[11px] font-semibold uppercase tracking-[0.25em] mb-3 ${isBreak ? "text-[var(--color-break)]" : "text-[var(--color-accent)]"}`}>
                {MODE_LABEL[sess.mode] || "Focus"}
              </div>
              <div
                className="font-bold tabular-nums leading-none"
                style={{ fontSize: "clamp(5rem, 22vw, 15rem)", fontFamily: "'Parkinsans', sans-serif", letterSpacing: "0.01em" }}
              >
                {mm}:{ss}
              </div>
              {!sess.is_running && <div className="mt-3 text-sm uppercase tracking-widest text-slate-500">Paused</div>}
              {participants.length > 0 && (
                <div className="mt-12 flex items-center gap-4 flex-wrap justify-center max-w-3xl">
                  {participants.map((p) => (
                    <div key={p.user_id} className="flex flex-col items-center gap-1.5">
                      <UserAvatar url={p.avatar_url || ""} name={p.display_name || "Member"} size={44} />
                      <span className="text-[11px] text-slate-400 max-w-[88px] truncate">{p.display_name || "Member"}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="text-center">
              <div className="text-3xl font-semibold text-slate-200">{room?.name || deviceName}</div>
              <p className="mt-4 text-slate-500">No active session. Waiting for someone to start the timer…</p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
