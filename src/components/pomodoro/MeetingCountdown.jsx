import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { supabase } from "../../supabase";

// Countdown chip for meeting-room sessions. Reads expires_at off the
// session row, ticks once a second, and when the clock hits zero asks
// the server to sweep — the BEFORE DELETE trigger then cascades the
// session away and the realtime DELETE handler in SyncSessionContext
// drops every participant out of the room.
export default function MeetingCountdown({ expiresAt, sessionId, dark }) {
  const [now, setNow] = useState(() => Date.now());
  const sweptRef = useRef(false);

  useEffect(() => {
    sweptRef.current = false;
  }, [sessionId, expiresAt]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const end = expiresAt ? new Date(expiresAt).getTime() : NaN;
  const remaining = Number.isFinite(end) ? Math.max(0, Math.ceil((end - now) / 1000)) : null;

  // Once we cross zero, fire the server-side sweep exactly once. Has
  // to be in an effect, not during render — and not chained as
  // `.catch`, because Supabase's PostgrestBuilder is thenable but not
  // a real Promise.
  useEffect(() => {
    if (remaining !== 0 || sweptRef.current) return;
    sweptRef.current = true;
    (async () => {
      try { await supabase.rpc("sweep_expired_sync_sessions"); } catch { /* */ }
    })();
  }, [remaining]);

  if (remaining == null) return null;

  const hh = Math.floor(remaining / 3600);
  const mm = Math.floor((remaining % 3600) / 60);
  const ss = remaining % 60;
  const label = hh > 0
    ? `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
    : `${mm}:${String(ss).padStart(2, "0")}`;

  const urgent = remaining > 0 && remaining <= 60;
  const ended = remaining === 0;
  const cls = ended
    ? (dark ? "bg-red-500/15 text-red-300" : "bg-red-50 text-red-600")
    : urgent
      ? (dark ? "bg-amber-500/15 text-amber-300" : "bg-amber-50 text-amber-700")
      : (dark ? "bg-[var(--color-surface-raised)] text-slate-300" : "bg-slate-100 text-slate-600");

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${cls}`}
      title={ended ? "Room closing…" : "Time left before the room closes"}
    >
      <Clock className="w-3 h-3 opacity-80" />
      {ended ? "Closing…" : label}
    </span>
  );
}
