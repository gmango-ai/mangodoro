import { useEffect, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Check, Trash2, Clock } from "lucide-react";
import {
  renameRoomV2, setRoomColor, updateRoomGating, archiveRoomV2,
  setRoomMaxDuration,
} from "../lib/rooms";

const DURATION_PRESETS = [
  { value: 15, label: "15m" },
  { value: 30, label: "30m" },
  { value: 45, label: "45m" },
  { value: 60, label: "1h" },
  { value: 90, label: "1.5h" },
  { value: 120, label: "2h" },
  { value: null, label: "No limit" },
];

const ROOM_COLORS = [
  "#14b8a6", "#0ea5e9", "#6366f1", "#8b5cf6", "#ec4899",
  "#f43f5e", "#f59e0b", "#84cc16", "#10b981", "#64748b",
];

// Combined edit modal for a room. Replaces the inline rename + the
// separate RoomGatingModal — admins/leads change everything from one
// screen. Each section saves independently so a partial failure doesn't
// nuke the rest of the form.
export default function RoomSettingsModal({
  open, onClose, room, orgTeams, isAdmin, myOrgTeamLeadIds, onSaved, onError, onDeleted,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [name, setName] = useState("");
  const [color, setColor] = useState("#14b8a6");
  const [selectedTeamIds, setSelectedTeamIds] = useState([]);
  const [maxDuration, setMaxDuration] = useState(null);   // minutes, or null
  const [customDuration, setCustomDuration] = useState(""); // text in custom input
  const [showCustomDuration, setShowCustomDuration] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState({ name: false, color: false, gating: false, duration: false });
  // Two-step delete: clicking the trash icon flips this to true and the
  // footer swaps in a Confirm / Cancel pair. Avoids needing a separate
  // modal layer for a single destructive action.
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open || !room) return;
    setName(room.name || "");
    setColor(room.color || "#14b8a6");
    setSelectedTeamIds((room.room_teams || []).map((rt) => rt.org_team_id));
    const current = room.max_duration_minutes ?? null;
    setMaxDuration(current);
    // Show the custom input if the existing value isn't a preset.
    const presetValues = DURATION_PRESETS.map((p) => p.value);
    setShowCustomDuration(current != null && !presetValues.includes(current));
    setCustomDuration(current != null && !presetValues.includes(current) ? String(current) : "");
    setDirty({ name: false, color: false, gating: false, duration: false });
    setConfirmDelete(false);
    setBusy(false);
  }, [open, room]);

  async function handleDelete() {
    if (!room?.id) return;
    setBusy(true);
    const { error } = await archiveRoomV2(room.id);
    setBusy(false);
    if (error) {
      onError?.(error.message || "Could not delete room");
      setConfirmDelete(false);
      return;
    }
    onDeleted?.(room.name || "Room");
    onClose?.();
  }

  if (!open || !room) return null;

  const eligibleGatingTeams = isAdmin
    ? orgTeams
    : (orgTeams || []).filter((t) => myOrgTeamLeadIds?.has(t.id) || selectedTeamIds.includes(t.id));

  function toggleTeam(id) {
    setSelectedTeamIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    setDirty((d) => ({ ...d, gating: true }));
  }

  async function handleSave() {
    setBusy(true);
    const errs = [];
    // Run the saves in parallel so the modal closes quickly.
    const tasks = [];
    if (dirty.name && name.trim() && name.trim() !== room.name) {
      tasks.push(renameRoomV2(room.id, name.trim()).then((r) => r.error && errs.push(r.error)));
    }
    if (dirty.color && color !== room.color) {
      tasks.push(setRoomColor(room.id, color).then((r) => r.error && errs.push(r.error)));
    }
    if (dirty.gating) {
      tasks.push(updateRoomGating(room.id, selectedTeamIds).then((r) => r.error && errs.push(r.error)));
    }
    if (dirty.duration && room.kind === "meeting") {
      const next = showCustomDuration
        ? (customDuration.trim() === "" ? null : Math.max(1, parseInt(customDuration, 10) || 0))
        : maxDuration;
      tasks.push(setRoomMaxDuration(room.id, next).then((r) => r.error && errs.push(r.error)));
    }
    await Promise.all(tasks);
    setBusy(false);
    if (errs.length > 0) {
      onError?.(errs[0].message || "Could not save");
      return;
    }
    onSaved?.("Room updated");
  }

  function pickDurationPreset(value) {
    setMaxDuration(value);
    setShowCustomDuration(false);
    setCustomDuration("");
    setDirty((d) => ({ ...d, duration: true }));
  }
  function pickCustomDuration() {
    setShowCustomDuration(true);
    setMaxDuration(null);
    setDirty((d) => ({ ...d, duration: true }));
  }
  function onCustomDurationChange(v) {
    // Strip non-digits; clamp to int. Empty string = "no limit" (null on save).
    const clean = v.replace(/\D/g, "").slice(0, 4);
    setCustomDuration(clean);
    setDirty((d) => ({ ...d, duration: true }));
  }

  const cardCls = `relative w-full max-w-md rounded-2xl border p-5 sm:p-6 ${
    dark ? "bg-[var(--color-surface)] border-[var(--color-border)] shadow-2xl shadow-black/40" : "bg-white border-slate-200 shadow-xl"
  }`;
  const labelCls = `text-[10px] font-semibold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-500"}`;
  const inputCls = dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100" : "";

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4" onClick={onClose}>
      <div className={cardCls} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={`absolute top-3 right-3 p-1.5 rounded-lg ${
            dark ? "hover:bg-[var(--color-surface-raised)] text-slate-400" : "hover:bg-slate-100 text-slate-500"
          }`}
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className={`text-lg font-bold mb-4 flex items-center gap-2 ${dark ? "text-slate-100" : "text-slate-800"}`}>
          <span
            className="w-3 h-3 rounded-md border border-black/10"
            style={{ background: color }}
          />
          Room settings
        </h2>

        {/* Name */}
        <div className="mb-4">
          <label className={labelCls}>Name</label>
          <Input
            value={name}
            onChange={(e) => { setName(e.target.value.slice(0, 40)); setDirty((d) => ({ ...d, name: true })); }}
            className={`mt-1 ${inputCls}`}
            autoFocus
          />
        </div>

        {/* Color */}
        <div className="mb-4">
          <label className={labelCls}>Color</label>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {ROOM_COLORS.map((c) => {
              const active = color === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => { setColor(c); setDirty((d) => ({ ...d, color: true })); }}
                  className={`w-7 h-7 rounded-md border-2 transition-all relative ${
                    active
                      ? "scale-110 shadow-md"
                      : "hover:scale-105"
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

        {/* Meeting duration (meeting rooms only) */}
        {room?.kind === "meeting" && (
          <div className="mb-4">
            <label className={labelCls}>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Auto-close after
              </span>
            </label>
            <p className={`text-[11px] mt-0.5 mb-2 ${dark ? "text-slate-400" : "text-slate-500"}`}>
              {showCustomDuration
                ? (customDuration
                    ? `Session will end after ${customDuration} minute${customDuration === "1" ? "" : "s"}`
                    : "Custom duration in minutes")
                : (maxDuration == null
                    ? "Session stays open until everyone leaves"
                    : `Session will end after ${maxDuration} minute${maxDuration === 1 ? "" : "s"}`)}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {DURATION_PRESETS.map((p) => {
                const active = !showCustomDuration && maxDuration === p.value;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => pickDurationPreset(p.value)}
                    className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                      active
                        ? (dark
                            ? "bg-[var(--accent-bg)] text-[var(--accent-text)] border-[var(--accent-border)]"
                            : "bg-[var(--accent-bg)] text-[var(--accent-text)] border-[var(--accent-border)]")
                        : (dark
                            ? "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50")
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={pickCustomDuration}
                className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                  showCustomDuration
                    ? "bg-[var(--accent-bg)] text-[var(--accent-text)] border-[var(--accent-border)]"
                    : (dark
                        ? "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50")
                }`}
              >
                Custom
              </button>
            </div>
            {showCustomDuration && (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 25"
                  value={customDuration}
                  onChange={(e) => onCustomDurationChange(e.target.value)}
                  className={`w-24 ${inputCls}`}
                />
                <span className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>minutes</span>
              </div>
            )}
          </div>
        )}

        {/* Gating */}
        {eligibleGatingTeams.length > 0 && (
          <div className="mb-4">
            <label className={labelCls}>Visible to</label>
            <p className={`text-[11px] mt-0.5 mb-2 ${dark ? "text-slate-400" : "text-slate-500"}`}>
              {selectedTeamIds.length === 0
                ? "Everyone in the org"
                : `Only ${selectedTeamIds.length} team${selectedTeamIds.length === 1 ? "" : "s"}`}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {eligibleGatingTeams.map((t) => {
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

        <div className="flex items-center gap-2">
          {confirmDelete ? (
            <div className="flex items-center gap-2 flex-1">
              <span className={`text-xs ${dark ? "text-slate-300" : "text-slate-600"}`}>
                Delete "{room.name}"?
              </span>
              <div className="ml-auto flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmDelete(false)}
                  disabled={busy}
                >
                  Keep
                </Button>
                <Button
                  type="button"
                  onClick={handleDelete}
                  disabled={busy}
                  className={dark
                    ? "bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/40"
                    : "bg-red-50 text-red-600 hover:bg-red-100 border border-red-200"}
                >
                  {busy ? "Deleting…" : "Delete room"}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1.5 rounded-md transition-colors ${
                  dark
                    ? "text-red-400 hover:bg-red-500/15"
                    : "text-red-600 hover:bg-red-50"
                }`}
                title="Delete this room"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
              <div className="ml-auto flex gap-2">
                <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={busy || !(dirty.name || dirty.color || dirty.gating || dirty.duration) || !name.trim()}
                >
                  {busy ? "Saving…" : "Save"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
