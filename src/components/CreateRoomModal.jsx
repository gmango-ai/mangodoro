import { useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { useTeam } from "../context/TeamContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Home, MessageSquare, Lock, Users2, Check, Clock } from "lucide-react";
import { createRoomV2 } from "../lib/rooms";
import Modal from "./Modal";

const ROOM_COLORS = [
  "#14b8a6", "#0ea5e9", "#6366f1", "#8b5cf6", "#ec4899",
  "#f43f5e", "#f59e0b", "#84cc16", "#10b981", "#64748b",
];

const KIND_OPTIONS = [
  {
    key: "general",
    label: "General",
    Icon: Home,
    hint: "Long-lived shared room — anyone in the org can drop in. Admins only.",
    adminsOnly: true,
  },
  {
    key: "meeting",
    label: "Meeting",
    Icon: MessageSquare,
    hint: "Time-boxed room for a specific meeting. Auto-closes after the max duration.",
    adminsOnly: false,
  },
  {
    key: "private",
    label: "Private",
    Icon: Lock,
    hint: "Open until someone joins, then locked behind a code that's auto-generated on first join.",
    adminsOnly: false,
  },
];

const MEETING_DURATIONS = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 45, label: "45 min" },
  { value: 60, label: "1 hour" },
  { value: 90, label: "1.5 hours" },
  { value: 120, label: "2 hours" },
  { value: null, label: "No limit" },
];

export default function CreateRoomModal({ open, onClose, teamId, userId, isAdmin, onCreated }) {
  const { theme } = useTheme();
  const { orgTeams, myOrgTeamLeadIds } = useTeam();
  const dark = theme === "dark";
  const [name, setName] = useState("");
  const [kind, setKind] = useState("meeting");
  const [color, setColor] = useState(ROOM_COLORS[0]);
  const [selectedTeamIds, setSelectedTeamIds] = useState([]);
  const [maxDurationMinutes, setMaxDurationMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Reset on open so the previous run's draft doesn't linger.
  useEffect(() => {
    if (open) {
      setName("");
      setKind(isAdmin ? "general" : "meeting");
      setColor(ROOM_COLORS[0]);
      setSelectedTeamIds([]);
      setMaxDurationMinutes(60);
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
      color,
      orgTeamIds: selectedTeamIds,
      // Only meeting rooms accept a max duration; the server enforces
      // the same rule but we keep the wire clean.
      maxDurationMinutes: kind === "meeting" ? maxDurationMinutes : null,
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
    dark ? "bg-[var(--color-surface)] border-[var(--color-border)] shadow-2xl shadow-black/40" : "bg-white border-slate-200 shadow-xl"
  }`;
  const inputCls = dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100" : "";
  const labelCls = `text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-500"}`;

  return (
    <Modal onClose={onClose}>
      <form className={cardCls} onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <button
          type="button"
          onClick={onClose}
          className={`absolute top-3 right-3 p-1.5 rounded-lg ${
            dark ? "hover:bg-[var(--color-surface-raised)] text-slate-400" : "hover:bg-slate-100 text-slate-500"
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
                  title={disabled ? "Only org admins can create general rooms" : opt.hint}
                  className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-lg border text-xs font-semibold transition-colors ${
                    disabled ? "opacity-40 cursor-not-allowed" : ""
                  } ${
                    active
                      ? "bg-[var(--color-accent-light)] border-[var(--color-accent)] text-[var(--color-accent)]"
                      : dark
                        ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-300 hover:border-slate-600"
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

        {/* Meeting rooms get an auto-close timer. Picked on create
            because changing it mid-session would surprise people who
            joined under the original limit. */}
        {kind === "meeting" && (
          <div className="mb-4">
            <label className={labelCls}>
              <Clock className="inline w-3 h-3 mr-1 -mt-0.5" />
              Auto-close after
            </label>
            <div className="grid grid-cols-4 gap-1.5 mt-1.5">
              {MEETING_DURATIONS.map((d) => {
                const active = maxDurationMinutes === d.value;
                return (
                  <button
                    key={d.label}
                    type="button"
                    onClick={() => setMaxDurationMinutes(d.value)}
                    className={`text-[11px] font-semibold px-2 py-1.5 rounded-md border transition-colors ${
                      active
                        ? "bg-[var(--color-accent-light)] border-[var(--color-accent)] text-[var(--color-accent)]"
                        : dark
                          ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-300 hover:border-slate-600"
                          : "bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Color picker — quick visual identification on the floor plan. */}
        <div className="mb-4">
          <label className={labelCls}>Color</label>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {ROOM_COLORS.map((c) => {
              const active = color === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-md border-2 transition-all relative ${
                    active ? "scale-110 shadow-md" : "hover:scale-105"
                  }`}
                  style={{
                    background: c,
                    borderColor: active ? (dark ? "#fff" : "#0f172a") : "transparent",
                  }}
                  aria-label={c}
                  aria-pressed={active}
                >
                  {active && (
                    <Check className="w-3 h-3 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white drop-shadow" />
                  )}
                </button>
              );
            })}
          </div>
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
                          ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-300 hover:border-slate-600"
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
    </Modal>
  );
}
