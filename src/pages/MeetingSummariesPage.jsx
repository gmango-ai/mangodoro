import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Video, Users, Clock, Download, ExternalLink, FileText,
  Loader2, CheckCircle2, AlertCircle, ChevronDown, ChevronRight, Music,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTeam } from "../context/TeamContext";
import { useApp } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import MarkdownText from "../components/MarkdownText";
import { SkeletonCard } from "../components/Skeleton";
import { listMeetingSummaries, getMeetingDetail, recordDocExport, getRecordingAudioUrl } from "../lib/meetingRecordings";

function fmtDuration(sec) {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

function fmtDateTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch { return iso; }
}

function StatusBadge({ status, dark }) {
  const map = {
    recording: { icon: Video, label: "Recording", cls: dark ? "text-red-400 bg-red-500/15" : "text-red-600 bg-red-50" },
    starting: { icon: Loader2, label: "Starting", cls: dark ? "text-red-400 bg-red-500/15" : "text-red-600 bg-red-50" },
    processing: { icon: Loader2, label: "Processing", cls: dark ? "text-amber-400 bg-amber-500/15" : "text-amber-600 bg-amber-50" },
    ready: { icon: CheckCircle2, label: "Ready", cls: dark ? "text-emerald-400 bg-emerald-500/15" : "text-emerald-600 bg-emerald-50" },
    failed: { icon: AlertCircle, label: "Failed", cls: dark ? "text-red-400 bg-red-500/15" : "text-red-600 bg-red-50" },
    stopped: { icon: AlertCircle, label: "Stopped", cls: dark ? "text-slate-400 bg-slate-500/15" : "text-slate-500 bg-slate-100" },
  };
  const s = map[status] || map.stopped;
  const Icon = s.icon;
  const spin = status === "processing" || status === "starting";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${s.cls}`}>
      <Icon className={`w-3 h-3 ${spin ? "animate-spin" : ""}`} />
      {s.label}
    </span>
  );
}

export default function MeetingSummariesPage() {
  const { recordingId } = useParams();
  return recordingId ? <MeetingDetail recordingId={recordingId} /> : <MeetingList />;
}

function MeetingList() {
  const { activeTeamId, rooms } = useTeam();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const roomName = useMemo(() => {
    const m = new Map((rooms || []).map((r) => [r.id, r.name]));
    return (id) => m.get(id) || "Meeting room";
  }, [rooms]);

  useEffect(() => {
    let cancelled = false;
    if (!activeTeamId) { setRows([]); setLoading(false); return () => {}; }
    setLoading(true);
    listMeetingSummaries(activeTeamId).then(({ data }) => {
      if (cancelled) return;
      setRows(data || []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeTeamId]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <div className="flex items-center gap-2 mb-1">
        <Video className={`w-5 h-5 ${dark ? "text-slate-300" : "text-slate-600"}`} />
        <h1 className={`text-xl font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>Meeting summaries</h1>
      </div>
      <p className={`text-sm mb-5 ${dark ? "text-slate-400" : "text-slate-500"}`}>
        Recordings from your rooms, transcribed and summarized.
      </p>

      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <SkeletonCard key={i} />)}</div>
      ) : rows.length === 0 ? (
        <div className={`rounded-xl border border-dashed p-8 text-center ${dark ? "border-[var(--color-border)] text-slate-400" : "border-slate-200 text-slate-500"}`}>
          <FileText className="w-8 h-8 mx-auto mb-2 opacity-60" />
          <p className="text-sm font-medium">No meeting summaries yet</p>
          <p className="text-xs mt-1">Start a recording from a room's call to capture one.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const summary = Array.isArray(r.meeting_summaries) ? r.meeting_summaries[0] : r.meeting_summaries;
            const clickable = r.status === "ready" || r.status === "processing";
            const body = (
              <div className={`rounded-xl border p-4 transition-colors ${dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-white"} ${clickable ? (dark ? "hover:border-slate-600" : "hover:border-slate-300") : "opacity-70"}`}>
                <div className="flex items-center justify-between gap-3 mb-1">
                  <span className={`font-semibold truncate ${dark ? "text-slate-100" : "text-slate-900"}`}>{roomName(r.room_id)}</span>
                  <StatusBadge status={r.status} dark={dark} />
                </div>
                <div className={`flex items-center gap-3 text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>
                  <span>{fmtDateTime(r.started_at)}</span>
                  <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{fmtDuration(r.duration_seconds)}</span>
                  <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" />{(r.participant_ids || []).length}</span>
                  {summary?.exported_doc_url && <span className="inline-flex items-center gap-1"><ExternalLink className="w-3 h-3" />Doc</span>}
                </div>
                {summary?.summary_md && (
                  <p className={`text-sm mt-2 line-clamp-2 ${dark ? "text-slate-300" : "text-slate-600"}`}>
                    {summary.summary_md.replace(/[#*_`>-]/g, "").slice(0, 180)}
                  </p>
                )}
              </div>
            );
            return (
              <li key={r.id}>
                {clickable ? <Link to={`/meetings/${r.id}`}>{body}</Link> : body}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MeetingDetail({ recordingId }) {
  const { rooms } = useTeam();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { exportToGoogleDoc } = useApp();
  const navigate = useNavigate();

  const [rec, setRec] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportedUrl, setExportedUrl] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);

  const load = useCallback(async () => {
    const { data } = await getMeetingDetail(recordingId);
    setRec(data || null);
    setLoading(false);
    const s = data && (Array.isArray(data.meeting_summaries) ? data.meeting_summaries[0] : data.meeting_summaries);
    if (s?.exported_doc_url) setExportedUrl(s.exported_doc_url);
  }, [recordingId]);

  useEffect(() => { load(); }, [load]);

  // Signed URL for the private audio (available once the egress has uploaded it,
  // i.e. status processing/ready). RLS gates it to the room's team members.
  useEffect(() => {
    let cancelled = false;
    const path = rec?.storage_path;
    if (!path || !["ready", "processing"].includes(rec?.status)) { setAudioUrl(null); return () => {}; }
    getRecordingAudioUrl(path).then(({ data }) => {
      if (!cancelled) setAudioUrl(data?.signedUrl || null);
    });
    return () => { cancelled = true; };
  }, [rec?.storage_path, rec?.status]);

  const roomName = useMemo(() => {
    const m = new Map((rooms || []).map((r) => [r.id, r.name]));
    return rec ? (m.get(rec.room_id) || "Meeting room") : "";
  }, [rooms, rec]);

  const summary = rec && (Array.isArray(rec.meeting_summaries) ? rec.meeting_summaries[0] : rec.meeting_summaries);
  const transcript = rec && (Array.isArray(rec.meeting_transcripts) ? rec.meeting_transcripts[0] : rec.meeting_transcripts);
  const keyPoints = Array.isArray(summary?.key_points) ? summary.key_points : [];
  const actionItems = Array.isArray(summary?.action_items) ? summary.action_items : [];

  async function handleExport() {
    if (!summary || exporting) return;
    setExporting(true);
    const doc = await exportToGoogleDoc({
      title: `${roomName} — ${fmtDateTime(rec.started_at)}`,
      summaryMd: summary.summary_md,
      transcriptText: transcript?.full_text || "",
    });
    if (doc?.documentId) {
      await recordDocExport(recordingId, doc.documentId, doc.url);
      setExportedUrl(doc.url);
      window.open(doc.url, "_blank");
    }
    setExporting(false);
  }

  if (loading) {
    return <div className="mx-auto w-full max-w-3xl px-4 py-6"><SkeletonCard /></div>;
  }
  if (!rec) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <Link to="/meetings" className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>← Back to meetings</Link>
        <p className={`mt-4 ${dark ? "text-slate-300" : "text-slate-600"}`}>Meeting not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <button
        type="button"
        onClick={() => navigate("/meetings")}
        className={`inline-flex items-center gap-1 text-sm mb-4 ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}
      >
        <ArrowLeft className="w-4 h-4" /> Meetings
      </button>

      <div className="flex items-start justify-between gap-3 mb-1">
        <h1 className={`text-xl font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>{roomName}</h1>
        <StatusBadge status={rec.status} dark={dark} />
      </div>
      <div className={`flex items-center gap-3 text-xs mb-5 ${dark ? "text-slate-400" : "text-slate-500"}`}>
        <span>{fmtDateTime(rec.started_at)}</span>
        <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{fmtDuration(rec.duration_seconds)}</span>
        <span className="inline-flex items-center gap-1"><Users className="w-3 h-3" />{(rec.participant_ids || []).length}</span>
        <Link to={`/office/r/${rec.room_id}`} className="underline underline-offset-2 hover:opacity-80">Open room</Link>
      </div>

      {rec.status === "processing" && (
        <div className={`rounded-xl border p-4 mb-4 text-sm ${dark ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
          <Loader2 className="w-4 h-4 inline animate-spin mr-1.5" />
          Transcribing and summarizing — this can take a couple of minutes.
        </div>
      )}
      {rec.status === "failed" && (
        <div className={`rounded-xl border p-4 mb-4 text-sm ${dark ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-red-200 bg-red-50 text-red-700"}`}>
          Recording couldn't be processed{rec.error ? `: ${rec.error}` : "."}
        </div>
      )}

      {audioUrl && (
        <section className={`rounded-xl border p-4 mb-4 ${dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-white"}`}>
          <div className="flex items-center justify-between mb-2">
            <h2 className={`flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide ${dark ? "text-slate-400" : "text-slate-500"}`}>
              <Music className="w-3.5 h-3.5" /> Recording
            </h2>
            <a href={audioUrl} target="_blank" rel="noreferrer" download className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline">
              <Download className="w-3.5 h-3.5" /> Download
            </a>
          </div>
          <audio controls preload="metadata" src={audioUrl} className="w-full" />
        </section>
      )}

      {summary?.summary_md && (
        <section className={`rounded-xl border p-4 mb-4 ${dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-white"}`}>
          <div className="flex items-center justify-between mb-2">
            <h2 className={`text-sm font-bold uppercase tracking-wide ${dark ? "text-slate-400" : "text-slate-500"}`}>Summary</h2>
            <div className="flex items-center gap-2">
              {exportedUrl && (
                <a href={exportedUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline">
                  <ExternalLink className="w-3.5 h-3.5" /> Open doc
                </a>
              )}
              <Button size="sm" variant="outline" onClick={handleExport} disabled={exporting}>
                {exporting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
                Export to Google Doc
              </Button>
            </div>
          </div>
          <div className={dark ? "text-slate-200" : "text-slate-700"}>
            <MarkdownText dark={dark}>{summary.summary_md}</MarkdownText>
          </div>
        </section>
      )}

      {keyPoints.length > 0 && (
        <section className={`rounded-xl border p-4 mb-4 ${dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-white"}`}>
          <h2 className={`text-sm font-bold uppercase tracking-wide mb-2 ${dark ? "text-slate-400" : "text-slate-500"}`}>Key points</h2>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            {keyPoints.map((k, i) => <li key={i} className={dark ? "text-slate-200" : "text-slate-700"}>{typeof k === "string" ? k : JSON.stringify(k)}</li>)}
          </ul>
        </section>
      )}

      {actionItems.length > 0 && (
        <section className={`rounded-xl border p-4 mb-4 ${dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-white"}`}>
          <h2 className={`text-sm font-bold uppercase tracking-wide mb-2 ${dark ? "text-slate-400" : "text-slate-500"}`}>Action items</h2>
          <ul className="space-y-1.5 text-sm">
            {actionItems.map((a, i) => {
              const text = typeof a === "string" ? a : a?.text;
              const who = typeof a === "object" ? a?.assignee : null;
              return (
                <li key={i} className={`flex items-start gap-2 ${dark ? "text-slate-200" : "text-slate-700"}`}>
                  <span className="mt-1 w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] shrink-0" />
                  <span>{text}{who ? <span className={`ml-1.5 text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>— {who}</span> : null}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {transcript?.full_text && (
        <section className={`rounded-xl border p-4 ${dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-white"}`}>
          <button
            type="button"
            onClick={() => setShowTranscript((v) => !v)}
            className={`flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide ${dark ? "text-slate-400" : "text-slate-500"}`}
          >
            {showTranscript ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Transcript
          </button>
          {showTranscript && (
            <div className={`mt-3 text-sm whitespace-pre-wrap leading-relaxed ${dark ? "text-slate-300" : "text-slate-600"}`}>
              {Array.isArray(transcript.segments) && transcript.segments.length > 0
                ? transcript.segments.map((s, i) => <p key={i} className="my-1">{s.text}</p>)
                : transcript.full_text}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
