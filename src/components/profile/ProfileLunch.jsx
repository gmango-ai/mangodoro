import { Utensils } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useTheme } from "../../context/ThemeContext";
import TimeSelect from "../TimeSelect";

// Lunch-hours setup on your own profile — the schedule that drives the auto
// "Out to lunch" status + the lunch_reminder notification (see LunchReminder).
// Same settings fields as the Settings page, surfaced here for convenience.
export default function ProfileLunch() {
  const { settings, updateSettingsField } = useApp();
  const { theme } = useTheme();
  const dark = theme === "dark";
  const mode = settings?.lunchMode || "off";

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Utensils className="w-4 h-4 text-[var(--color-accent)]" />
        <span className={`text-sm font-bold ${dark ? "text-slate-200" : "text-slate-700"}`}>Lunch hours</span>
      </div>
      <p className={`text-[11px] mb-2 ${dark ? "text-slate-500" : "text-slate-400"}`}>
        At your lunch time we flip your status to Out to lunch — automatically, or after a prompt — and remind you. It flips back when the break is over.
      </p>
      <div className="flex gap-1.5 mb-2">
        {[["off", "Off"], ["ask", "Ask me"], ["auto", "Automatic"]].map(([v, l]) => {
          const on = mode === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => updateSettingsField({ lunchMode: v })}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                on
                  ? dark ? "bg-orange-500/25 text-orange-200" : "bg-orange-100 text-orange-700"
                  : dark ? "text-slate-300 hover:bg-white/10" : "text-slate-600 hover:bg-slate-100"
              }`}
            >{l}</button>
          );
        })}
      </div>
      {mode !== "off" && (
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <span className={dark ? "text-slate-400" : "text-slate-500"}>At</span>
          <TimeSelect value={settings?.lunchTime || ""} onChange={(v) => updateSettingsField({ lunchTime: v || null })} />
          <span className={dark ? "text-slate-400" : "text-slate-500"}>for</span>
          <select
            value={settings?.lunchDurationMin ?? 60}
            onChange={(e) => updateSettingsField({ lunchDurationMin: Number(e.target.value) })}
            className={`rounded-lg px-2 py-1.5 text-sm border ${dark ? "bg-[var(--color-surface)] border-[var(--color-border)] text-slate-200" : "bg-white border-slate-200 text-slate-700"}`}
          >
            {[30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </div>
      )}
    </div>
  );
}
