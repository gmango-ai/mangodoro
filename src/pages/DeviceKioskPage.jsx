import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { applyAccent } from "../lib/accent";
import UserAvatar from "../components/UserAvatar";
import LogoMark from "../components/LogoMark";

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

  const unpair = async () => { await supabase.auth.signOut(); };

  return (
    <main className="min-h-[100dvh] flex flex-col items-center justify-center bg-[var(--color-bg)] text-slate-100 px-6 select-none">
      <header className="fixed top-0 inset-x-0 flex items-center justify-between px-5 h-14">
        <span className="inline-flex items-center gap-2">
          <span className="text-[var(--color-accent)]"><LogoMark size={22} /></span>
          <span className="text-sm font-semibold text-slate-300">{room?.name || deviceName}</span>
        </span>
        <button type="button" onClick={unpair} className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
          Unpair
        </button>
      </header>

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
    </main>
  );
}
