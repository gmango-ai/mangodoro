import { useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Copy, Users, Plus, LogIn, Link as LinkIcon, Timer } from "lucide-react";
import { supabase } from "../supabase";
import { createSyncSession, joinSyncSession } from "../lib/syncSession";
import UserAvatar from "./UserAvatar";

function modeLabel(m) {
  return m === "shortBreak" ? "Short break" : m === "longBreak" ? "Long break" : "Focus";
}
function timeLeftLabel(s) {
  if (!s) return "";
  if (!s.is_running || !s.ends_at) return `${Math.ceil((s.remaining_seconds || 0) / 60)}m`;
  return `${Math.max(0, Math.ceil((new Date(s.ends_at).getTime() - Date.now()) / 60000))}m left`;
}

export default function SyncSessionModal({ open, onClose, userId, displayName, onSessionJoined }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { setSettings } = useApp();
  const { activeTeamId, activeTeamSessions } = useTeam();

  const [tab, setTab] = useState("create");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [createdSession, setCreatedSession] = useState(null);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [nameDraft, setNameDraft] = useState(displayName || "");
  const [visibility, setVisibility] = useState(activeTeamId ? "team" : "invite_only");

  // If settings (and therefore displayName) load after this modal mounts,
  // adopt the stored name so the user doesn't have to retype it.
  useEffect(() => {
    if (displayName && !nameDraft) setNameDraft(displayName);
  }, [displayName]);

  if (!open) return null;

  const cleanName = nameDraft.trim();
  const hasName = cleanName.length > 0;

  async function ensureNameSaved() {
    if (!hasName) return false;
    if (cleanName === (displayName || "").trim()) return true;
    const { error: err } = await supabase
      .from("user_settings")
      .upsert({ user_id: userId, name: cleanName }, { onConflict: "user_id" });
    if (err) { setError(`Couldn't save your name: ${err.message}`); return false; }
    setSettings?.((prev) => ({ ...prev, name: cleanName }));
    return true;
  }

  async function handleCreate() {
    if (!hasName) { setError("Please enter a display name first."); return; }
    setLoading(true); setError("");
    if (!(await ensureNameSaved())) { setLoading(false); return; }

    const desiredVis = activeTeamId ? visibility : "invite_only";
    const teamIdToSet = activeTeamId && desiredVis === "team" ? activeTeamId : null;

    // Atomic create — sets team_id / visibility at INSERT so teammates'
    // discovery query matches as soon as the row is replicated.
    const { data, error: err } = await createSyncSession(userId, cleanName, {
      teamId: teamIdToSet,
      visibility: desiredVis,
    });
    if (err) { setError(err.message); setLoading(false); return; }

    setCreatedSession(data);
    onSessionJoined(data);
    setLoading(false);
  }

  async function handleJoin(e) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    if (!hasName) { setError("Please enter a display name first."); return; }
    setLoading(true); setError("");
    if (!(await ensureNameSaved())) { setLoading(false); return; }
    const { data, error: err } = await joinSyncSession(joinCode.trim(), cleanName);
    setLoading(false);
    if (err) {
      const msg = err.message?.includes("display_name_required")
        ? "A display name is required to join."
        : err.message || "Invalid code";
      setError(msg);
      return;
    }
    if (data?.session) onSessionJoined(data.session);
  }

  async function handleJoinActive(s) {
    if (!hasName) { setError("Please enter a display name first."); return; }
    setLoading(true); setError("");
    if (!(await ensureNameSaved())) { setLoading(false); return; }
    const { data, error: err } = await joinSyncSession(s.join_code, cleanName);
    setLoading(false);
    if (err) {
      const msg = err.message?.includes("display_name_required")
        ? "A display name is required to join."
        : err.message || "Could not join.";
      setError(msg);
      return;
    }
    if (data?.session) onSessionJoined(data.session);
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(createdSession.join_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleCopyLink() {
    const url = `${window.location.origin}/pomodoro/join/${createdSession.join_code}`;
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  const overlayCls = "fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4";
  const modalCls = `relative w-full max-w-sm rounded-2xl border p-5 sm:p-6 max-h-[calc(100dvh-1.5rem)] overflow-y-auto ${
    dark
      ? "bg-slate-900 border-slate-700 shadow-2xl shadow-black/40"
      : "bg-white border-slate-200 shadow-xl"
  }`;

  const showActive = !createdSession && activeTeamSessions?.length > 0;

  const labelCls = `text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-500"}`;

  return (
    <div className={overlayCls} onClick={onClose}>
      <div className={modalCls} onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className={`absolute top-3 right-3 p-1.5 rounded-lg transition-colors ${
            dark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-100 text-slate-500"
          }`}
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 mb-5">
          <Users className="w-5 h-5 text-[var(--color-accent)]" />
          <h2 className={`text-lg font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
            Sync Pomodoro
          </h2>
        </div>

        {!createdSession && (
          <div className="mb-4">
            <label className={labelCls}>Your display name</label>
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value.slice(0, 60))}
              placeholder="Required"
              className={`mt-1 ${dark ? "bg-slate-800/60 border-slate-700 text-slate-100" : ""}`}
            />
          </div>
        )}

        {showActive && (
          <div className="mb-4">
            <div className="flex items-center gap-1.5 mb-2">
              <Timer className="w-3.5 h-3.5 text-[var(--color-accent)]" />
              <span className={labelCls}>Live team sessions</span>
            </div>
            <ul className="space-y-1.5 max-h-44 overflow-y-auto -mx-1 px-1">
              {activeTeamSessions.map((s) => (
                <li
                  key={s.id}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg ${
                    dark ? "bg-slate-800/50 hover:bg-slate-800/80" : "bg-slate-50 hover:bg-slate-100"
                  } transition-colors`}
                >
                  <UserAvatar url={s.leader_avatar} name={s.leader_name} size={28} className="shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
                      {s.leader_name}
                    </p>
                    <p className={`text-[10px] truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
                      {modeLabel(s.mode)} · {s.participant_count}/{s.max_participants} · {timeLeftLabel(s)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleJoinActive(s)}
                    disabled={loading || !hasName}
                    className="shrink-0 h-7 px-2.5 text-xs"
                  >
                    Join
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2 mt-3 mb-1">
              <div className={`flex-1 h-px ${dark ? "bg-slate-700" : "bg-slate-200"}`} />
              <span className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>or</span>
              <div className={`flex-1 h-px ${dark ? "bg-slate-700" : "bg-slate-200"}`} />
            </div>
          </div>
        )}

        <div className="flex gap-1 mb-4">
          <Button
            variant={tab === "create" ? "default" : "outline"}
            size="sm"
            className="flex-1"
            onClick={() => { setTab("create"); setError(""); setCreatedSession(null); }}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Create
          </Button>
          <Button
            variant={tab === "join" ? "default" : "outline"}
            size="sm"
            className="flex-1"
            onClick={() => { setTab("join"); setError(""); }}
          >
            <LogIn className="w-3.5 h-3.5 mr-1" /> Join
          </Button>
        </div>

        {error && (
          <div className={`text-sm font-medium px-3 py-2 rounded-lg mb-4 ${
            dark ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"
          }`}>
            {error}
          </div>
        )}

        {tab === "create" && !createdSession && (
          <div className="space-y-3">
            {activeTeamId && (
              <ToggleRow
                dark={dark}
                label="Open to team"
                hint="Teammates see your session and can join with one click."
                value={visibility === "team"}
                onChange={(on) => setVisibility(on ? "team" : "invite_only")}
              />
            )}
            <p className={`text-[11px] ${dark ? "text-slate-400" : "text-slate-500"}`}>
              You control the timer. Others can take control after joining.
            </p>

            <Button onClick={handleCreate} disabled={loading || !hasName} className="w-full">
              {loading ? "Creating…" : "Create session"}
            </Button>
          </div>
        )}

        {tab === "create" && createdSession && (
          <div className="space-y-3">
            <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
              Share this code or the invite link:
            </p>
            <div className={`flex items-center justify-center gap-3 px-4 py-3 rounded-xl font-mono text-2xl tracking-[0.3em] font-bold ${
              dark ? "bg-slate-800 text-[var(--color-accent)]" : "bg-slate-50 text-[var(--color-accent)]"
            }`}>
              {createdSession.join_code}
              <button onClick={handleCopy} className="p-1.5 rounded-lg hover:bg-slate-700/50 transition-colors">
                <Copy className={`w-5 h-5 ${copied ? "text-emerald-400" : dark ? "text-slate-500" : "text-slate-400"}`} />
              </button>
            </div>
            <button
              type="button"
              onClick={handleCopyLink}
              className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-colors ${
                dark
                  ? "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              <LinkIcon className="w-4 h-4" />
              {linkCopied ? "Link copied!" : "Copy invite link"}
            </button>
            <p className={`text-[11px] text-center ${dark ? "text-slate-500" : "text-slate-400"}`}>
              {copied
                ? "Code copied!"
                : `You control the timer · Visibility: ${createdSession.visibility === "team" ? "team-visible" : "invite-only"}`}
            </p>
          </div>
        )}

        {tab === "join" && (
          <form onSubmit={handleJoin} className="space-y-3">
            <p className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
              Enter the 6-character code from your coworker.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="ABC123"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={6}
                className={`flex-1 font-mono text-center text-lg tracking-widest ${
                  dark ? "bg-slate-800/60 border-slate-700 text-slate-100" : ""
                }`}
              />
              <Button type="submit" disabled={loading || joinCode.length < 3 || !hasName}>
                {loading ? "Joining…" : "Join"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ToggleRow({ dark, label, hint, value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border transition-colors text-left ${
        dark
          ? "bg-slate-800/40 border-slate-700 hover:bg-slate-800/70"
          : "bg-slate-50 border-slate-200 hover:bg-slate-100"
      }`}
    >
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${dark ? "text-slate-100" : "text-slate-800"}`}>{label}</p>
        {hint && <p className={`text-[11px] ${dark ? "text-slate-400" : "text-slate-500"}`}>{hint}</p>}
      </div>
      <span
        className={`shrink-0 w-9 h-5 rounded-full relative transition-colors ${
          value
            ? "bg-[var(--color-accent)]"
            : dark ? "bg-slate-700" : "bg-slate-300"
        }`}
        aria-pressed={value}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
            value ? "translate-x-4" : ""
          }`}
        />
      </span>
    </button>
  );
}
