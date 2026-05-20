import { useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Copy, Users, Plus, LogIn } from "lucide-react";
import { createSyncSession, joinSyncSession } from "../lib/syncSession";

export default function SyncSessionModal({ open, onClose, userId, displayName, onSessionJoined }) {
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [tab, setTab] = useState("create");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [createdCode, setCreatedCode] = useState("");
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  async function handleCreate() {
    setLoading(true); setError("");
    const { data, error: err } = await createSyncSession(userId, displayName);
    setLoading(false);
    if (err) { setError(err.message); return; }
    setCreatedCode(data.join_code);
    onSessionJoined(data);
  }

  async function handleJoin(e) {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setLoading(true); setError("");
    const { data, error: err } = await joinSyncSession(joinCode.trim(), displayName);
    setLoading(false);
    if (err) { setError(err.message || "Invalid code"); return; }
    if (data?.session) {
      onSessionJoined(data.session);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(createdCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const overlayCls = "fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm";
  const modalCls = `relative w-full max-w-sm mx-4 rounded-2xl border p-6 ${
    dark
      ? "bg-slate-900 border-slate-700 shadow-2xl shadow-black/40"
      : "bg-white border-slate-200 shadow-xl"
  }`;

  return (
    <div className={overlayCls} onClick={onClose}>
      <div className={modalCls} onClick={(e) => e.stopPropagation()}>
        {/* Close */}
        <button
          onClick={onClose}
          className={`absolute top-3 right-3 p-1.5 rounded-lg transition-colors ${
            dark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-100 text-slate-500"
          }`}
        >
          <X className="w-4 h-4" />
        </button>

        {/* Title */}
        <div className="flex items-center gap-2 mb-5">
          <Users className={`w-5 h-5 ${dark ? "text-cyan-400" : "text-teal-600"}`} />
          <h2 className={`text-lg font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
            Sync Pomodoro
          </h2>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5">
          <Button
            variant={tab === "create" ? "default" : "outline"}
            size="sm"
            className="flex-1"
            onClick={() => { setTab("create"); setError(""); setCreatedCode(""); }}
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

        {/* Error */}
        {error && (
          <div className={`text-sm font-medium px-3 py-2 rounded-lg mb-4 ${
            dark ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"
          }`}>
            {error}
          </div>
        )}

        {/* Create Tab */}
        {tab === "create" && !createdCode && (
          <div className="text-center">
            <p className={`text-sm mb-4 ${dark ? "text-slate-400" : "text-slate-500"}`}>
              Start a sync session and share the code with a coworker.
            </p>
            <Button onClick={handleCreate} disabled={loading} className="w-full">
              {loading ? "Creating…" : "Create Session"}
            </Button>
          </div>
        )}

        {/* Created — show code */}
        {tab === "create" && createdCode && (
          <div className="text-center">
            <p className={`text-sm mb-3 ${dark ? "text-slate-400" : "text-slate-500"}`}>
              Share this code with your coworker:
            </p>
            <div className={`flex items-center justify-center gap-3 px-4 py-3 rounded-xl font-mono text-2xl tracking-[0.3em] font-bold ${
              dark ? "bg-slate-800 text-cyan-400" : "bg-slate-50 text-teal-600"
            }`}>
              {createdCode}
              <button onClick={handleCopy} className="p-1.5 rounded-lg hover:bg-slate-700/50 transition-colors">
                <Copy className={`w-5 h-5 ${copied ? "text-emerald-400" : dark ? "text-slate-500" : "text-slate-400"}`} />
              </button>
            </div>
            <p className={`text-xs mt-3 ${dark ? "text-slate-500" : "text-slate-400"}`}>
              {copied ? "Copied!" : "The timer is ready — waiting for your coworker."}
            </p>
          </div>
        )}

        {/* Join Tab */}
        {tab === "join" && (
          <form onSubmit={handleJoin}>
            <p className={`text-sm mb-4 ${dark ? "text-slate-400" : "text-slate-500"}`}>
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
              <Button type="submit" disabled={loading || joinCode.length < 3}>
                {loading ? "Joining…" : "Join"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
