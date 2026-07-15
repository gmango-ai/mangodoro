import { useEffect } from "react";
import { X, Calendar, MapPin, Users, Pencil, Trash2, ExternalLink, DoorOpen, Video, Target } from "lucide-react";
import { oceanType } from "./oceanTheme";

// Right slide-over event detail (ocean reskin). Replaces the centered details
// modal on the calendar page. Shows type strip + metadata + Edit/Delete/nav.

function fmtWhen(start, end, allDay) {
  const s = start ? new Date(start) : null;
  if (!s || Number.isNaN(s.getTime())) return { day: "", time: "" };
  const day = s.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  if (allDay) return { day, time: "All day" };
  const t = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const e = end ? new Date(end) : null;
  return { day, time: e && !Number.isNaN(e.getTime()) ? `${t(s)} – ${t(e)}` : t(s) };
}

export default function EventSlideOver({ ev, rooms, onClose, onEditMeeting, onEditTask, onEditMilestone, onGo, onDelete, onRemoveCompany }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!ev) return null;
  const p = ev.extendedProps || {};
  const row = p.row || {};
  const meta = oceanType(p.type);
  const { day, time } = fmtWhen(ev.start, ev.end, ev.allDay);
  const cleanTitle = String(ev.title || "").replace(/^[⏳◆🏖⏱🎯]\s*/, "");
  const roomName = p.type === "meeting" ? (rooms || []).find((r) => r.id === p.roomId)?.name : null;
  const attendeeN = (row.attendee_ids?.length || 0) + (row.attendee_emails?.length || 0);

  const canEdit = ["meeting", "task", "task_due", "ptask_due", "milestone"].includes(p.type);
  const doEdit = () => {
    if (p.type === "meeting") onEditMeeting?.(row);
    else if (p.type === "milestone") onEditMilestone?.(row);
    else onEditTask?.(row, p.type === "ptask_due" ? "personal" : "planner");
  };

  return (
    <>
      <div className="cal-ocean__backdrop" onClick={onClose} />
      <aside className="cal-ocean__sheet" role="dialog" aria-modal="true">
        <div className="cal-ocean__sheet-strip" style={{ background: meta.solid }} />
        <div className="cal-ocean__sheet-body">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="cal-ocean__badge" style={{ background: meta.bg, color: meta.fg }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: meta.solid }} />
              {meta.label}
            </span>
            <button type="button" className="cal-ocean__x" aria-label="Close" onClick={onClose}><X className="w-[18px] h-[18px]" /></button>
          </div>

          <h2>{cleanTitle}</h2>

          <div className="cal-ocean__meta">
            <Calendar className="w-[18px] h-[18px]" />
            <div>
              <div style={{ fontWeight: 600 }}>{day}</div>
              <div className="sub">{time}</div>
            </div>
          </div>

          {roomName && (
            <div className="cal-ocean__meta"><MapPin className="w-[18px] h-[18px]" /><div style={{ fontWeight: 600 }}>{roomName}</div></div>
          )}
          {attendeeN > 0 && (
            <div className="cal-ocean__meta"><Users className="w-[18px] h-[18px]" /><div style={{ fontWeight: 600 }}>{attendeeN} {attendeeN === 1 ? "person" : "people"}</div></div>
          )}
          {(row.description || row.notes || p.note) && (
            <div className="cal-ocean__meta" style={{ alignItems: "flex-start" }}>
              <span style={{ width: 18 }} />
              <div style={{ fontSize: 13.5, color: "var(--o-ink-600)" }}>{row.description || row.notes || p.note}</div>
            </div>
          )}
          {p.type === "actual" && row.minutes ? (
            <div className="cal-ocean__meta"><span style={{ width: 18 }} /><div style={{ fontWeight: 600 }}>{Math.round((row.minutes / 60) * 10) / 10}h tracked</div></div>
          ) : null}
        </div>

        <div className="cal-ocean__sheet-foot">
          {canEdit && (
            <button type="button" className="cal-ocean__btn cal-ocean__btn--primary" onClick={doEdit}>
              <Pencil className="w-4 h-4" /> Edit
            </button>
          )}
          {/* navigation shortcuts */}
          {p.type === "meeting" && p.roomId && (
            <button type="button" className="cal-ocean__btn cal-ocean__btn--ghost" onClick={() => onGo(`/office/r/${p.roomId}`)} style={{ color: "var(--o-ink-700)" }}>
              <DoorOpen className="w-4 h-4" /> Room
            </button>
          )}
          {p.type === "meeting" && (
            <button type="button" className="cal-ocean__btn cal-ocean__btn--ghost" onClick={() => onGo("/meetings")} style={{ color: "var(--o-ink-700)" }}>
              <Video className="w-4 h-4" /> Summaries
            </button>
          )}
          {p.type === "goal" && (
            <button type="button" className="cal-ocean__btn cal-ocean__btn--primary" onClick={() => onGo("/team")}>
              <Target className="w-4 h-4" /> Open goals
            </button>
          )}
          {(p.type === "google" || p.type === "company") && p.htmlLink && (
            <button type="button" className="cal-ocean__btn cal-ocean__btn--primary" onClick={() => window.open(p.htmlLink, "_blank")}>
              <ExternalLink className="w-4 h-4" /> Open in Google
            </button>
          )}
          {p.type === "company" && onRemoveCompany && (
            <button type="button" className="cal-ocean__btn cal-ocean__btn--ghost" onClick={() => onRemoveCompany({ icalUid: p.icalUid, title: cleanTitle })}>
              <Trash2 className="w-4 h-4" /> Remove
            </button>
          )}
          {p.type === "milestone" && onDelete && (
            <button type="button" className="cal-ocean__btn cal-ocean__btn--ghost" onClick={() => onDelete(row)}>
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
