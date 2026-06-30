import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../supabase";
import { decideRoomEntry } from "../../lib/rooms";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";

// Live queue of people knocking to be let into this (occupied, code-gated)
// room. RLS on room_knock_requests only returns rows to current live
// occupants, so the subscription is self-scoped — no need to check perms here.
// `enabled` gates the subscription to when the viewer is actually inside.
export function useRoomKnocks(roomId, enabled) {
  const [requests, setRequests] = useState([]);
  // Locally-ignored ids stay hidden for this occupant; the row stays pending
  // so another occupant can still let them in (one ignore ≠ a denial).
  const dismissedRef = useRef(new Set());

  useEffect(() => {
    if (!roomId || !enabled) { setRequests([]); return; }
    let alive = true;

    // Any knocks already pending when we arrive.
    supabase
      .from("room_knock_requests")
      .select("id, user_id, display_name, created_at")
      .eq("room_id", roomId)
      .eq("status", "pending")
      .then(({ data }) => {
        if (!alive || !data) return;
        setRequests(data.filter((r) => !dismissedRef.current.has(r.id)));
      });

    const channel = supabase.channel(`knocks:${roomId}`);
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "room_knock_requests", filter: `room_id=eq.${roomId}` },
      (payload) => {
        const row = payload.new;
        if (!row || row.status !== "pending" || dismissedRef.current.has(row.id)) return;
        setRequests((prev) => (prev.some((r) => r.id === row.id) ? prev : [...prev, row]));
      }
    );
    channel.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "room_knock_requests", filter: `room_id=eq.${roomId}` },
      (payload) => {
        const row = payload.new;
        if (!row) return;
        // Decided (by me or anyone) → drop it from every occupant's queue.
        if (row.status !== "pending") setRequests((prev) => prev.filter((r) => r.id !== row.id));
      }
    );
    channel.subscribe();
    return () => { alive = false; supabase.removeChannel(channel); };
  }, [roomId, enabled]);

  const approve = useCallback(async (id) => {
    setRequests((prev) => prev.filter((r) => r.id !== id));
    await decideRoomEntry(id, true);
  }, []);

  const ignore = useCallback((id) => {
    dismissedRef.current.add(id);
    setRequests((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { requests, approve, ignore };
}

// Stacked knock banners shown under the room header to occupants. Each is a
// one-tap "Let in" (admits the knocker via decide_room_entry → can_enter_room
// honors the grant) or "Ignore" (hide for me; others can still answer).
export default function KnockRequests({ roomId, enabled, dark }) {
  const { requests, approve, ignore } = useRoomKnocks(roomId, enabled);
  if (!requests.length) return null;

  return (
    <div className="px-4 sm:px-6 pt-3 space-y-2 shrink-0">
      {requests.map((r) => (
        <div
          key={r.id}
          className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
            dark
              ? "bg-teal-500/10 border-teal-500/30 text-slate-100"
              : "bg-teal-50 border-teal-200 text-slate-800"
          }`}
        >
          <Bell className={`w-4 h-4 shrink-0 ${dark ? "text-teal-300" : "text-teal-600"}`} />
          <p className="text-sm flex-1 min-w-0 truncate">
            <span className="font-semibold">{r.display_name || "Someone"}</span>
            {" is knocking to come in"}
          </p>
          <Button size="sm" className="rounded-full" onClick={() => approve(r.id)}>
            Let in
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={`rounded-full ${dark ? "text-slate-400 hover:text-slate-100" : "text-slate-500 hover:text-slate-800"}`}
            onClick={() => ignore(r.id)}
          >
            Ignore
          </Button>
        </div>
      ))}
    </div>
  );
}
