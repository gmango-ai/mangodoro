import { useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { useTeam } from "../context/TeamContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Briefcase, MessageSquare, Lock, Users2 } from "lucide-react";
import { createRoomV2 } from "../lib/rooms";

const KIND_OPTIONS = [
  {
    key: "department",
    label: "Department",
    Icon: Briefcase,
    hint: "Long-lived room for a team or department. Admins only.",
    adminsOnly: true,
  },
  {
    key: "meeting",
    label: "Meeting",
    Icon: MessageSquare,
    hint: "Ad-hoc room for a specific meeting. Anyone can join.",
    adminsOnly: false,
  },
  {
    key: "private",
    label: "Private",
    Icon: Lock,
    hint: "Visible on the team list, but joining needs an invite code.",
    adminsOnly: false,
  },
];

export default function CreateRoomModal({ open, onClose, teamId, userId, isAdmin, onCreated }) {
  const { theme } = useTheme();
  const { orgTeams, myOrgTeamLeadIds } = useTeam();
  const dark = theme === "dark";
  const [name, setName] = useState("");
  const [kind, setKind] = useState("meeting");
  const [selectedTeamIds, setSelectedTeamIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Reset on open so the previous run's draft doesn't linger.
  useEffect(() => {
    if (open) {
      setName("");
      setKind(isAdmin ? "department" : "meeting");
      setSelectedTeamIds([]);
      setBusy(false);
      setError("");
    }
  }, [open, isAdmin]);

  if (!open) return null;

  function toggleTeam(id) {
    setSelectedTeamIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setError("Name is required."); return; }
    setBusy(true); setError("");
    const { data, error: err } = await createRoomV2(teamId, {
      name,
      kind,
      orgTeamIds: selectedTeamIds,
      userId,
    });
    setBusy(false);
    if (err) {
      setError(err.message || "Could not create room.");
      return;
    }
    onCreated?.(data);
    onClose();
  }

  // Non-admin leads may only gate to teams they actually lead. For
  // admins, all org_teams are gating-eligible.
  const gatingTeams = isAdmin
    ? (orgTeams || [])
    : (orgTeams || []).filter((t) => myOrgTeamLeadIds?.has(t.id));

  const cardCls = `relative w-full max-w-md rounded-2xl border p-5 sm:p-6 ${
    dark ? "bg-slate-900 border-slate-700 shadow-2xl shadow-black/40" : "bg-white border-slate-200 shadow-xl"
  }`;
  const inputCls = dark ? "bg-slate-800/60 border-slate-700 text-slate-100" : "";
  const labelCls = `text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-500"}`;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4" onClick={onClose}>
      <form className={cardCls} onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <button
          type="button"
          onClick={onClose}
          className={`absolute top-3 right-3 p-1.5 rounded-lg ${
            dark ? "hover:bg-slate-800 text-slate-400" : "hover:bg-slate-100 text-slate-500"
          }`}
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className={`text-lg font-bold mb-4 ${dark ? "text-slate-100" : "text-slate-800"}`}>
          New room
        </h2>

        <div className="mb-3">
          <label className={labelCls}>Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 40))}
            placeholder="e.g. SWE, Manager standup, Focus Friday"
            className={`mt-1 ${inputCls}`}
            autoFocus
          />
        </div>

        <div className="mb-4">
          <label className={labelCls}>Kind</label>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {KIND_OPTIONS.map((opt) => {
              const disabled = opt.adminsOnly && !isAdmin;
              const active = kind === opt.key;
              const Icon = opt.Icon;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => !disabled && setKind(opt.key)}
                  disabled={disabled}
                  title={disabled ? "Only team admins can create department rooms" : opt.hint}
                  className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-lg border text-xs font-semibold transition-colors ${
                    disabled ? "opacity-40 cursor-not-allowed" : ""
                  } ${
                    active
                      ? dark
                        ? "bg-cyan-500/15 border-cyan-500/50 text-cyan-200"
                        : "bg-teal-50 border-teal-300 text-teal-700"
                      : dark
                        ? "bg-slate-800/40 border-slate-700 text-slate-300 hover:border-slate-600"
                        : "bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {opt.label}
                </button>
              );
            })}
          </div>
          <p className={`text-[11px] mt-2 ${dark ? "text-slate-400" : "text-slate-500"}`}>
            {KIND_OPTIONS.find((o) => o.key === kind)?.hint}
          </p>
        </div>

        {/* Team gating. Empty selection = org-wide. For leads, only the
            teams they lead show up here (server-side check enforces). */}
        {gatingTeams.length > 0 && (
          <div className="mb-4">
            <label className={labelCls}>
              <Users2 className="inline w-3 h-3 mr-1 -mt-0.5" />
              Visible to
            </label>
            <p className={`text-[11px] mt-0.5 mb-2 ${dark ? "text-slate-400" : "text-slate-500"}`}>
              {selectedTeamIds.length === 0
                ? "Everyone in the org (no team selected)"
                : `Only ${selectedTeamIds.length} team${selectedTeamIds.length === 1 ? "" : "s"}`}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {gatingTeams.map((t) => {
                const active = selectedTeamIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTeam(t.id)}
                    className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-full border transition-colors"
                    style={
                      active
                        ? { background: `${t.color}22`, borderColor: `${t.color}99`, color: dark ? "#fff" : t.color }
                        : undefined
                    }
                    {...(!active && {
                      className: `inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-full border transition-colors ${
                        dark
                          ? "bg-slate-800/40 border-slate-700 text-slate-300 hover:border-slate-600"
                          : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                      }`,
                    })}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.color }} />
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {error && (
          <div className={`text-sm font-medium px-3 py-2 rounded-lg mb-3 ${
            dark ? "bg-red-500/15 text-red-400" : "bg-red-50 text-red-600"
          }`}>
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </div>
      </form>
    </div>
  );
}
