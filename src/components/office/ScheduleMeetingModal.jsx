import { useState } from "react";
import { CalendarPlus, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Modal from "../Modal";
import { useApp } from "../../context/AppContext";
import { createScheduledMeeting } from "../../lib/scheduledMeetings";

// Book a meeting into this room, optionally mirrored to the creator's Google
// Calendar (foreground OAuth token — same pattern as the Sheets/Docs export).

const DURATIONS = [15, 30, 45, 60, 90];

function defaultDate() {
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (local-ish; good enough for a picker default)
}
function defaultTime() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return `${String(d.getHours()).padStart(2, "0")}:00`;
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoTime(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// `room` = fixed room (office flow). `rooms` + no `room` = calendar flow with a
// meeting-room picker. `initialStart` (Date) prefills date/time from a calendar slot.
export default function ScheduleMeetingModal({ room, rooms, teamId, dark, initialStart, onClose, onCreated }) {
  const { session, googleToken, googleTokenExpiry, createCalendarEvent } = useApp();
  const hasGoogle = !!googleToken && Date.now() < googleTokenExpiry;

  // Any room can host a scheduled meeting (teams often meet in general rooms).
  const roomOptions = room ? [] : (rooms || []);
  const [roomId, setRoomId] = useState(room?.id || roomOptions[0]?.id || "");
  const effRoom = room || (rooms || []).find((r) => r.id === roomId) || null;

  const [title, setTitle] = useState(effRoom?.name ? `${effRoom.name} meeting` : "Meeting");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(initialStart ? isoDate(initialStart) : defaultDate);
  const [time, setTime] = useState(initialStart ? isoTime(initialStart) : defaultTime);
  const [duration, setDuration] = useState(30);
  const [autoRecord, setAutoRecord] = useState(false);
  const [addToCalendar, setAddToCalendar] = useState(hasGoogle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const field = dark
    ? "bg-[var(--color-surface-2,#1e293b)] border-[var(--color-border)] text-slate-100"
    : "bg-white border-slate-300 text-slate-900";
  const labelCls = `block text-xs font-semibold mb-1 ${dark ? "text-slate-300" : "text-slate-600"}`;

  async function submit(e) {
    e?.preventDefault?.();
    if (busy) return;
    if (!title.trim()) { setError("Give the meeting a title"); return; }
    if (!effRoom) { setError("Pick a meeting room"); return; }
    const start = new Date(`${date}T${time}`);
    if (Number.isNaN(start.getTime())) { setError("Pick a valid date and time"); return; }
    const end = new Date(start.getTime() + duration * 60 * 1000);

    setBusy(true); setError("");
    let googleEventId = null;
    let googleHtmlLink = null;
    if (addToCalendar && hasGoogle) {
      const ev = await createCalendarEvent({
        summary: title.trim(),
        description: description.trim() || undefined,
        start,
        end,
        location: effRoom?.name,
      });
      // ev is null if the token needed re-consent (a redirect is under way) — in
      // that case skip the DB insert; the user re-submits after reconnecting.
      if (!ev) { setBusy(false); return; }
      googleEventId = ev.id;
      googleHtmlLink = ev.htmlLink;
    }

    const { error: insErr } = await createScheduledMeeting({
      room_id: effRoom.id,
      team_id: teamId,
      created_by: session.user.id,
      title: title.trim(),
      description: description.trim() || null,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      auto_record: autoRecord,
      google_event_id: googleEventId,
      google_html_link: googleHtmlLink,
    });
    setBusy(false);
    if (insErr) { setError(insErr.message || "Could not schedule the meeting"); return; }
    onCreated?.();
    onClose?.();
  }

  return (
    <Modal open onClose={onClose} labelledBy="schedule-meeting-title">
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md rounded-2xl border shadow-xl p-5 ${dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"}`}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="schedule-meeting-title" className={`flex items-center gap-2 text-base font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>
            <CalendarPlus className="w-4 h-4" /> Schedule a meeting
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`p-1 rounded ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-400 hover:text-slate-600"}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {!room && (
            <div>
              <label className={labelCls}>Room</label>
              {roomOptions.length ? (
                <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-sm ${field}`}>
                  {roomOptions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              ) : (
                <p className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>No rooms yet — create one in the office first.</p>
              )}
            </div>
          )}
          <div>
            <label className={labelCls}>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-sm ${field}`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-sm ${field}`} />
            </div>
            <div>
              <label className={labelCls}>Time</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`w-full rounded-lg border px-3 py-2 text-sm ${field}`} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Duration</label>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={`w-full rounded-lg border px-3 py-2 text-sm ${field}`}>
              {DURATIONS.map((d) => <option key={d} value={d}>{d} minutes</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Notes (optional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={`w-full rounded-lg border px-3 py-2 text-sm ${field}`} />
          </div>

          <label className={`flex items-center gap-2 text-sm ${dark ? "text-slate-300" : "text-slate-700"}`}>
            <input type="checkbox" checked={autoRecord} onChange={(e) => setAutoRecord(e.target.checked)} className="accent-[var(--color-accent)]" />
            Record & summarize this meeting
          </label>
          <label className={`flex items-center gap-2 text-sm ${hasGoogle ? "" : "opacity-50"} ${dark ? "text-slate-300" : "text-slate-700"}`}>
            <input type="checkbox" checked={addToCalendar} disabled={!hasGoogle} onChange={(e) => setAddToCalendar(e.target.checked)} className="accent-[var(--color-accent)]" />
            Add to my Google Calendar {hasGoogle ? "" : "(connect Google in Settings)"}
          </label>

          {error && <p className={`text-xs font-medium ${dark ? "text-red-400" : "text-red-600"}`}>{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CalendarPlus className="w-4 h-4 mr-1.5" />}
              Schedule
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
