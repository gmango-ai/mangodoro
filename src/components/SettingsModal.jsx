import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useApp } from "../context/AppContext";
import TimeSelect from "./TimeSelect";
import { toDisplayTime } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

function FieldRow({ label, children, hint }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] items-start gap-x-6 gap-y-1.5 py-3.5 border-b border-[var(--color-border-light)] last:border-0">
      <div className="sm:pt-2">
        <p style={{ fontSize: 13, fontWeight: 500, color: "var(--color-secondary)", margin: 0 }}>{label}</p>
        {hint && <p style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 2 }}>{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function TemplateBreakRow({ b, onChange, onRemove }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, padding: "8px 10px", background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", borderRadius: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: "var(--color-muted)" }}>From</span>
      <TimeSelect value={b.start} onChange={(v) => onChange({ start: v })} />
      <span style={{ fontSize: 11, color: "var(--color-muted)" }}>→</span>
      <TimeSelect value={b.end} onChange={(v) => onChange({ end: v })} />
      <Checkbox id={`tb-${b.id}`} checked={b.unpaid} onCheckedChange={(v) => onChange({ unpaid: !!v })}
        className="border-[var(--color-border)] data-[state=checked]:bg-[var(--color-accent)] data-[state=checked]:border-[var(--color-accent)] h-4 w-4" />
      <Label htmlFor={`tb-${b.id}`} style={{ fontSize: 11, color: "var(--color-secondary)", cursor: "pointer" }}>Unpaid</Label>
      <button onClick={onRemove} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--color-muted)", fontSize: 14, lineHeight: 1 }} className="hover:text-red-400">✕</button>
    </div>
  );
}

function TemplateEditor({ value, onChange, onAddBreak, onChangeBreak, onRemoveBreak, onSave, onCancel, saveLabel = "Save template" }) {
  const inputCls = "bg-[var(--color-input-bg)] border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus-visible:ring-[var(--color-accent)]/40 focus-visible:ring-2 text-sm shadow-sm h-9";
  return (
    <div style={{ background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "14px 16px", marginTop: 8 }}>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 mb-2.5 items-end">
        <div>
          <p style={{ fontSize: 11, color: "var(--color-muted)", fontWeight: 500, marginBottom: 4 }}>Name</p>
          <Input value={value.name || ""} onChange={(e) => onChange({ name: e.target.value })} placeholder="e.g. Regular day" className={inputCls} />
        </div>
        <div>
          <p style={{ fontSize: 11, color: "var(--color-muted)", fontWeight: 500, marginBottom: 4 }}>Start</p>
          <TimeSelect value={value.start || ""} onChange={(v) => onChange({ start: v })} />
        </div>
        <div>
          <p style={{ fontSize: 11, color: "var(--color-muted)", fontWeight: 500, marginBottom: 4 }}>End</p>
          <TimeSelect value={value.end || ""} onChange={(v) => onChange({ end: v })} />
        </div>
      </div>
      {(value.breaks || []).map((b) => (
        <TemplateBreakRow key={b.id} b={b} onChange={(patch) => onChangeBreak(b.id, patch)} onRemove={() => onRemoveBreak(b.id)} />
      ))}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
        <Button variant="outline" size="sm" onClick={onAddBreak} className="h-7 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-secondary)" }}>+ Add break</Button>
        <div style={{ display: "flex", gap: 6 }}>
          <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 px-3 text-xs" style={{ color: "var(--color-secondary)" }}>Cancel</Button>
          <Button size="sm" onClick={onSave} disabled={!value.name || !value.start || !value.end} className="h-7 px-3 text-xs font-semibold disabled:opacity-40" style={{ background: "var(--color-accent)", color: "#fff" }}>
            {saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

const COLORS = ["#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#ef4444", "#64748b"];

// Pastel palette for retro sticky notes. Stays light enough that body
// text reads in either theme without needing a per-color contrast tweak.
const STICKY_COLORS = [
  { hex: "#fde68a", label: "Yellow" },
  { hex: "#fbcfe8", label: "Pink" },
  { hex: "#bfdbfe", label: "Blue" },
  { hex: "#bbf7d0", label: "Green" },
  { hex: "#ddd6fe", label: "Purple" },
  { hex: "#fed7aa", label: "Orange" },
  { hex: "#fecaca", label: "Coral" },
  { hex: "#e2e8f0", label: "Slate" },
];

function StickyColorPicker({ value, onChange }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {STICKY_COLORS.map((c) => {
        const active = value?.toLowerCase() === c.hex.toLowerCase();
        return (
          <button
            key={c.hex}
            type="button"
            onClick={() => onChange(c.hex)}
            title={c.label}
            aria-label={c.label}
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: c.hex,
              border: active ? "2px solid var(--color-text)" : "2px solid transparent",
              cursor: "pointer",
              boxShadow: active ? "0 0 0 1px var(--color-surface)" : "none",
            }}
          />
        );
      })}
    </div>
  );
}

