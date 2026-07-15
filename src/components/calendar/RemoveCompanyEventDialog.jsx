import { useEffect, useState } from "react";
import { Trash2, Check, Loader2, X, CalendarClock, Layers } from "lucide-react";
import Modal from "../Modal";
import { loadCompanySeries, unpublishCompanyEvent, unpublishCompanyEventsByKeys } from "../../lib/companyEvents";

// Remove a company event from the shared team calendar. When the event is part
// of a recurring series, offer: this one · all in the series · a hand-picked
// selection. A one-off event just confirms the single removal.

function fmtWhen(iso, allDay) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (allDay) return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function RemoveCompanyEventDialog({ open, teamId, icalUid, title, onClose, onRemoved }) {
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("choose"); // "choose" | "select"
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true); setErr(""); setMode("choose"); setPicked(new Set(icalUid ? [icalUid] : []));
    (async () => {
      const rows = teamId ? await loadCompanySeries(teamId, icalUid) : [];
      if (!cancelled) { setSeries(rows); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open, teamId, icalUid]);

  const recurring = series.length > 1;

  const done = async (fn) => {
    setBusy(true); setErr("");
    const { error } = await fn();
    setBusy(false);
    if (error) { setErr(error.message || "Couldn't remove from the team calendar."); return; }
    onRemoved?.();
    onClose?.();
  };

  const removeThis = () => done(() => unpublishCompanyEvent(teamId, icalUid));
  const removeAll = () => done(() => unpublishCompanyEventsByKeys(teamId, series.map((s) => s.ical_uid)));
  const removeSelected = () => done(() => unpublishCompanyEventsByKeys(teamId, [...picked]));

  const toggle = (uid) => setPicked((prev) => {
    const n = new Set(prev);
    if (n.has(uid)) n.delete(uid); else n.add(uid);
    return n;
  });

  const choice = "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-left disabled:opacity-50";

  return (
    <Modal open={open} onClose={onClose} overlayClassName="z-[220]" labelledBy="remove-company-title">
      <div className="w-full max-w-md max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-black/10 dark:ring-white/10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-slate-200 dark:border-slate-700">
          <div className="mt-0.5 shrink-0 w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
            <Trash2 className="w-4 h-4 text-red-600 dark:text-red-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="remove-company-title" className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">Remove from company calendar</h2>
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{title}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-4 h-4 text-slate-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-slate-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
          )}
          {!loading && err && (
            <div className="mb-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 text-[13px] px-3 py-2">{err}</div>
          )}

          {!loading && !recurring && (
            <p className="text-[13px] text-slate-600 dark:text-slate-300">
              Remove this event from the shared team calendar? It stays in your personal Google Calendar.
            </p>
          )}

          {!loading && recurring && mode === "choose" && (
            <div className="space-y-2">
              <button type="button" className={choice} disabled={busy} onClick={removeThis}>
                <CalendarClock className="w-4 h-4 text-slate-500 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-medium text-slate-900 dark:text-slate-100">This event only</span>
                  <span className="block text-[11.5px] text-slate-500">{fmtWhen(series.find((s) => s.ical_uid === icalUid)?.starts_at || series[0]?.starts_at, series[0]?.all_day)}</span>
                </span>
              </button>
              <button type="button" className={choice} disabled={busy} onClick={removeAll}>
                <Layers className="w-4 h-4 text-slate-500 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-medium text-slate-900 dark:text-slate-100">All events in this series</span>
                  <span className="block text-[11.5px] text-slate-500">{series.length} shared occurrences</span>
                </span>
              </button>
              <button type="button" className={choice} disabled={busy} onClick={() => setMode("select")}>
                <Check className="w-4 h-4 text-slate-500 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-medium text-slate-900 dark:text-slate-100">Select specific events…</span>
                  <span className="block text-[11.5px] text-slate-500">Choose which occurrences to remove</span>
                </span>
              </button>
            </div>
          )}

          {!loading && recurring && mode === "select" && (
            <div>
              {series.map((s) => {
                const on = picked.has(s.ical_uid);
                return (
                  <button key={s.ical_uid} type="button" onClick={() => toggle(s.ical_uid)} className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 text-left">
                    <span className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center ${on ? "bg-red-600 border-red-600" : "border-slate-300 dark:border-slate-600"}`}>
                      {on && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                    </span>
                    <span className="text-[12.5px] text-slate-700 dark:text-slate-200">{fmtWhen(s.starts_at, s.all_day)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-700">
          {recurring && mode === "select" && <button type="button" onClick={() => setMode("choose")} className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Back</button>}
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Cancel</button>
          {(!recurring || mode === "select") && (
            <button
              type="button"
              onClick={recurring ? removeSelected : removeThis}
              disabled={busy || (recurring && picked.size === 0)}
              className="px-3.5 py-1.5 rounded-lg text-[13px] font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {recurring ? `Remove ${picked.size}` : "Remove"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
