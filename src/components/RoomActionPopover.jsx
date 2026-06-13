import { useTheme } from "../context/ThemeContext";
import { useTeam } from "../context/TeamContext";
import { Button } from "@/components/ui/button";
import { X, Play, LogIn, Eye, Users, Briefcase, MessageSquare, Lock, Hash } from "lucide-react";
import UserAvatar from "./UserAvatar";

const KIND_ICON = {
  department: Briefcase,
  meeting: MessageSquare,
  private: Lock,
};
const KIND_LABEL = {
  department: "Department",
  meeting: "Meeting",
  private: "Private",
};

// Modal that opens when a user clicks a room tile. Surfaces full
// context (occupants with team chips, gating, active session) and
// gives explicit choices for "Join session" vs "Start session". An
// "Enter room" option is reserved for the future multi-room presence
// concept; we render it disabled with a tooltip so the affordance is
// discoverable without committing to behavior we don't have yet.
export default function RoomActionPopover({
  open, onClose, room, activeSession, orgTeams, busy, onJoin, onStart,
}) {
  const { theme } = useTheme();
  const { teamsByUserId } = useTeam();
  const dark = theme === "dark";

  if (!open || !room) return null;
  const Icon = KIND_ICON[room.kind] || Hash;
  const occupants = (activeSession?.occupants || []);
  const isOccupied = !!activeSession;

  const gatingTeams = (room.room_teams || [])
    .map((rt) => (orgTeams || []).find((t) => t.id === rt.org_team_id))
    .filter(Boolean);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-md rounded-2xl border p-5 sm:p-6 ${
          dark ? "bg-slate-900 border-slate-700 shadow-2xl shadow-black/40" : "bg-white border-slate-200 shadow-xl"
        }`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={`absolute top-3 right-3 p-1.5 rounded-lg ${
            dark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-100 text-slate-500"
          }`}
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <div className={`p-2 rounded-lg shrink-0 ${
            isOccupied
              ? dark ? "bg-cyan-500/15 text-cyan-300" : "bg-teal-100 text-teal-700"
              : dark ? "bg-slate-800/60 text-slate-300" : "bg-slate-100 text-slate-600"
          }`}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className={`text-lg font-bold truncate ${dark ? "text-slate-100" : "text-slate-800"}`}>
              {room.name}
            </h2>
            <p className={`text-[11px] uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>
              {KIND_LABEL[room.kind]}
            </p>
          </div>
        </div>

        {/* Gating chips */}
        {gatingTeams.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-500" : "text-slate-400"}`}>
              Visible to
            </span>
            {gatingTeams.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: `${t.color}22`, color: dark ? "#fff" : t.color, border: `1px solid ${t.color}55` }}
              >
                <span className="w-1 h-1 rounded-full" style={{ background: t.color }} />
                {t.name}
              </span>
            ))}
          </div>
        )}

        {/* Session state */}
        <div className={`rounded-lg border p-3 mb-4 ${
          dark ? "bg-slate-800/40 border-slate-700/60" : "bg-slate-50 border-slate-200"
        }`}>
          {isOccupied ? (
            <>
              <p className={`text-xs mb-2 ${dark ? "text-slate-300" : "text-slate-700"}`}>
                <span className={`font-semibold ${dark ? "text-emerald-300" : "text-emerald-700"}`}>
                  Session in progress
                </span>
                {" · "}
                {activeSession.participant_count}/{activeSession.max_participants}
              </p>
              <div className="flex flex-wrap gap-2">
                {occupants.map((o) => {
                  const userTeams = teamsByUserId?.get(o.user_id) || [];
                  return (
                    <span
                      key={o.user_id}
                      className={`inline-flex items-center gap-1.5 text-xs px-1.5 py-0.5 rounded-md ${
                        dark ? "bg-slate-900/60 text-slate-200" : "bg-white text-slate-700 border border-slate-200"
                      }`}
                      title={userTeams.map((t) => t.name).join(" · ")}
                    >
                      <UserAvatar url={o.avatar_url} name={o.name} size={18} />
                      <span className="truncate max-w-[120px]">{o.name}</span>
                    </span>
                  );
                })}
              </div>
            </>
          ) : (
            <p className={`text-xs inline-flex items-center gap-1.5 ${dark ? "text-slate-400" : "text-slate-500"}`}>
              <Users className="w-3.5 h-3.5 opacity-60" />
              Nobody is here right now.
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-2">
          {isOccupied ? (
            <Button
              type="button"
              onClick={onJoin}
              disabled={busy}
              className="w-full"
            >
              <LogIn className="w-4 h-4 mr-1.5" />
              {busy ? "Joining…" : "Join session"}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={onStart}
              disabled={busy}
              className="w-full"
            >
              <Play className="w-4 h-4 mr-1.5" />
              {busy ? "Starting…" : "Start a session"}
            </Button>
          )}

          {/* Reserved for the multi-room presence concept. Surfaced
              now so the affordance is discoverable; the behavior will
              land once we model "presence in a room without a session". */}
          <Button
            type="button"
            variant="outline"
            disabled
            title="Coming soon — be present in a room without starting a timer"
            className="w-full"
          >
            <Eye className="w-4 h-4 mr-1.5" />
            Enter without a session
            <span className={`ml-1.5 text-[9px] uppercase font-bold ${dark ? "text-slate-500" : "text-slate-400"}`}>
              Soon
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
