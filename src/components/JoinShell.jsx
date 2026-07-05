import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { supabase } from "../supabase";
import { useTheme } from "../context/ThemeContext";

// Shared scaffolding for the public /join/<code> pages (team, retro,
// pomodoro sync): the full-viewport centered card, the "Back to app"
// link, the auth-session watcher, and the error/success banner. Each
// page keeps its own data flow and renders its content as children.

// Watches Supabase auth. `undefined` while the initial getSession is in
// flight (render the shell's loading state), then null or the session.
export function useJoinAuthSession() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);
  return session;
}

const NOTICE_TONES = {
  error: { dark: "bg-red-500/15 text-red-400", light: "bg-red-50 text-red-600" },
  success: { dark: "bg-emerald-500/15 text-emerald-400", light: "bg-emerald-50 text-emerald-600" },
};

// The red/green message banner every join page repeats.
export function JoinNotice({ tone = "error", children }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const colors = NOTICE_TONES[tone] || NOTICE_TONES.error;
  return (
    <div className={`text-sm font-medium px-3 py-2 rounded-lg mb-3 ${dark ? colors.dark : colors.light}`}>
      {children}
    </div>
  );
}

export default function JoinShell({ loading = false, children }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const wrapCls = `min-h-screen w-full flex items-center justify-center px-4 ${
    dark ? "bg-[var(--color-bg)] text-slate-100" : "bg-slate-50 text-slate-800"
  }`;
  if (loading) {
    return <div className={wrapCls}><span className="text-xs text-slate-400">Loading…</span></div>;
  }
  return (
    <div className={wrapCls}>
      <div className={`w-full max-w-md rounded-2xl border p-6 ${
        dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200 shadow-md"
      }`}>
        <Link to="/" className={`inline-flex items-center gap-1 text-xs mb-4 ${dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"}`}>
          <ArrowLeft className="w-3.5 h-3.5" /> Back to app
        </Link>
        {children}
      </div>
    </div>
  );
}
