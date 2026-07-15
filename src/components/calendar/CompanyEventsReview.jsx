import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, Check, ExternalLink, X, Loader2 } from "lucide-react";
import Modal from "../Modal";
import { publishCompanyEvents, loadPublishedIcalUids, unpublishCompanyEvent } from "../../lib/companyEvents";

// Review + confirm which Google Calendar events (suggested as "company" by the
// domain heuristic) get shared to the team calendar. Nothing is shared until the
// user checks it and hits Publish — so a mis-flagged personal event can never
// leak to the whole team unattended.
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
    setLoading(true); setErr(""); setCandidates([]); setChecked(new Set());
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

  const toggle = (uid) => setChecked((prev) => {
    const n = new Set(prev);
    if (n.has(uid)) n.delete(uid); else n.add(uid);
    return n;
  });

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
          {!loading && !err && companyDomain && candidates.length === 0 && (
            <div className="m-3 text-[13px] text-slate-500">
              No likely company events found in the next {WINDOW_DAYS} days. (We look for events that include a colleague at @{companyDomain}.)
            </div>
          )}
          {!loading && !err && candidates.map((c) => {
            const isPublished = publishedUids.has(c.icalUid);
            const isChecked = isPublished || checked.has(c.icalUid);
            return (
              <div key={c.icalUid} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isChecked}
                  disabled={isPublished || busy}
                  onClick={() => !isPublished && toggle(c.icalUid)}
                  className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                    isChecked ? "bg-cyan-600 border-cyan-600" : "border-slate-300 dark:border-slate-600"
                  } ${isPublished ? "opacity-70 cursor-default" : ""}`}
                >
                  {isChecked && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-slate-900 dark:text-slate-100 truncate">{c.title}</div>
                  <div className="text-[11.5px] text-slate-500 dark:text-slate-400 truncate">
                    {fmtWhen(c)}
                    {c.organizerEmail ? <> · {c.organizerEmail}</> : null}
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
          })}
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
