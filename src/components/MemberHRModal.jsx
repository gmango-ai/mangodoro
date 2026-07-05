import { useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Briefcase, Clock, DollarSign } from "lucide-react";
import UserAvatar from "./UserAvatar";
import Modal from "./Modal";

// Admin modal for editing a member's HR fields. Persists via the
// caller's onSave (which wraps updateMemberHR from TeamContext).
export default function MemberHRModal({ open, onClose, member, onSave }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [classification, setClassification] = useState("hourly");
  const [hourlyRate, setHourlyRate] = useState("");
  const [weeklyTargetHours, setWeeklyTargetHours] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !member) return;
    setClassification(member.classification || "hourly");
    setHourlyRate(member.hourly_rate != null ? String(member.hourly_rate) : "");
    setWeeklyTargetHours(member.weekly_target_hours != null ? String(member.weekly_target_hours) : "");
    setBusy(false);
    setError("");
  }, [open, member]);

  if (!open || !member) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    const { error: err } = await onSave?.({
      classification,
      hourlyRate: hourlyRate === "" ? null : parseFloat(hourlyRate),
      weeklyTargetHours: weeklyTargetHours === "" ? null : parseFloat(weeklyTargetHours),
    });
    setBusy(false);
    if (err) { setError(err.message || "Could not save."); return; }
    onClose();
  }

  const cardCls = `relative w-full max-w-md rounded-2xl border p-5 sm:p-6 ${
    dark ? "bg-[var(--color-surface)] border-[var(--color-border)] shadow-2xl shadow-black/40" : "bg-white border-slate-200 shadow-xl"
  }`;
  const labelCls = `text-[10px] font-semibold uppercase tracking-wider ${
    dark ? "text-slate-400" : "text-slate-500"
  }`;
  const inputCls = dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100" : "";

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

        <div className="flex items-center gap-3 mb-4">
          <UserAvatar url={member.avatar_url} name={member.name} size={36} />
          <div>
            <h2 className={`text-base font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
              {member.name}
            </h2>
            <p className={`text-[11px] ${dark ? "text-slate-400" : "text-slate-500"}`}>
              HR fields — admin only
            </p>
          </div>
        </div>

        {/* Classification toggle */}
        <div className="mb-4">
          <label className={labelCls}>Classification</label>
          <div className={`inline-flex mt-2 rounded-lg p-0.5 ${dark ? "bg-[var(--color-surface-raised)]" : "bg-slate-100"}`}>
            {[
              ["salary", "Salary"],
              ["hourly", "Hourly"],
            ].map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setClassification(v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                  classification === v
                    ? dark ? "bg-slate-700 text-white" : "bg-white text-slate-800 shadow-sm"
                    : dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <Briefcase className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
          <p className={`text-[11px] mt-1.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>
            Salary gets a simple clock card. Hourly keeps the precise time tracker.
          </p>
        </div>

        {/* Hourly rate */}
        <div className="mb-4">
          <label className={labelCls}>Hourly rate</label>
          <div className="relative mt-1">
            <DollarSign className={`absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 ${dark ? "text-slate-500" : "text-slate-400"}`} />
            <Input
              type="number"
              min="0"
              step="0.01"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              placeholder="0.00"
              className={`pl-7 ${inputCls}`}
            />
          </div>
          <p className={`text-[11px] mt-1 ${dark ? "text-slate-500" : "text-slate-400"}`}>
            {classification === "salary"
              ? "Stored for invoicing; not shown on the clock card."
              : "Used to compute earnings on the time tracker."}
          </p>
        </div>

        {/* Weekly target hours */}
        <div className="mb-4">
          <label className={labelCls}>Weekly target hours</label>
          <div className="relative mt-1">
            <Clock className={`absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 ${dark ? "text-slate-500" : "text-slate-400"}`} />
            <Input
              type="number"
              min="0"
              max="168"
              step="0.5"
              value={weeklyTargetHours}
              onChange={(e) => setWeeklyTargetHours(e.target.value)}
              placeholder="40"
              className={`pl-7 ${inputCls}`}
            />
          </div>
          <p className={`text-[11px] mt-1 ${dark ? "text-slate-500" : "text-slate-400"}`}>
            Drives the progress bar on the salary clock card.
          </p>
        </div>

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
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
