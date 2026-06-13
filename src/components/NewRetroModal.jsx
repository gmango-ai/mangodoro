import { useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Target, Briefcase, Sparkles, Users } from "lucide-react";
import { getOrCreateCurrentRetro, setRetroGoal } from "../lib/retro";
import { createOrgTeam } from "../lib/orgTeam";
import { useApp } from "../context/AppContext";

// Modal for explicitly starting a retro. The user picks an org_team
// (chip selector) or types a new team name on the fly. Admins who
// type a brand-new name get an org_team created for them in the same
// step, and that team is what the retro attaches to. Non-admins can
// only pick from existing teams (or org-wide).
export default function NewRetroModal({
  open,
  onClose,
  orgId,
  availableTeams,
  existingTeamIds,
  preselectedTeamId,
  isAdmin,
  onCreated,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { session } = useApp();
  // selectedTeamId === null means org-wide. Otherwise an org_team_id.
  const [selectedTeamId, setSelectedTeamId] = useState(preselectedTeamId ?? null);
  const [customMode, setCustomMode] = useState(false);
  const [customName, setCustomName] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const firstUntaken = (availableTeams || []).find((t) => !existingTeamIds.has(t.id));
    setSelectedTeamId(preselectedTeamId ?? firstUntaken?.id ?? null);
    setCustomMode(false);
    setCustomName("");
    setGoal("");
    setBusy(false);
    setError("");
  }, [open, preselectedTeamId, availableTeams, existingTeamIds]);

  if (!open) return null;

  const alreadyExists = !customMode && existingTeamIds.has(selectedTeamId);
  const canSetGoal = !alreadyExists && isAdmin;
  const canSubmit = customMode ? customName.trim().length > 0 : true;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!orgId || !canSubmit) return;
    setBusy(true); setError("");

    let teamIdToUse = selectedTeamId;

    if (customMode) {
      if (!isAdmin) {
        setBusy(false);
        setError("Only org admins can create a new team. Pick from the list, or ask an admin to add it.");
        return;
      }
      const { data: newTeam, error: teamErr } = await createOrgTeam(orgId, {
        name: customName,
        userId: session?.user?.id,
      });
      if (teamErr || !newTeam) {
        setBusy(false);
        setError(teamErr?.message || "Could not create the new team.");
        return;
      }
      teamIdToUse = newTeam.id;
    }

    const { data, error: err } = await getOrCreateCurrentRetro(orgId, teamIdToUse);
    if (err || !data) {
      setBusy(false);
      setError(err?.message || "Could not start the retro.");
      return;
    }
    if (canSetGoal && goal.trim().length > 0) {
      await setRetroGoal(data.id, goal.trim());
    }
    setBusy(false);
    onCreated?.(data);
    onClose();
  }

  const cardCls = `relative w-full max-w-md rounded-2xl border p-5 sm:p-6 ${
    dark ? "bg-slate-900 border-slate-700 shadow-2xl shadow-black/40" : "bg-white border-slate-200 shadow-xl"
  }`;
  const labelCls = `text-[10px] font-semibold uppercase tracking-wider ${
    dark ? "text-slate-400" : "text-slate-500"
  }`;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4"
      onClick={onClose}
    >
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

        <h2 className={`text-lg font-bold mb-1 ${dark ? "text-slate-100" : "text-slate-800"}`}>
          Start a new retro
        </h2>
        <p className={`text-xs mb-4 ${dark ? "text-slate-400" : "text-slate-500"}`}>
          One retro per team per week. Picking one that already exists this week opens it instead.
        </p>

        {/* Team picker */}
        <div className="mb-4">
          <label className={labelCls}>Team</label>
          {!customMode && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(availableTeams || []).map((team) => {
                const active = team.id === selectedTeamId;
                const taken = existingTeamIds.has(team.id);
                const key = team.id || "__org__";
                const Icon = team.id ? Briefcase : Users;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedTeamId(team.id)}
                    className={`relative inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                      active
                        ? dark
                          ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-100"
                          : "bg-teal-100 border-teal-300 text-teal-800"
                        : dark
                          ? "border-slate-700 text-slate-300 hover:border-slate-600"
                          : "border-slate-200 text-slate-600 hover:border-slate-300"
                    }`}
                    title={taken ? "Already has a retro this week" : undefined}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: team.color || "#14b8a6" }}
                    />
                    <Icon className="w-3 h-3" />
                    {team.name}
                    {taken && (
                      <span
                        className={`text-[9px] uppercase tracking-wider px-1 py-0.5 rounded ${
                          active
                            ? "bg-black/15 text-current"
                            : dark ? "bg-slate-700 text-slate-400" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        Exists
                      </span>
                    )}
                  </button>
                );
              })}
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setCustomMode(true)}
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border border-dashed transition-colors ${
                    dark
                      ? "border-slate-600 text-slate-300 hover:border-cyan-500/60 hover:text-cyan-200"
                      : "border-slate-300 text-slate-600 hover:border-teal-400 hover:text-teal-700"
                  }`}
                >
                  <Sparkles className="w-3 h-3" /> New team…
                </button>
              )}
            </div>
          )}
          {customMode && (
            <div className="mt-2 space-y-1.5">
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value.slice(0, 30))}
                placeholder="e.g. SWE, PM, Design, HR"
                autoFocus
                className={dark ? "bg-slate-800/60 border-slate-700 text-slate-100" : ""}
              />
              <p className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
                Creates the team for you and opens its retro.
                {" · "}
                <button
                  type="button"
                  onClick={() => { setCustomMode(false); setCustomName(""); }}
                  className={`underline ${dark ? "text-slate-400" : "text-slate-500"} hover:text-current`}
                >
                  Pick from list
                </button>
              </p>
            </div>
          )}
        </div>

        {/* Optional initial goal */}
        {canSetGoal && (
          <div className="mb-4">
            <label className={labelCls}>Goal for the week <span className="font-normal text-slate-500">(optional)</span></label>
            <div className="relative mt-1">
              <Target className={`absolute left-2 top-2.5 w-4 h-4 ${dark ? "text-cyan-400" : "text-teal-600"}`} />
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value.slice(0, 140))}
                rows={2}
                maxLength={140}
                placeholder="What's the team's focus this week?"
                className={`w-full pl-8 pr-3 py-2 rounded-lg border text-sm ${
                  dark
                    ? "bg-slate-800/60 border-slate-700 text-slate-100 placeholder:text-slate-500"
                    : "bg-white border-slate-200 text-slate-800 placeholder:text-slate-400"
                }`}
              />
              <p className={`text-[11px] mt-1 text-right ${dark ? "text-slate-500" : "text-slate-400"}`}>
                {140 - goal.length} chars left
              </p>
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
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !canSubmit}>
            {busy
              ? "Opening…"
              : alreadyExists
                ? "Open existing retro"
                : "Start retro"}
          </Button>
        </div>
      </form>
    </div>
  );
}
