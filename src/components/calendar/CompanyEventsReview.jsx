import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Check, ChevronRight, ChevronDown, Repeat, ExternalLink, X, Loader2 } from "lucide-react";
import Modal from "../Modal";
import { publishCompanyEvents, loadPublishedIcalUids, unpublishCompanyEvent } from "../../lib/companyEvents";

// Review + confirm which Google Calendar events (suggested as "company" by the
// domain heuristic) get shared to the team calendar. Nothing is shared until the
// user checks it and hits Publish — so a mis-flagged personal event can never
// leak to the whole team unattended. Recurring events collapse to ONE row (all
// occurrences), expandable to pick specific ones.
const WINDOW_DAYS = 45;

function fmtWhen(c) {
  if (!c.start) return "";
  const d = new Date(c.start);
  if (c.allDay) return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function CompanyEventsReview({ open, onClose, teamId, userId, companyDomain, fetchCandidates, onChanged }) {
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [publishedUids, setPublishedUids] = useState(new Set());
  const [checked, setChecked] = useState(new Set());
  const [expanded, setExpanded] = useState(new Set()); // series keys drilled open
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // AppContext recreates fetchCandidates on every render; read it via a ref so a
  // background re-render can't re-trigger the fetch effect and wipe the user's
  // in-progress checkbox selections. The fetch runs only when the modal opens.
  const fetchRef = useRef(fetchCandidates);
  fetchRef.current = fetchCandidates;

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true); setErr(""); setCandidates([]); setChecked(new Set()); setExpanded(new Set());
    const now = new Date();
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + WINDOW_DAYS * 864e5).toISOString();
    (async () => {
      const list = await fetchRef.current?.({ timeMin, timeMax });
      const pub = teamId ? await loadPublishedIcalUids(teamId, timeMin, timeMax) : new Set();
      if (cancelled) return;
      if (list == null) {
        setErr("Couldn't read your Google Calendar. Reconnect Google and try again.");
      } else {
        setCandidates(list);
        setPublishedUids(pub);
        // Pre-check the suggestions that aren't already shared.
        setChecked(new Set(list.filter((c) => !pub.has(c.icalUid)).map((c) => c.icalUid)));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, teamId]);

  // Group by recurring series (recurringEventId); one-off events are their own
  // singleton group keyed by their occurrence id. Items sorted by start.
  const groups = useMemo(() => {
    const map = new Map();
    for (const c of candidates) {
      const key = c.seriesId || c.icalUid;
      if (!map.has(key)) map.set(key, { key, title: c.title, recurring: !!c.seriesId, items: [] });
      map.get(key).items.push(c);
    }
    const out = [...map.values()];
    out.forEach((g) => g.items.sort((a, b) => new Date(a.start) - new Date(b.start)));
    // Earliest upcoming first.
    out.sort((a, b) => new Date(a.items[0]?.start || 0) - new Date(b.items[0]?.start || 0));
    return out;
  }, [candidates]);

  const toggle = (uid) => setChecked((prev) => {
    const n = new Set(prev);
    if (n.has(uid)) n.delete(uid); else n.add(uid);
    return n;
  });

  const toggleExpanded = (key) => setExpanded((prev) => {
    const n = new Set(prev);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  // Master check for a whole series — affects only the not-yet-shared instances.
  const toggleGroup = (items) => {
    const selectable = items.filter((i) => !publishedUids.has(i.icalUid));
    const allSel = selectable.length > 0 && selectable.every((i) => checked.has(i.icalUid));
    setChecked((prev) => {
      const n = new Set(prev);
      selectable.forEach((i) => { if (allSel) n.delete(i.icalUid); else n.add(i.icalUid); });
      return n;
    });
  };

  const selectableCount = useMemo(
    () => candidates.filter((c) => !publishedUids.has(c.icalUid) && checked.has(c.icalUid)).length,
    [candidates, publishedUids, checked],
  );

  const publish = async () => {
    const sel = candidates.filter((c) => !publishedUids.has(c.icalUid) && checked.has(c.icalUid));
    if (!sel.length || !teamId || !userId) return;
    setBusy(true); setErr("");
    const { error } = await publishCompanyEvents(teamId, userId, sel);
    setBusy(false);
    if (error) { setErr(error.message || "Couldn't publish to the team calendar."); return; }
    setPublishedUids((prev) => { const n = new Set(prev); sel.forEach((c) => n.add(c.icalUid)); return n; });
    onChanged?.();
  };

  const unpublish = async (uid) => {
    if (!teamId) return;
    setBusy(true);
    const { error } = await unpublishCompanyEvent(teamId, uid);
    setBusy(false);
    if (error) { setErr(error.message || "Couldn't remove it from the team calendar."); return; }
    setPublishedUids((prev) => { const n = new Set(prev); n.delete(uid); return n; });
    setChecked((prev) => { const n = new Set(prev); n.delete(uid); return n; });
    onChanged?.();
  };

  // A checkbox in the "box" visual states: on | off | mixed (indeterminate).
  const Box = ({ state, disabled, onClick }) => (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "mixed" ? "mixed" : state === "on"}
      disabled={disabled}
      onClick={onClick}
      className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
        state === "off" ? "border-slate-300 dark:border-slate-600" : "bg-cyan-600 border-cyan-600"
      } ${disabled ? "opacity-70 cursor-default" : ""}`}
    >
      {state === "on" && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
      {state === "mixed" && <span className="w-2.5 h-0.5 bg-white rounded" />}
    </button>
  );

  // One occurrence row (also used for a one-off event). `indent` for expanded
  // instances under a series header.
  const renderRow = (c, indent = false) => {
    const isPublished = publishedUids.has(c.icalUid);
    const isChecked = isPublished || checked.has(c.icalUid);
    return (
      <div key={c.icalUid} className={`flex items-center gap-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 ${indent ? "pl-11 pr-3" : "px-3"}`}>
        <Box state={isChecked ? "on" : "off"} disabled={isPublished || busy} onClick={() => !isPublished && toggle(c.icalUid)} />
        <div className="flex-1 min-w-0">
          {!indent && <div className="text-[13px] font-medium text-slate-900 dark:text-slate-100 truncate">{c.title}</div>}
          <div className="text-[11.5px] text-slate-500 dark:text-slate-400 truncate">
            {fmtWhen(c)}
            {!indent && c.organizerEmail ? <> · {c.organizerEmail}</> : null}
          </div>
        </div>
        {c.htmlLink && (
          <a href={c.htmlLink} target="_blank" rel="noreferrer" className="shrink-0 p-1 text-slate-400 hover:text-slate-600" title="Open in Google Calendar">
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
        {isPublished && (
          <button type="button" disabled={busy} onClick={() => unpublish(c.icalUid)}
            className="shrink-0 text-[11px] font-semibold px-2 py-1 rounded-md text-cyan-700 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-900/30 hover:bg-cyan-100">
            Shared · Remove
          </button>
        )}
      </div>
    );
  };

  const renderSeries = (g) => {
    const selectable = g.items.filter((i) => !publishedUids.has(i.icalUid));
    const selCount = selectable.filter((i) => checked.has(i.icalUid)).length;
    const pubCount = g.items.length - selectable.length;
    const state = selectable.length === 0 ? "on" : selCount === 0 ? "off" : selCount === selectable.length ? "on" : "mixed";
    const isOpen = expanded.has(g.key);
    return (
      <div key={g.key}>
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60">
          <Box state={state} disabled={selectable.length === 0 || busy} onClick={() => toggleGroup(g.items)} />
          <button type="button" onClick={() => toggleExpanded(g.key)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
            {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-medium text-slate-900 dark:text-slate-100 truncate">{g.title}</span>
              <span className="block text-[11.5px] text-slate-500 dark:text-slate-400 truncate inline-flex items-center gap-1">
                <Repeat className="w-3 h-3" /> Recurring · {g.items.length} upcoming
                {pubCount > 0 ? ` · ${pubCount} shared` : ""}
              </span>
            </span>
          </button>
        </div>
        {isOpen && g.items.map((i) => renderRow(i, true))}
      </div>
    );
  };

  return (
    <Modal open={open} onClose={onClose} overlayClassName="z-[210]" labelledBy="company-review-title">
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-black/10 dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-slate-200 dark:border-slate-700">
          <div className="mt-0.5 shrink-0 w-8 h-8 rounded-lg bg-cyan-100 dark:bg-cyan-900/40 flex items-center justify-center">
            <Building2 className="w-4 h-4 text-cyan-600 dark:text-cyan-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="company-review-title" className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">Company events from Google</h2>
            <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
              We flag events that involve someone
              {companyDomain ? <> at <span className="font-medium">@{companyDomain}</span></> : " at your company"}.
              Check the ones to add to the shared team calendar — nothing is shared until you publish.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Reading your Google Calendar…
            </div>
          )}
          {!loading && err && (
            <div className="m-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 text-[13px] px-3 py-2">{err}</div>
          )}
          {!loading && !err && !companyDomain && (
            <div className="m-3 text-[13px] text-slate-500">Your account has no email domain to match company events against.</div>
          )}
          {!loading && !err && companyDomain && groups.length === 0 && (
            <div className="m-3 text-[13px] text-slate-500">
              No likely company events found in the next {WINDOW_DAYS} days. (We look for events that include a colleague at @{companyDomain}.)
            </div>
          )}
          {!loading && !err && groups.map((g) => (
            g.recurring && g.items.length > 1 ? renderSeries(g) : renderRow(g.items[0], false)
          ))}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-200 dark:border-slate-700">
          <span className="text-[12px] text-slate-500">{selectableCount} selected to share</span>
          <div className="flex-1" />
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
            Done
          </button>
          <button
            type="button"
            onClick={publish}
            disabled={busy || selectableCount === 0}
            className="px-3.5 py-1.5 rounded-lg text-[13px] font-semibold text-white bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Publish to team calendar
          </button>
        </div>
      </div>
    </Modal>
  );
}