function ProjectEditor({ value, onChange, onSave, onCancel, saveLabel = "Save project" }) {
  const inputCls = "bg-[var(--color-input-bg)] border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus-visible:ring-[var(--color-accent)]/40 focus-visible:ring-2 text-sm shadow-sm h-9";
  return (
    <div style={{ background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "14px 16px", marginTop: 8 }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 140px" }}>
          <p style={{ fontSize: 11, color: "var(--color-muted)", fontWeight: 500, marginBottom: 4 }}>Project name</p>
          <Input value={value.name || ""} onChange={(e) => onChange({ name: e.target.value })} placeholder="e.g. Acme Corp" className={inputCls} />
        </div>
        <div style={{ flex: "1 1 140px" }}>
          <p style={{ fontSize: 11, color: "var(--color-muted)", fontWeight: 500, marginBottom: 4 }}>Client name</p>
          <Input value={value.client_name || ""} onChange={(e) => onChange({ client_name: e.target.value })} placeholder="e.g. John Smith" className={inputCls} />
        </div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <p style={{ fontSize: 11, color: "var(--color-muted)", fontWeight: 500, marginBottom: 6 }}>Color</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {COLORS.map((c) => (
            <button key={c} onClick={() => onChange({ color: c })} style={{ width: 24, height: 24, borderRadius: "50%", background: c, border: value.color === c ? `3px solid var(--color-text)` : "2px solid transparent", cursor: "pointer", transition: "border 0.1s" }} />
          ))}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 px-3 text-xs" style={{ color: "var(--color-secondary)" }}>Cancel</Button>
        <Button size="sm" onClick={onSave} disabled={!value.name} className="h-7 px-3 text-xs font-semibold disabled:opacity-40" style={{ background: "var(--color-accent)", color: "#fff" }}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

const TABS = ["profile", "projects", "templates", "data"];

export default function SettingsModal() {
  const {
    showSettings, setShowSettings, saveSettings,
    draftSettings, setDraftSettings,
    draftTemplates, draftNewTemplate, draftEditingId, draftEditingTemplate,
    startDraftNew, commitDraftNew, startDraftEdit, commitDraftEdit, deleteDraftTemplate,
    setDraftNewTemplate, setDraftEditingId, setDraftEditingTemplate,
    draftProjects, draftNewProject, draftEditingProjectId,
    startDraftNewProject, commitDraftNewProject, startDraftEditProject, commitDraftEditProject, deleteDraftProject,
    setDraftNewProject, setDraftEditingProjectId,
    importEntriesRef, importProfileRef,
    exportAllXLSX, exportProfile, setShowInvoice,
    googleToken, googleTokenExpiry, connectGoogleSheets, disconnectGoogleSheets,
    session,
  } = useApp();

  const [tab, setTab] = useState("profile");

  if (!showSettings) return null;

  const inputCls = "bg-[var(--color-input-bg)] border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus-visible:ring-[var(--color-accent)]/40 focus-visible:ring-2 text-sm shadow-sm";

  return (
    <div
      onClick={() => setShowSettings(false)}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: "var(--color-modal-overlay)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-modal
        style={{ background: "var(--color-modal)", borderRadius: 16, width: "100%", maxWidth: 580, boxShadow: "var(--color-modal-shadow)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "calc(100vh - 48px)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 pt-5 pb-0 flex-shrink-0">
          <div>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--color-text)", fontFamily: "'Parkinsans', sans-serif", margin: 0 }}>Settings</p>
            <p style={{ fontSize: 13, color: "var(--color-muted)", marginTop: 2 }}>Saved to your account.</p>
          </div>
          <button onClick={() => setShowSettings(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-muted)", fontSize: 20, lineHeight: 1, padding: "4px 6px", borderRadius: 6 }} className="hover:text-slate-600">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 px-4 sm:px-6 pt-3 pb-0 border-b flex-shrink-0" style={{ borderBottomColor: "var(--color-border-light)" }}>
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "6px 14px", background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
              color: tab === t ? "var(--color-accent)" : "var(--color-secondary)",
              borderBottom: tab === t ? "2px solid var(--color-accent)" : "2px solid transparent",
              marginBottom: -1, textTransform: "capitalize", transition: "all 0.15s",
            }}>
              {t === "data" ? "Data" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-4 sm:px-6 py-2 flex-1">

          {/* ── PROFILE TAB ── */}
          {tab === "profile" && (
            <>
              {/* Profile picture + display name + custom alarm sound live on
                  a dedicated /account page now. Putting file inputs inside
                  this fixed-position portal modal was freezing the renderer
                  on some Chromium / installed-PWA setups. */}
              <Link
                to="/account"
                onClick={() => setShowSettings(false)}
                className="block py-3 border-b border-[var(--color-border-light)] hover:bg-[var(--color-surface-raised)] -mx-4 sm:-mx-6 px-4 sm:px-6"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
                      Profile picture, display name &amp; alarm sound
                    </p>
                    <p style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 2 }}>
                      Manage uploads on the Account page.
                    </p>
                  </div>
                  <ArrowRight className="w-4 h-4 shrink-0" style={{ color: "var(--color-muted)" }} />
                </div>
              </Link>
              <FieldRow label="Status" hint="What you're up to — visible to teammates">
                <div className="space-y-2 max-w-md">
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { key: "active", label: "Active", color: "bg-emerald-500" },
                      { key: "available", label: "Available", color: "bg-sky-500" },
                      { key: "heads_down", label: "Heads-down", color: "bg-violet-500" },
                      { key: "in_meeting", label: "In meeting", color: "bg-rose-500" },
                      { key: "away", label: "Away", color: "bg-amber-500" },
                    ].map((opt) => {
                      const active = (draftSettings.presenceState || "active") === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setDraftSettings((d) => ({ ...d, presenceState: opt.key }))}
                          className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full transition-colors ${
                            active
                              ? "bg-[var(--color-accent)] text-white"
                              : "bg-[var(--color-surface-raised)] text-[var(--color-secondary)] hover:bg-[var(--color-surface-hover)]"
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${opt.color}`} />
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <Input
                    value={draftSettings.status ?? ""}
                    onChange={(e) => setDraftSettings((d) => ({ ...d, status: e.target.value.slice(0, 80) }))}
                    placeholder="What are you working on? (optional)"
                    maxLength={80}
                    className={`${inputCls} h-10`}
                  />
                </div>
              </FieldRow>
              <FieldRow label="Hourly rate" hint="Used to calculate earnings">
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 14, color: "var(--color-secondary)" }}>$</span>
                  <Input type="number" min="0" step="0.01" value={draftSettings.hourlyRate ?? ""} onChange={(e) => setDraftSettings((d) => ({ ...d, hourlyRate: e.target.value }))} placeholder="0.00" className={`${inputCls} h-10 w-28`} />
                  <span style={{ fontSize: 13, color: "var(--color-muted)" }}>/hr</span>
                </div>
              </FieldRow>

              <p style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 20, marginBottom: 0 }}>Notifications</p>
              <FieldRow label="Daily reminder" hint="Notifies you if no hours logged by this time">
                <div className="flex items-center gap-3 flex-wrap">
                  <TimeSelect value={draftSettings._reminderTime || ""} onChange={(v) => setDraftSettings((d) => ({ ...d, _reminderTime: v }))} />
                  {draftSettings._reminderTime && (
                    <button onClick={() => setDraftSettings((d) => ({ ...d, _reminderTime: "" }))} style={{ fontSize: 12, color: "var(--color-muted)", background: "none", border: "none", cursor: "pointer" }} className="hover:text-red-400">Clear</button>
                  )}
                  {"Notification" in window && Notification.permission !== "granted" && (
                    <button onClick={() => Notification.requestPermission()} style={{ fontSize: 12, color: "var(--color-accent)", background: "var(--color-accent-light)", border: "1px solid var(--color-accent-border)", borderRadius: 6, cursor: "pointer", padding: "4px 10px", fontWeight: 500 }}>Allow notifications</button>
                  )}
                  {"Notification" in window && Notification.permission === "granted" && (
                    <span style={{ fontSize: 11, color: "var(--color-success)" }}>✓ Allowed</span>
                  )}
                </div>
              </FieldRow>

              <p style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 20, marginBottom: 0 }}>Integrations</p>
              <FieldRow label="Google Sheets" hint="Export months directly to a new Google Sheet">
                {googleToken && Date.now() < googleTokenExpiry ? (
                  <div className="flex items-center gap-3">
                    <span style={{ fontSize: 13, color: "var(--color-success)", display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--color-success)", display: "inline-block" }} />
                      Connected
                    </span>
                    <button onClick={disconnectGoogleSheets} style={{ fontSize: 12, color: "var(--color-muted)", background: "none", border: "none", cursor: "pointer" }} className="hover:text-red-400">Disconnect</button>
                  </div>
                ) : (
                  <button
                    onClick={connectGoogleSheets}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500, padding: "6px 14px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface-raised)", color: "var(--color-text)", cursor: "pointer" }}
                    className="hover:border-[var(--color-accent)] transition-colors"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M14 3H7C5.9 3 5 3.9 5 5V19C5 20.1 5.9 21 7 21H17C18.1 21 19 20.1 19 19V8L14 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M14 3V8H19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M9 13H15M9 17H15M9 9H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Connect Google Sheets
                  </button>
                )}
              </FieldRow>

              <p style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 20, marginBottom: 0 }}>AI</p>
              <FieldRow label="DeepSeek API key" hint="Enables description rewriter & month summaries">
                <Input type="password" value={draftSettings._deepseekKey ?? ""} onChange={(e) => setDraftSettings((d) => ({ ...d, _deepseekKey: e.target.value }))} placeholder="sk-…" className={`${inputCls} h-10 max-w-xs font-mono`} />
              </FieldRow>

              <p style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 20, marginBottom: 0 }}>App</p>
              <FieldRow label="Default landing page" hint="Where opening the app drops you">
                <Select value={draftSettings._defaultLandingPage || "pomodoro"} onValueChange={(v) => setDraftSettings((d) => ({ ...d, _defaultLandingPage: v }))}>
                  <SelectTrigger className={`${inputCls} h-10 w-44`}><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)]">
                    <SelectItem value="pomodoro" className="focus:bg-[var(--color-accent-light)]">Pomodoro</SelectItem>
                    <SelectItem value="log" className="focus:bg-[var(--color-accent-light)]">Time tracker</SelectItem>
                  </SelectContent>
                </Select>
              </FieldRow>

              <FieldRow label="Sticky-note color" hint="Background tint for the retro cards you write">
                <StickyColorPicker
                  value={draftSettings._stickyColor || "#fde68a"}
                  onChange={(v) => setDraftSettings((d) => ({ ...d, _stickyColor: v }))}
                />
              </FieldRow>

              <p style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 20, marginBottom: 0 }}>Time tracking</p>
              <FieldRow label="Default entry mode" hint="Which tab opens by default on the log form">
                <Select value={draftSettings._defaultEntryMode || "manual"} onValueChange={(v) => setDraftSettings((d) => ({ ...d, _defaultEntryMode: v }))}>
                  <SelectTrigger className={`${inputCls} h-10 w-36`}><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)]">
                    <SelectItem value="manual" className="focus:bg-[var(--color-accent-light)]">Manual</SelectItem>
                    <SelectItem value="auto" className="focus:bg-[var(--color-accent-light)]">Automatic</SelectItem>
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Time rounding" hint="Applied on clock in (down) and clock out (up)">
                <Select value={draftSettings._timeRounding || "none"} onValueChange={(v) => setDraftSettings((d) => ({ ...d, _timeRounding: v }))}>
                  <SelectTrigger className={`${inputCls} h-10 w-36`}><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)]">
                    {[["none", "No rounding"], ["1", "1 minute"], ["5", "5 minutes"], ["15", "15 minutes"], ["30", "30 minutes"]].map(([v, l]) => (
                      <SelectItem key={v} value={v} className="focus:bg-[var(--color-accent-light)]">{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
              <FieldRow label="Daily goal" hint="Hours target per day">
                <div className="flex items-center gap-2">
                  <Input type="number" min="0" max="24" step="0.5" value={draftSettings.dailyTarget ?? ""} onChange={(e) => setDraftSettings((d) => ({ ...d, dailyTarget: e.target.value }))} placeholder="0" className={`${inputCls} h-10 w-24`} />
                  <span style={{ fontSize: 13, color: "var(--color-muted)" }}>hrs / day</span>
                </div>
              </FieldRow>
              <FieldRow label="Weekly goal" hint="Hours target per week">
                <div className="flex items-center gap-2">
                  <Input type="number" min="0" max="168" step="1" value={draftSettings.weeklyTarget ?? ""} onChange={(e) => setDraftSettings((d) => ({ ...d, weeklyTarget: e.target.value }))} placeholder="0" className={`${inputCls} h-10 w-24`} />
                  <span style={{ fontSize: 13, color: "var(--color-muted)" }}>hrs / week</span>
                </div>
              </FieldRow>

              <p style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 20, marginBottom: 0 }}>Defaults for new entries</p>
              <FieldRow label="Default template" hint={draftSettings.defaultTemplateId ? "Overrides start & end times" : "Optional"}>
                <Select value={draftSettings.defaultTemplateId ? String(draftSettings.defaultTemplateId) : "__none__"} onValueChange={(v) => setDraftSettings((d) => ({ ...d, defaultTemplateId: v === "__none__" ? undefined : v }))}>
                  <SelectTrigger className={`${inputCls} h-10 w-48`}><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)]">
                    <SelectItem value="__none__" className="focus:bg-[var(--color-accent-light)]">None</SelectItem>
                    {draftTemplates.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)} className="focus:bg-[var(--color-accent-light)]">{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>
              {!draftSettings.defaultTemplateId && (
                <>
                  <FieldRow label="Default start"><TimeSelect value={draftSettings.defaultStart || ""} onChange={(v) => setDraftSettings((d) => ({ ...d, defaultStart: v }))} /></FieldRow>
                  <FieldRow label="Default end"><TimeSelect value={draftSettings.defaultEnd || ""} onChange={(v) => setDraftSettings((d) => ({ ...d, defaultEnd: v }))} /></FieldRow>
                </>
              )}
              <div style={{ height: 16 }} />
            </>
          )}

          {/* ── PROJECTS TAB ── */}
          {tab === "projects" && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, marginBottom: 4 }}>
                <p style={{ fontSize: 13, color: "var(--color-secondary)", margin: 0 }}>
                  {draftProjects.length === 0 ? "No projects yet." : `${draftProjects.length} project${draftProjects.length !== 1 ? "s" : ""}`}
                </p>
                {!draftNewProject && draftEditingProjectId === null && (
                  <button onClick={startDraftNewProject} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--color-accent)", fontWeight: 600, padding: "2px 0" }}>+ New project</button>
                )}
              </div>

              {draftProjects.map((p) => {
                if (draftEditingProjectId === p.id && draftNewProject) {
                  return (
                    <ProjectEditor key={p.id} value={draftNewProject} onChange={(patch) => setDraftNewProject((d) => ({ ...d, ...patch }))} onSave={commitDraftEditProject} onCancel={() => { setDraftEditingProjectId(null); setDraftNewProject(null); }} saveLabel="Update project" />
                  );
                }
                return (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", borderRadius: 10, marginTop: 8 }}>
                    <span style={{ width: 12, height: 12, borderRadius: "50%", background: p.color || "#14b8a6", display: "inline-block", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", margin: 0 }}>{p.name}</p>
                      {p.client_name && <p style={{ fontSize: 11, color: "var(--color-muted)", margin: "2px 0 0" }}>{p.client_name}</p>}
                    </div>
                    <button onClick={() => startDraftEditProject(p)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--color-secondary)", padding: "2px 4px" }}>Edit</button>
                    <button onClick={() => deleteDraftProject(p.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--color-muted)", padding: "2px 4px" }} className="hover:text-red-400">Delete</button>
                  </div>
                );
              })}

              {draftNewProject && draftEditingProjectId === null && (
                <ProjectEditor value={draftNewProject} onChange={(patch) => setDraftNewProject((d) => ({ ...d, ...patch }))} onSave={commitDraftNewProject} onCancel={() => setDraftNewProject(null)} saveLabel="Add project" />
              )}
              <div style={{ height: 16 }} />
            </>
          )}

          {/* ── TEMPLATES TAB ── */}
          {tab === "templates" && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 16, marginBottom: 4 }}>
                <p style={{ fontSize: 13, color: "var(--color-secondary)", margin: 0 }}>
                  {draftTemplates.length === 0 ? "No templates yet." : `${draftTemplates.length} template${draftTemplates.length !== 1 ? "s" : ""}`}
                </p>
                {!draftNewTemplate && draftEditingId === null && (
                  <button onClick={startDraftNew} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--color-accent)", fontWeight: 600, padding: "2px 0" }}>+ New template</button>
                )}
              </div>

              {draftTemplates.map((t) => {
                if (draftEditingId === t.id && draftEditingTemplate) {
                  return (
                    <TemplateEditor key={t.id} value={draftEditingTemplate}
                      onChange={(patch) => setDraftEditingTemplate((d) => ({ ...d, ...patch }))}
                      onAddBreak={() => setDraftEditingTemplate((d) => ({ ...d, breaks: [...(d.breaks || []), { id: Date.now(), start: "", end: "", unpaid: true }] }))}
                      onChangeBreak={(bid, patch) => setDraftEditingTemplate((d) => ({ ...d, breaks: d.breaks.map((b) => b.id === bid ? { ...b, ...patch } : b) }))}
                      onRemoveBreak={(bid) => setDraftEditingTemplate((d) => ({ ...d, breaks: d.breaks.filter((b) => b.id !== bid) }))}
                      onSave={commitDraftEdit}
                      onCancel={() => { setDraftEditingId(null); setDraftEditingTemplate(null); }}
                      saveLabel="Update template"
                    />
                  );
                }
                const breakCount = (t.breaks || []).length;
                return (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", borderRadius: 10, marginTop: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)", margin: 0 }}>{t.name}</p>
                      <p style={{ fontSize: 11, color: "var(--color-muted)", margin: "2px 0 0", fontFamily: "'DM Mono', monospace" }}>
                        {toDisplayTime(t.start)} – {toDisplayTime(t.end)}
                        {breakCount > 0 && ` · ${breakCount} break${breakCount > 1 ? "s" : ""}`}
                      </p>
                    </div>
                    {draftSettings.defaultTemplateId === t.id && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--color-accent)", background: "var(--color-accent-light)", border: "1px solid var(--color-accent-border)", borderRadius: 20, padding: "2px 8px" }}>default</span>
                    )}
                    <button onClick={() => startDraftEdit(t)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--color-secondary)", padding: "2px 4px" }}>Edit</button>
                    <button onClick={() => deleteDraftTemplate(t.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--color-muted)", padding: "2px 4px" }} className="hover:text-red-400">Delete</button>
                  </div>
                );
              })}

              {draftNewTemplate && (
                <TemplateEditor value={draftNewTemplate}
                  onChange={(patch) => setDraftNewTemplate((d) => ({ ...d, ...patch }))}
                  onAddBreak={() => setDraftNewTemplate((d) => ({ ...d, breaks: [...(d.breaks || []), { id: Date.now(), start: "", end: "", unpaid: true }] }))}
                  onChangeBreak={(bid, patch) => setDraftNewTemplate((d) => ({ ...d, breaks: d.breaks.map((b) => b.id === bid ? { ...b, ...patch } : b) }))}
                  onRemoveBreak={(bid) => setDraftNewTemplate((d) => ({ ...d, breaks: d.breaks.filter((b) => b.id !== bid) }))}
                  onSave={commitDraftNew}
                  onCancel={() => setDraftNewTemplate(null)}
                  saveLabel="Add template"
                />
              )}
              <div style={{ height: 16 }} />
            </>
          )}

          {/* ── DATA TAB ── */}
          {tab === "data" && (
            <>
              <p style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 16, marginBottom: 0 }}>Export</p>
              <FieldRow label="All entries XLSX" hint="Download full history">
                <Button variant="outline" size="sm" onClick={exportAllXLSX} className="h-8 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-secondary)" }}>
                  Download XLSX
                </Button>
              </FieldRow>
              <FieldRow label="Invoice" hint="Generate PDF invoice">
                <Button variant="outline" size="sm" onClick={() => { setShowSettings(false); setShowInvoice(true); }} className="h-8 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-secondary)" }}>
                  Generate Invoice
                </Button>
              </FieldRow>
              <FieldRow label="Profile JSON" hint="Templates + settings">
                <Button variant="outline" size="sm" onClick={exportProfile} className="h-8 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-secondary)" }}>
                  Download profile.json
                </Button>
              </FieldRow>

              <p style={{ fontSize: 11, fontWeight: 600, color: "var(--color-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 20, marginBottom: 0 }}>Import</p>
              <FieldRow label="Import entries" hint="JSON file of work entries">
                <Button variant="outline" size="sm" onClick={() => importEntriesRef.current?.click()} className="h-8 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-secondary)" }}>
                  Load entries.json…
                </Button>
              </FieldRow>
              <FieldRow label="Import profile" hint="Merges templates into your list">
                <Button variant="outline" size="sm" onClick={() => importProfileRef.current?.click()} className="h-8 text-xs" style={{ borderColor: "var(--color-border)", color: "var(--color-secondary)" }}>
                  Load profile.json…
                </Button>
              </FieldRow>
              <div style={{ height: 16 }} />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-4 sm:px-6 py-3.5 border-t flex-shrink-0 gap-2" style={{ borderTopColor: "var(--color-border-light)" }}>
          <Button variant="ghost" size="sm" onClick={() => setShowSettings(false)} className="h-9 px-4 text-sm" style={{ color: "var(--color-secondary)" }}>Cancel</Button>
          <Button size="sm" onClick={saveSettings} className="h-9 px-5 text-sm font-semibold" style={{ background: "var(--color-accent)", color: "#fff" }}>Save</Button>
        </div>
      </div>
    </div>
  );
}

