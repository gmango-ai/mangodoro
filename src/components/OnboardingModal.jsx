import { useState } from "react";
import { useApp } from "../context/AppContext";
import { useTheme } from "../context/ThemeContext";
import { supabase } from "../supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles } from "lucide-react";
import AvatarUploader from "./AvatarUploader";

export default function OnboardingModal({ open, onClose, userId }) {
  const { setSettings, setHourlyRate, setDailyTarget, setWeeklyTarget, flash } = useApp();
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [payType, setPayType] = useState("hourly");
  const [hourly, setHourly] = useState("");
  const [annual, setAnnual] = useState("");
  const [dailyGoal, setDailyGoal] = useState("8");
  const [weeklyGoal, setWeeklyGoal] = useState("40");
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const effectiveHourly = payType === "annual"
    ? (parseFloat(annual) || 0) / 2080
    : (parseFloat(hourly) || 0);

  async function handleFinish() {
    if (!userId) return;
    setSaving(true);
    const rate = Math.round(effectiveHourly * 100) / 100;
    const daily = parseFloat(dailyGoal) || 0;
    const weekly = parseFloat(weeklyGoal) || 0;

    const { error } = await supabase.from("user_settings").upsert({
      user_id: userId,
      name: name.trim() || null,
      hourly_rate: rate,
      daily_target: daily,
      weekly_target: weekly,
      avatar_url: avatarUrl || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    setSaving(false);

    if (error) {
      console.error("onboarding save:", error);
      flash(`✗ Couldn't save: ${error.message}`);
      return;
    }

    // Mirror to local context state so UI updates immediately.
    setSettings((s) => ({ ...s, name: name.trim(), avatarUrl }));
    setHourlyRate(rate);
    setDailyTarget(daily);
    setWeeklyTarget(weekly);
    flash("✓ Welcome to Mangodoro!");
    onClose();
  }

  function handleSkip() {
    onClose();
  }

  const overlayCls = "fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4";
  const modalCls = `relative w-full max-w-md rounded-2xl border p-6 sm:p-8 ${
    dark
      ? "shadow-2xl shadow-black/40 bg-[var(--color-surface)] border-[var(--color-border)]"
      : "bg-white border-slate-200 shadow-xl"
  }`;
  const labelCls = `text-xs font-semibold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-500"}`;
  const helpCls = `text-xs mt-1 ${dark ? "text-slate-500" : "text-slate-400"}`;
  const inputCls = `${
    dark ? "border bg-[var(--color-surface-raised)] border-[var(--color-border)] text-slate-100" : ""
  }`;

  return (
    <div className={overlayCls}>
      <div className={modalCls}>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-5 h-5 text-[var(--color-accent)]" />
          <h2 className={`text-lg font-bold ${dark ? "text-slate-100" : "text-slate-800"}`}>
            Welcome to Mangodoro
          </h2>
        </div>
        <p className={`text-sm mb-6 ${dark ? "text-slate-400" : "text-slate-500"}`}>
          Set a few defaults to get started. You can change these any time in Settings.
        </p>

        {step === 0 && (
          <div className="space-y-5">
            <div>
              <label className={labelCls}>Profile picture</label>
              <div className="mt-1.5">
                <AvatarUploader
                  userId={userId}
                  value={avatarUrl}
                  displayName={name}
                  size={72}
                  onChange={(url) => { setAvatarUrl(url); setUploadError(""); }}
                  onError={setUploadError}
                />
              </div>
              {uploadError && (
                <p className={`text-xs mt-1 ${dark ? "text-red-400" : "text-red-500"}`}>{uploadError}</p>
              )}
            </div>

            <div>
              <label className={labelCls}>Your name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Alex Smith"
                className={`${inputCls} mt-1.5 h-10`}
              />
              <p className={helpCls}>Shown in title bar and exports.</p>
            </div>

            <div>
              <label className={labelCls}>Pay</label>
              <div className="flex gap-1 mt-1.5 mb-2">
                <button
                  type="button"
                  onClick={() => setPayType("hourly")}
                  className={`flex-1 text-xs font-semibold py-1.5 rounded-md transition-colors ${
                    payType === "hourly"
                      ? dark
                        ? "bg-[var(--color-accent-light-hover)] text-[var(--color-accent)]"
                        : "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
                      : dark
                        ? "bg-[var(--color-surface-raised)] text-slate-400"
                        : "bg-slate-100 text-slate-500"
                  }`}
                >
                  Hourly
                </button>
                <button
                  type="button"
                  onClick={() => setPayType("annual")}
                  className={`flex-1 text-xs font-semibold py-1.5 rounded-md transition-colors ${
                    payType === "annual"
                      ? dark
                        ? "bg-[var(--color-accent-light-hover)] text-[var(--color-accent)]"
                        : "bg-[var(--color-accent-light)] text-[var(--color-accent)]"
                      : dark
                        ? "bg-[var(--color-surface-raised)] text-slate-400"
                        : "bg-slate-100 text-slate-500"
                  }`}
                >
                  Annual salary
                </button>
              </div>

              {payType === "hourly" ? (
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>$</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={hourly}
                    onChange={(e) => setHourly(e.target.value)}
                    placeholder="0.00"
                    className={`${inputCls} h-10 w-32`}
                  />
                  <span className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>/ hour</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>$</span>
                    <Input
                      type="number"
                      min="0"
                      step="100"
                      value={annual}
                      onChange={(e) => setAnnual(e.target.value)}
                      placeholder="0"
                      className={`${inputCls} h-10 w-36`}
                    />
                    <span className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>/ year</span>
                  </div>
                  {effectiveHourly > 0 && (
                    <p className={helpCls}>
                      ≈ ${effectiveHourly.toFixed(2)} / hour (÷ 2080 hrs)
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div>
              <label className={labelCls}>Daily goal</label>
              <div className="flex items-center gap-2 mt-1.5">
                <Input
                  type="number"
                  min="0"
                  max="24"
                  step="0.5"
                  value={dailyGoal}
                  onChange={(e) => setDailyGoal(e.target.value)}
                  className={`${inputCls} h-10 w-24`}
                />
                <span className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>hours / day</span>
              </div>
              <p className={helpCls}>Used to track progress on the overview page.</p>
            </div>
            <div>
              <label className={labelCls}>Weekly goal</label>
              <div className="flex items-center gap-2 mt-1.5">
                <Input
                  type="number"
                  min="0"
                  max="168"
                  step="1"
                  value={weeklyGoal}
                  onChange={(e) => setWeeklyGoal(e.target.value)}
                  className={`${inputCls} h-10 w-24`}
                />
                <span className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>hours / week</span>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-8 gap-3">
          <button
            type="button"
            onClick={handleSkip}
            className={`text-xs font-medium ${
              dark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"
            }`}
          >
            Skip for now
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep((s) => s - 1)}
                className="h-9 px-4 text-sm"
              >
                Back
              </Button>
            )}
            {step < 1 ? (
              <Button
                size="sm"
                onClick={() => setStep((s) => s + 1)}
                className="h-9 px-5 text-sm font-semibold"
              >
                Next
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleFinish}
                disabled={saving}
                className="h-9 px-5 text-sm font-semibold"
              >
                {saving ? "Saving…" : "Get started"}
              </Button>
            )}
          </div>
        </div>

        {/* Step dots */}
        <div className="flex justify-center gap-1.5 mt-4">
          {[0, 1].map((i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === step
                  ? "bg-[var(--color-accent)]"
                  : dark ? "bg-slate-700" : "bg-slate-200"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
