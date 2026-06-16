import { useEffect, useState } from "react";
import { X, Plus, Target } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useTeam } from "../../context/TeamContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { Button } from "@/components/ui/button";
import {
  listTeamRetros, getOrCreateCurrentRetro, formatRetroWeek,
} from "../../lib/retro";
import { linkRetroToSession } from "../../lib/syncSession";

// Modal that lets a session leader attach a retro to the current
// sync session. Lists the team's retros (most recent first) and
// offers a "Start this week's retro" shortcut that lazily creates a
// retro for the current ISO week.
//
// On select, calls link_retro_to_session and closes. Errors are
// rendered inline so RLS surface messages aren't lost.
export default function RetroPicker({ open, onClose }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { activeTeamId } = useTeam();
  const { syncSession } = useSyncSession();
  const [retros, setRetros] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !activeTeamId) return;
    setLoading(true);
    listTeamRetros(activeTeamId).then(({ data }) => {
      setRetros(data || []);
      setLoading(false);
    });
  }, [open, activeTeamId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function attach(retroId) {
    if (!syncSession?.id) return;
    setBusy(true); setError("");
    const { error: e } = await linkRetroToSession(syncSession.id, retroId);
    setBusy(false);
    if (e) {
      setError(e.message || "Couldn't link the retro");
      return;
    }
    onClose();
  }

  async function startThisWeek() {
    setBusy(true); setError("");
    const { data, error: e } = await getOrCreateCurrentRetro(activeTeamId);
    if (e || !data) {
      setBusy(false);
      setError(e?.message || "Couldn't start a retro");
      return;
    }
    await attach(data.id);
  }

  return (
    <div
      className="fixed inset-0 z-[190] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-md rounded-2xl border shadow-2xl flex flex-col max-h-[80vh] ${
          dark ? "bg-[var(--color-surface)] border-[var(--color-border)]" : "bg-white border-slate-200"
        }`}
      >
        <header className={`flex items-center justify-between px-4 py-3 border-b ${
          dark ? "border-[var(--color-border)]" : "border-slate-200"
        }`}>
          <div>
            <h2 className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
              Attach a retro
            </h2>
            <p className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
              Everyone in this session will see it
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7" aria-label="Close">
            <X className="w-4 h-4" />
          </Button>
        </header>

        <div className="p-3">
          <Button
            onClick={startThisWeek}
            disabled={busy || !activeTeamId}
            className="w-full justify-start"
            variant="outline"
          >
            <Plus className="w-4 h-4 mr-2" />
            Start this week's retro
          </Button>
        </div>

        <div className={`flex-1 px-3 pb-3 overflow-y-auto border-t ${
          dark ? "border-[var(--color-border)]" : "border-slate-200"
        }`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider px-1 pt-3 pb-2 ${
            dark ? "text-slate-500" : "text-slate-400"
          }`}>
            Existing retros
          </p>
          {loading ? (
            <p className={`text-xs px-1 py-2 ${dark ? "text-slate-500" : "text-slate-400"}`}>
              Loading…
            </p>
          ) : retros.length === 0 ? (
            <p className={`text-xs px-1 py-2 ${dark ? "text-slate-500" : "text-slate-400"}`}>
              No retros yet for this team.
            </p>
          ) : (
            <ul className="space-y-1">
              {retros.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => attach(r.id)}
                    disabled={busy}
                    className={`w-full flex items-start gap-2 px-2 py-2 rounded-md text-left transition-colors ${
                      dark ? "hover:bg-[var(--color-surface-raised)]/60" : "hover:bg-slate-50"
                    }`}
                  >
                    <Target className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--color-accent)]" />
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
                        {formatRetroWeek(r.week_start)}
                      </p>
                      {r.goal?.trim() && (
                        <p className={`text-[11px] mt-0.5 truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
                          {r.goal}
                        </p>
                      )}
                    </div>
                    {r.is_live && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600">
                        Live
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <div className={`px-4 py-2 text-xs border-t ${
            dark ? "border-[var(--color-border)] text-red-400" : "border-slate-200 text-red-600"
          }`}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
