import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { supabase } from "../supabase";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogIn, UserPlus, User, ArrowLeft } from "lucide-react";
import { getSyncSessionPreview, joinSyncSession } from "../lib/syncSession";
import { notifySessionJoined } from "../sync/joinSession";
import { signInAsGuest } from "../lib/auth";

const MODE_LABELS = { work: "Focus", shortBreak: "Short break", longBreak: "Long break" };

export default function JoinSyncPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [session, setSession] = useState(undefined);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!code) return;
    getSyncSessionPreview(code).then(({ data, error }) => {
      if (error) setPreviewError(error.message);
      else setPreview(data);
    });
  }, [code]);

  // Pre-fill the name from user_settings once authenticated.
  useEffect(() => {
    if (!session?.user?.id || name) return;
    supabase.from("user_settings").select("name").eq("user_id", session.user.id).maybeSingle()
      .then(({ data }) => { if (data?.name) setName(data.name); });
  }, [session?.user?.id]);

  async function doJoin(displayName) {
    const cleanName = (displayName || "").trim();
    if (!cleanName) { setError("Please enter a name."); return; }
    setBusy(true); setError("");
    // Persist the name if it differs from user_settings.
    await supabase.from("user_settings")
      .upsert({ user_id: session.user.id, name: cleanName }, { onConflict: "user_id" });
    const { data, error: err } = await joinSyncSession(code, cleanName);
    setBusy(false);
    if (err) {
      const msg = err.message?.includes("display_name_required")
        ? "A display name is required."
        : err.message || "Could not join.";
      setError(msg);
      return;
    }
    if (data?.session) {
      notifySessionJoined(data.session);
      navigate("/pomodoro");
    }
  }

  async function handleSignInExisting() {
    navigate(`/?join=${code}`);
  }

  async function handleGuest() {
    setBusy(true); setError("");
    const { error: err, displayName } = await signInAsGuest(name);
    if (err) { setError(err.message); setBusy(false); return; }
    // Session state updates via onAuthStateChange; pass the name forward so
    // we don't race the subscription.
    setTimeout(() => doJoin(displayName), 200);
  }

  const wrapCls = `min-h-screen w-full flex items-center justify-center px-4 ${
    dark ? "bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-800"
  }`;
  const cardCls = `w-full max-w-md rounded-2xl border p-6 ${
    dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200 shadow-md"
  }`;
  const labelCls = `text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-500"}`;

  if (session === undefined) {
    return (
      <div className={wrapCls}><span className="text-xs text-slate-400">Loading…</span></div>
    );
  }

  return (
    <div className={wrapCls}>
      <div className={cardCls}>
        <Link to="/" className={`inline-flex items-center gap-1 text-xs mb-4 ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}>
          <ArrowLeft className="w-3.5 h-3.5" /> Back to app
        </Link>

        <h1 className="text-xl font-bold mb-1">Join Pomodoro session</h1>
        <p className={`text-sm mb-4 ${dark ? "text-slate-400" : "text-slate-500"}`}>
          Code:{" "}
          <span className={`font-mono font-bold tracking-widest ${dark ? "text-cyan-400" : "text-teal-600"}`}>
            {(code || "").toUpperCase()}
          </span>
        </p>

        {previewError ? (
          <div className={`text-sm font-medium px-3 py-2 rounded-lg mb-3 ${
            dark ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"
          }`}>
            {previewError}
          </div>
        ) : preview ? (
          <div className={`text-xs mb-4 px-3 py-2 rounded-lg ${dark ? "bg-slate-800/60" : "bg-slate-50"}`}>
            Hosted by <strong>{preview.leader_name}</strong> · {MODE_LABELS[preview.mode] || preview.mode} ·{" "}
            {preview.participants}/{preview.max_participants} in session
          </div>
        ) : (
          <div className={`text-xs mb-4 ${dark ? "text-slate-500" : "text-slate-400"}`}>Looking up session…</div>
        )}

        <div className="mb-3">
          <label className={labelCls}>Your display name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 60))}
            placeholder="Required"
            className={`mt-1 ${dark ? "bg-slate-800/60 border-slate-700 text-slate-100" : ""}`}
          />
        </div>

        {error && (
          <div className={`text-sm font-medium px-3 py-2 rounded-lg mb-3 ${
            dark ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"
          }`}>
            {error}
          </div>
        )}

        {session ? (
          <Button onClick={() => doJoin(name)} disabled={busy || !name.trim() || !preview} className="w-full">
            <LogIn className="w-4 h-4 mr-1.5" />
            {busy ? "Joining…" : "Join session"}
          </Button>
        ) : (
          <div className="space-y-2">
            <Button onClick={handleSignInExisting} className="w-full">
              <LogIn className="w-4 h-4 mr-1.5" /> Sign in to join
            </Button>
            <Button variant="outline" onClick={handleSignInExisting} className="w-full">
              <UserPlus className="w-4 h-4 mr-1.5" /> Create an account
            </Button>
            <Button
              variant="ghost"
              onClick={handleGuest}
              disabled={busy || !name.trim() || !preview}
              className="w-full"
            >
              <User className="w-4 h-4 mr-1.5" />
              {busy ? "Joining…" : "Continue as guest"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
