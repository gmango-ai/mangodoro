import { useState } from "react";
import { Browser } from "@capacitor/browser";
import { supabase } from "./supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isMobileApp, getAuthRedirectUrl, getEmailRedirectUrl } from "./lib/platform";

export default function AuthPage() {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleGoogleSignIn() {
    setError("");
    setLoading(true);
    // On native we open the OAuth URL ourselves in an in-app browser and
    // catch the redirect via the appUrlOpen listener in App.jsx. Letting
    // Supabase do its default window-redirect would navigate the WebView
    // away from capacitor://localhost and break the session bridge.
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: getAuthRedirectUrl(),
        skipBrowserRedirect: isMobileApp,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    if (isMobileApp && data?.url) {
      await Browser.open({ url: data.url, presentationStyle: "popover" });
      // Loading stays true until the deep-link listener fires
      // exchangeCodeForSession and onAuthStateChange flips us to the
      // authed app. If the user dismisses the browser without signing
      // in, the spinner clears via Browser.addListener('browserFinished')
      // below — wired in App.jsx so it lives across navigations.
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    if (mode === "signup") {
      // emailRedirectTo pins the confirmation link to the origin the user
      // signed up from. Without it, Supabase falls back to the project's
      // Site URL (mangodoro.com) even when localhost is in the redirect
      // allowlist, breaking local dev signups.
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: getEmailRedirectUrl() },
      });
      if (error) {
        setError(error.message);
      } else {
        setMessage("Check your email for a confirmation link.");
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    }

    setLoading(false);
  }

  return (
    <div style={{
      fontFamily: "'Figtree', sans-serif",
      background: "#f8fafc",
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Figtree:wght@300;400;500;600;700&family=Parkinsans:wght@300;400;500;600;700;800&display=swap');
        * { box-sizing: border-box; }
      `}</style>

      <div style={{ width: "100%", maxWidth: 400, padding: "0 16px" }}>
        {/* Logo / title */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h1 style={{
            fontFamily: "'Parkinsans', sans-serif",
            fontSize: 28,
            fontWeight: 700,
            color: "#0f172a",
            margin: 0,
          }}>
            Mangodoro
          </h1>
          <p style={{ color: "#64748b", fontSize: 14, marginTop: 6 }}>
            {mode === "signin" ? "Sign in to your account" : "Create a new account"}
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: "#fff",
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          padding: 28,
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}>
          {/* Google OAuth */}
          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              width: "100%",
              padding: "9px 16px",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              background: "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: 14,
              fontFamily: "inherit",
              fontWeight: 500,
              color: "#374151",
              marginBottom: 16,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.14 0 5.95 1.08 8.17 2.85l6.1-6.1C34.46 3.05 29.5 1 24 1 14.82 1 7.07 6.48 3.68 14.16l7.1 5.52C12.4 13.6 17.73 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.52 24.5c0-1.64-.15-3.22-.42-4.75H24v9h12.68c-.55 2.97-2.2 5.48-4.68 7.17l7.19 5.59C43.18 37.27 46.52 31.38 46.52 24.5z"/>
              <path fill="#FBBC05" d="M10.78 28.32A14.6 14.6 0 0 1 9.5 24c0-1.5.26-2.95.72-4.32l-7.1-5.52A23.94 23.94 0 0 0 0 24c0 3.87.93 7.52 2.57 10.74l8.21-6.42z"/>
              <path fill="#34A853" d="M24 47c5.5 0 10.12-1.82 13.49-4.94l-7.19-5.59c-1.99 1.34-4.54 2.13-6.3 2.13-6.27 0-11.6-4.1-13.22-9.68l-8.21 6.42C7.07 41.52 14.82 47 24 47z"/>
            </svg>
            Continue with Google
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
            <span style={{ fontSize: 12, color: "#94a3b8" }}>or</span>
            <div style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Label htmlFor="email" style={{ fontSize: 13, color: "#374151" }}>Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Label htmlFor="password" style={{ fontSize: 13, color: "#374151" }}>Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                minLength={6}
              />
            </div>

            {error && (
              <p style={{ fontSize: 13, color: "#ef4444", margin: 0 }}>{error}</p>
            )}
            {message && (
              <p style={{ fontSize: 13, color: "#22c55e", margin: 0 }}>{message}</p>
            )}

            <Button type="submit" disabled={loading} style={{ marginTop: 4 }}>
              {loading ? "…" : mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <div style={{ marginTop: 20, textAlign: "center", borderTop: "1px solid #f1f5f9", paddingTop: 16 }}>
            <span style={{ fontSize: 13, color: "#64748b" }}>
              {mode === "signin" ? "Don't have an account? " : "Already have an account? "}
            </span>
            <button
              onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setMessage(""); }}
              style={{ fontSize: 13, color: "#3b82f6", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
            >
              {mode === "signin" ? "Sign up" : "Sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
