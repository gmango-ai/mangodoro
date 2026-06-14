import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { supabase } from "../supabase";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, ArrowLeft, Users, Check } from "lucide-react";

export default function JoinTeamPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [session, setSession] = useState(undefined);

  // Inline auth form state (only used when there's no session).
  const [authMode, setAuthMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [joined, setJoined] = useState(false);
  const autoJoinedRef = useRef(false);

  // Watch auth state.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  // Fetch the team preview as soon as we have the code.
  useEffect(() => {
    if (!code) return;
    supabase.rpc("get_team_invite_preview", { p_code: code.trim().toLowerCase() })
      .then(({ data, error: err }) => {
        if (err) { setPreviewError(err.message); return; }
        if (data?.error) { setPreviewError(data.error); return; }
        setPreview(data);
      });
  }, [code]);

  // Once we have a session AND a valid preview, auto-join and redirect.
  useEffect(() => {
    if (autoJoinedRef.current) return;
    if (!session?.user || !preview || previewError) return;
    autoJoinedRef.current = true;
    setBusy(true);
    supabase.rpc("join_team_by_code", { code: code.trim().toLowerCase() })
      .then(({ data, error: err }) => {
        setBusy(false);
        if (err) {
          setError(err.message || "Could not join team");
          autoJoinedRef.current = false;
          return;
        }
        if (data) {
          localStorage.setItem("ql_active_team", data);
        }
        setJoined(true);
        // Brief success flash, then off to /team.
        setTimeout(() => navigate("/team", { replace: true }), 700);
      });
  }, [session, preview, previewError, code, navigate]);

  async function handleGoogleSignIn() {
    setError("");
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      // Keep the user on this URL after OAuth so the auto-join effect fires.
      options: { redirectTo: window.location.href },
    });
    if (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function handleEmailAuth(e) {
    e.preventDefault();
    setError(""); setAuthMessage(""); setBusy(true);
    if (authMode === "signup") {
      const { error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.href },
      });
      if (err) setError(err.message);
      else setAuthMessage("Check your email to confirm, then come back to this link to join.");
    } else {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) setError(err.message);
      // No redirect needed; session updates trigger auto-join.
    }
    setBusy(false);
  }

  const teamColor = preview?.color || "#14b8a6";
  const initial = (preview?.name || "?")[0]?.toUpperCase() || "?";

  const wrapCls = `min-h-screen w-full flex items-center justify-center px-4 ${
    dark ? "bg-[var(--color-bg)] text-slate-100" : "bg-slate-50 text-slate-800"
  }`;
  const cardCls = `w-full max-w-md rounded-2xl border p-6 ${
    dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200 shadow-md"
  }`;
  const labelCls = `text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-500"}`;
  const inputCls = dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100 placeholder:text-slate-500" : "";

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

        {/* Team preview header */}
        <div className="flex items-center gap-3 mb-4">
          {preview?.icon_url ? (
            <img src={preview.icon_url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
          ) : (
            <span
              className="w-12 h-12 rounded-lg flex items-center justify-center font-bold text-white shrink-0 text-xl"
              style={{ background: teamColor }}
            >
              {initial}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className={labelCls}>You've been invited to</p>
            <h1 className="text-xl font-bold truncate">
              {preview?.name || (previewError ? "—" : "Loading…")}
            </h1>
            {preview && (
              <p className={`text-xs flex items-center gap-1 mt-0.5 ${dark ? "text-slate-500" : "text-slate-500"}`}>
                <Users className="w-3 h-3" />
                {preview.member_count} {preview.member_count === 1 ? "member" : "members"}
              </p>
            )}
          </div>
        </div>

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

        {authMessage && (
          <div className={`text-sm font-medium px-3 py-2 rounded-lg mb-3 ${
            dark ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-50 text-emerald-600"
          }`}>
            {authMessage}
          </div>
        )}

        {/* States: joined success / signed-in joining / signed-out auth form */}
        {joined ? (
          <div className={`flex items-center gap-2 text-sm font-medium px-3 py-2.5 rounded-lg ${
            dark ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-50 text-emerald-600"
          }`}>
            <Check className="w-4 h-4" /> Joined! Taking you to the team…
          </div>
        ) : session ? (
          <div className="space-y-2">
            <Button disabled className="w-full" style={{ background: teamColor, color: "#fff", opacity: 0.9 }}>
              <LogIn className="w-4 h-4 mr-1.5" />
              {busy ? "Joining…" : preview ? "Joining team…" : "Loading…"}
            </Button>
          </div>
        ) : !preview ? (
          <div className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
            {previewError ? "Ask the team admin for a fresh link." : "Looking up team…"}
          </div>
        ) : (
          <>
            <p className={`text-sm mb-3 ${dark ? "text-slate-400" : "text-slate-600"}`}>
              Sign in or create an account — we'll add you to the team right after.
            </p>

            <Button
              onClick={handleGoogleSignIn}
              disabled={busy}
              variant="outline"
              className="w-full mb-3"
            >
              <svg width="16" height="16" viewBox="0 0 48 48" className="mr-2">
                <path fill="#EA4335" d="M24 9.5c3.14 0 5.95 1.08 8.17 2.85l6.1-6.1C34.46 3.05 29.5 1 24 1 14.82 1 7.07 6.48 3.68 14.16l7.1 5.52C12.4 13.6 17.73 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.52 24.5c0-1.64-.15-3.22-.42-4.75H24v9h12.68c-.55 2.97-2.2 5.48-4.68 7.17l7.19 5.59C43.18 37.27 46.52 31.38 46.52 24.5z"/>
                <path fill="#FBBC05" d="M10.78 28.32A14.6 14.6 0 0 1 9.5 24c0-1.5.26-2.95.72-4.32l-7.1-5.52A23.94 23.94 0 0 0 0 24c0 3.87.93 7.52 2.57 10.74l8.21-6.42z"/>
                <path fill="#34A853" d="M24 47c5.5 0 10.12-1.82 13.49-4.94l-7.19-5.59c-1.99 1.34-4.54 2.13-6.3 2.13-6.27 0-11.6-4.1-13.22-9.68l-8.21 6.42C7.07 41.52 14.82 47 24 47z"/>
              </svg>
              Continue with Google
            </Button>

            <div className="flex items-center gap-2 my-3">
              <div className={`flex-1 h-px ${dark ? "bg-slate-700" : "bg-slate-200"}`} />
              <span className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>or</span>
              <div className={`flex-1 h-px ${dark ? "bg-slate-700" : "bg-slate-200"}`} />
            </div>

            <form onSubmit={handleEmailAuth} className="space-y-3">
              <div>
                <Label htmlFor="join-email" className={labelCls}>Email</Label>
                <Input
                  id="join-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className={`mt-1 ${inputCls}`}
                />
              </div>
              <div>
                <Label htmlFor="join-password" className={labelCls}>Password</Label>
                <Input
                  id="join-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete={authMode === "signup" ? "new-password" : "current-password"}
                  minLength={6}
                  className={`mt-1 ${inputCls}`}
                />
              </div>
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? "…" : authMode === "signin" ? "Sign in & join" : "Create account & join"}
              </Button>
            </form>

            <div className="mt-3 text-center text-xs">
              <span className={dark ? "text-slate-500" : "text-slate-500"}>
                {authMode === "signin" ? "No account? " : "Already have an account? "}
              </span>
              <button
                type="button"
                onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setError(""); setAuthMessage(""); }}
                className="font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)]"
              >
                {authMode === "signin" ? "Sign up" : "Sign in"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
