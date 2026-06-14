import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { supabase } from "../supabase";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Target, Users } from "lucide-react";
import {
  getRetroInvitePreview, joinRetroByCode, formatRetroWeek,
} from "../lib/retro";

export default function JoinRetroPage() {
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
    getRetroInvitePreview(code).then(({ data, error: err }) => {
      if (err) setPreviewError(err.message || "Could not load retro");
      else setPreview(data);
    });
  }, [code]);

  // Pre-fill from user_settings if signed in.
  useEffect(() => {
    if (!session?.user?.id || name) return;
    supabase.from("user_settings").select("name").eq("user_id", session.user.id).maybeSingle()
      .then(({ data }) => { if (data?.name) setName(data.name); });
  }, [session?.user?.id]);

  async function doJoinAsExistingUser() {
    const cleanName = name.trim();
    if (!cleanName) { setError("Please enter a name."); return; }
    setBusy(true); setError("");
    const { data: retroId, error: err } = await joinRetroByCode(code, cleanName);
    setBusy(false);
    if (err) { setError(err.message || "Could not join retro."); return; }
    if (retroId) navigate(`/retros/${retroId}`);
  }

  async function doJoinAsGuest() {
    const cleanName = name.trim();
    if (!cleanName) { setError("Please enter a name."); return; }
    setBusy(true); setError("");
    // Supabase anonymous auth — creates a real auth.uid() without an
    // email. Falls back to a clear error if the project hasn't enabled
    // anonymous sign-ins yet (Dashboard → Authentication → Providers).
    const { error: signErr } = await supabase.auth.signInAnonymously();
    if (signErr) {
      setBusy(false);
      setError(
        /anonymous/i.test(signErr.message || "")
          ? "Guest sign-in isn't enabled on this Supabase project. Ask the team admin to flip on Anonymous in Authentication → Providers."
          : signErr.message,
      );
      return;
    }
    // The new session lands via onAuthStateChange. Persist the chosen
    // display name immediately so the retro list renders attribution.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const { data: retroId, error: err } = await joinRetroByCode(code, cleanName);
    setBusy(false);
    if (err) { setError(err.message || "Could not join retro."); return; }
    if (retroId) navigate(`/retros/${retroId}`);
  }

  const wrapCls = `min-h-screen w-full flex items-center justify-center px-4 ${
    dark ? "bg-[var(--color-bg)] text-slate-100" : "bg-slate-50 text-slate-800"
  }`;
  const cardCls = `w-full max-w-md rounded-2xl border p-6 ${
    dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200 shadow-md"
  }`;
  const labelCls = `text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-500"}`;

  if (session === undefined) {
    return <div className={wrapCls}><span className="text-xs text-slate-400">Loading…</span></div>;
  }

  return (
    <div className={wrapCls}>
      <div className={cardCls}>
        <Link to="/" className={`inline-flex items-center gap-1 text-xs mb-4 ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}>
          <ArrowLeft className="w-3.5 h-3.5" /> Back to app
        </Link>

        {preview ? (
          <div className="flex items-center gap-3 mb-4">
            <span
              className="w-12 h-12 rounded-lg shrink-0 flex items-center justify-center font-bold text-white text-xl"
              style={{ background: preview.team_color || "#14b8a6" }}
            >
              {preview.team_icon_url
                ? <img src={preview.team_icon_url} alt="" className="w-full h-full rounded-lg object-cover" />
                : (preview.team_name?.[0] || "?")}
            </span>
            <div className="min-w-0 flex-1">
              <p className={labelCls}>You've been invited to</p>
              <h1 className="text-xl font-bold truncate">
                {preview.department ? `${preview.department} retro` : "Team retro"}
              </h1>
              <p className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>
                {preview.team_name} · {formatRetroWeek(preview.week_start)}
              </p>
            </div>
          </div>
        ) : (
          <p className={`text-xs mb-4 ${dark ? "text-slate-500" : "text-slate-400"}`}>
            Looking up the retro…
          </p>
        )}

        {previewError && (
          <div className={`text-sm font-medium px-3 py-2 rounded-lg mb-3 ${
            dark ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"
          }`}>
            {previewError}
          </div>
        )}

        {error && (
          <div className={`text-sm font-medium px-3 py-2 rounded-lg mb-3 ${
            dark ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"
          }`}>
            {error}
          </div>
        )}

        <div className="mb-3">
          <label className={labelCls}>Your name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 60))}
            placeholder="Required"
            className={`mt-1 ${dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100" : ""}`}
          />
        </div>

        {session ? (
          <Button onClick={doJoinAsExistingUser} disabled={busy || !name.trim() || !preview} className="w-full">
            <Users className="w-4 h-4 mr-1.5" />
            {busy ? "Joining…" : "Join retro"}
          </Button>
        ) : (
          <div className="space-y-2">
            <Button onClick={doJoinAsGuest} disabled={busy || !name.trim() || !preview} className="w-full">
              <Users className="w-4 h-4 mr-1.5" />
              {busy ? "Joining…" : "Join as guest"}
            </Button>
            <Link
              to="/team"
              className={`block text-center text-xs ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}
            >
              I have an account — sign me in first
            </Link>
          </div>
        )}

        {preview && (
          <p className={`mt-4 text-[11px] text-center ${dark ? "text-slate-500" : "text-slate-400"}`}>
            Joining as a guest gives you access to this retro only.
          </p>
        )}
      </div>
    </div>
  );
}
