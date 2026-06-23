import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { pairDevice } from "../lib/orgDevices";
import { applyAccent } from "../lib/accent";
import LogoMark from "../components/LogoMark";

// Device pairing screen (/device). Enter the one-time code an org admin
// generated; on success the device's Supabase session is set and App.jsx
// re-renders into the kiosk display.
export default function DevicePairPage() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.classList.add("dark");
    applyAccent("teal", true);
    return () => document.documentElement.classList.remove("dark");
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const { error: err } = await pairDevice(code);
    if (err) {
      setError(err.message || "Could not pair this device.");
      setBusy(false);
    }
    // On success the auth state change swaps in the kiosk; no further action.
  };

  return (
    <main className="min-h-[100dvh] flex flex-col items-center justify-center bg-[var(--color-bg)] text-slate-100 px-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
          <span className="text-[var(--color-accent)] mb-3"><LogoMark size={34} /></span>
          <h1 className="text-xl font-bold" style={{ fontFamily: "'Parkinsans', sans-serif" }}>Pair this device</h1>
          <p className="mt-2 text-sm text-slate-400">
            Enter the pairing code from your org admin (Team → Devices).
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXX-XXXX"
            autoFocus
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            className="w-full h-14 px-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-center text-2xl font-bold tracking-[0.3em] uppercase placeholder:tracking-normal placeholder:text-slate-600 focus:border-[var(--color-accent)] outline-none"
          />
          {error && <p className="text-sm text-center text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={busy || code.trim().length < 8}
            className="w-full h-12 rounded-xl bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white font-semibold disabled:opacity-40 transition-colors"
          >
            {busy ? "Pairing…" : "Pair device"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-500">
          Not a device?{" "}
          <Link to="/login" className="text-[var(--color-accent)] hover:underline">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
