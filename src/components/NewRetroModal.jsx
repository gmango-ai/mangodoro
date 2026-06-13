import { useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Target, Briefcase, Sparkles } from "lucide-react";
import { getOrCreateCurrentRetro, setRetroGoal } from "../lib/retro";
import { useTeam } from "../context/TeamContext";

// Modal for explicitly starting a retro. The user either picks a
// department from the team's curated list (chip selector) or types a
// custom name on the fly. For admins, a custom name they type also
// gets added to the team's canonical `departments` list so future
// retros surface it as a chip — naturally builds up the catalog
// without forcing a separate "manage departments" trip.
//
// If a retro already exists for the chosen (team, dept, week) the
// button reads "Open existing retro" — the lazy-create RPC returns
// the existing row, no duplicates.
export default function NewRetroModal({
  open,
  onClose,
  teamId,
  availableDepartments,
  existingDepartments,
  preselectedDepartment,
  isAdmin,
  onCreated,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { updateTeam, activeTeam } = useTeam();
  const [department, setDepartment] = useState(preselectedDepartment ?? "");
  const [customMode, setCustomMode] = useState(false);
  const [customDept, setCustomDept] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Reset state every time the modal opens. Default to the first
  // department that doesn't already have a retro, falling back to
  // preselected or the "Team" bucket.
  useEffect(() => {
    if (!open) return;
    const firstUntaken = availableDepartments.find((d) => !existingDepartments.includes(d));
    setDepartment(preselectedDepartment ?? firstUntaken ?? availableDepartments[0] ?? "");
    setCustomMode(false);
    setCustomDept("");
    setGoal("");
    setBusy(false);
    setError("");
  }, [open, preselectedDepartment, availableDepartments, existingDepartments]);

  if (!open) return null;

  const effectiveDept = customMode ? customDept.trim() : department;
  const alreadyExists = existingDepartments.includes(effectiveDept);
  const canSetGoal = !alreadyExists && isAdmin;
  const canSubmit = (() => {
    if (customMode) return customDept.trim().length > 0;
    return true;
  })();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!teamId || !canSubmit) return;
    setBusy(true); setError("");

    // If admin typed a brand-new dept name, also fold it into the
    // canonical list so future weeks surface it as a chip. Non-admins
    // can still create a retro at that dept — the canonical list just
    // doesn't update.
    if (
      customMode
      && isAdmin
      && effectiveDept.length > 0
      && !availableDepartments.includes(effectiveDept)
    ) {
      const existing = activeTeam?.departments || [];
      await updateTeam?.(teamId, { departments: [...existing, effectiveDept] });
    }

    const { data, error: err } = await getOrCreateCurrentRetro(teamId, effectiveDept);
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
          One retro per department per week. Picking one that already exists opens it instead.
        </p>

        {/* Department picker */}
        <div className="mb-4">
          <label className={labelCls}>Department</label>
          {!customMode && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {availableDepartments.map((d) => {
                const active = d === department;
                const taken = existingDepartments.includes(d);
                const label = d || "Team";
                return (
                  <button
                    key={d || "__team__"}
                    type="button"
                    onClick={() => setDepartment(d)}
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
                    <Briefcase className="w-3 h-3" />
                    {label}
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
              <button
                type="button"
                onClick={() => setCustomMode(true)}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border border-dashed transition-colors ${
                  dark
                    ? "border-slate-600 text-slate-300 hover:border-cyan-500/60 hover:text-cyan-200"
                    : "border-slate-300 text-slate-600 hover:border-teal-400 hover:text-teal-700"
                }`}
              >
                <Sparkles className="w-3 h-3" /> Custom name…
              </button>
            </div>
          )}
          {customMode && (
            <div className="mt-2 space-y-1.5">
              <Input
                value={customDept}
                onChange={(e) => setCustomDept(e.target.value.slice(0, 30))}
                placeholder="e.g. SWE, PM, Design, HR"
                autoFocus
                className={dark ? "bg-slate-800/60 border-slate-700 text-slate-100" : ""}
              />
              <p className={`text-[11px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
                {isAdmin
                  ? "Saved to the team's department list so future retros pick it up too."
                  : "Used just for this retro. Ask an admin to add it permanently."}
                {" · "}
                <button
                  type="button"
                  onClick={() => { setCustomMode(false); setCustomDept(""); }}
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
