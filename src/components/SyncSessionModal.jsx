import { useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { useApp } from "../context/AppContext";
import { useTeam } from "../context/TeamContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Copy, Users, Plus, LogIn, Link as LinkIcon } from "lucide-react";
import { supabase } from "../supabase";
import { createSyncSession, joinSyncSession } from "../lib/syncSession";

export default function SyncSessionModal({ open, onClose, userId, displayName, onSessionJoined }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { setSettings } = useApp();
  const { activeTeamId } = useTeam();

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

  const overlayCls = "fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm";
  const modalCls = `relative w-full max-w-sm mx-4 rounded-2xl border p-6 ${
    dark
      ? "bg-slate-900 border-slate-700 shadow-2xl shadow-black/40"
      : "bg-white border-slate-200 shadow-xl"
  }`;

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
          <Users className={`w-5 h-5 ${dark ? "text-cyan-400" : "text-teal-600"}`} />
          <h2 className={`text-lg font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
            Sync Pomodoro
          </h2>
        </div>

        <div className="flex gap-1 mb-5">
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

        {!createdSession && (
          <div className="mb-3">
            <label className={labelCls}>Your display name</label>
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value.slice(0, 60))}
              placeholder="Required"
              className={`mt-1 ${dark ? "bg-slate-800/60 border-slate-700 text-slate-100" : ""}`}
            />
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
              dark ? "bg-slate-800 text-cyan-400" : "bg-slate-50 text-teal-600"
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
            ? dark ? "bg-cyan-500" : "bg-teal-600"
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
