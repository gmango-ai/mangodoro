import { useEffect, useState } from "react";
import { X, Plus, PenLine } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useTeam } from "../../context/TeamContext";
import { useApp } from "../../context/AppContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { Button } from "@/components/ui/button";
import { listTeamWhiteboards, createWhiteboard } from "../../lib/whiteboard";
import { linkWhiteboardToSession } from "../../lib/syncSession";

// Modal that lets a session leader attach a whiteboard to the current
// sync session — the whiteboard analogue of RetroPicker. Lists the team's
// boards (most recent first) and offers a "New whiteboard" shortcut.
// On select, calls link_whiteboard_to_session and closes; RLS / leader
// errors render inline.
export default function WhiteboardPicker({ open, onClose }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { activeTeamId } = useTeam();
  const { session } = useApp();
  const { syncSession } = useSyncSession();
  const [boards, setBoards] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !activeTeamId) return;
    setLoading(true);
    listTeamWhiteboards(activeTeamId).then(({ data }) => {
      setBoards(data || []);
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

  async function attach(whiteboardId) {
    if (!syncSession?.id) return;
    setBusy(true); setError("");
    const { error: e } = await linkWhiteboardToSession(syncSession.id, whiteboardId);
    setBusy(false);
    if (e) {
      setError(e.message || "Couldn't link the whiteboard");
      return;
    }
    onClose();
  }

  async function createAndAttach() {
    setBusy(true); setError("");
    const { data, error: e } = await createWhiteboard({
      teamId: activeTeamId,
      title: "Room whiteboard",
      createdBy: session?.user?.id,
    });
    if (e || !data) {
      setBusy(false);
      setError(e?.message || "Couldn't create a whiteboard");
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
              Attach a whiteboard
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
            onClick={createAndAttach}
            disabled={busy || !activeTeamId}
            className="w-full justify-start"
            variant="outline"
          >
            <Plus className="w-4 h-4 mr-2" />
            New whiteboard
          </Button>
        </div>

        <div className={`flex-1 px-3 pb-3 overflow-y-auto border-t ${
          dark ? "border-[var(--color-border)]" : "border-slate-200"
        }`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider px-1 pt-3 pb-2 ${
            dark ? "text-slate-500" : "text-slate-400"
          }`}>
            Existing whiteboards
          </p>
          {loading ? (
            <p className={`text-xs px-1 py-2 ${dark ? "text-slate-500" : "text-slate-400"}`}>
              Loading…
            </p>
          ) : boards.length === 0 ? (
            <p className={`text-xs px-1 py-2 ${dark ? "text-slate-500" : "text-slate-400"}`}>
              No whiteboards yet for this team.
            </p>
          ) : (
            <ul className="space-y-1">
              {boards.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => attach(b.id)}
                    disabled={busy}
                    className={`w-full flex items-start gap-2 px-2 py-2 rounded-md text-left transition-colors ${
                      dark ? "hover:bg-[var(--color-surface-raised)]/60" : "hover:bg-slate-50"
                    }`}
                  >
                    <PenLine className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--color-accent)]" />
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs font-semibold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
                        {b.title || "Untitled whiteboard"}
                      </p>
                      {b.goal?.trim() && (
                        <p className={`text-[11px] mt-0.5 truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>
                          {b.goal}
                        </p>
                      )}
                    </div>
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
