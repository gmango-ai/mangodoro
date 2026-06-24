import { Clock, Coffee, LogOut, Play, Undo2 } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import WidgetSection from "./WidgetSection";

// Clock in / out and a quick "On lunch" right from the office (hallway or a
// room). Drives the same AppContext clock used by the log-hours form, so the
// session becomes a real logged entry on clock-out. "On lunch" sets your status
// + logs a lunch break (paid/unpaid per Settings) in one tap.
export default function WorkClockWidget({ dark }) {
  const {
    clockIn, clockedTick, handleClockIn, clockOutAndFill,
    startClockBreak, endClockBreak, clockedElapsed, settings, updateStatus, session,
  } = useApp();
  const { syncSession, setStatus: setSyncStatus } = useSyncSession();
  const userId = session?.user?.id;
  void clockedTick; // re-render the elapsed label as it ticks

  const applyPresence = async (state) => {
    try {
      await updateStatus({ presenceState: state });
      if (syncSession && setSyncStatus) await setSyncStatus({ presenceState: state });
    } catch { /* presence is best-effort */ }
  };

  const onBreak = !!clockIn?.activeBreak;
  const lunchPaid = settings?.lunchBreakPaid;

  const goLunch = async () => {
    if (!clockIn || onBreak) return;
    startClockBreak({ unpaid: !lunchPaid, kind: "lunch" });
    await applyPresence("out_to_lunch");
    try { localStorage.setItem(`lunch_until:${userId}`, String(Date.now() + (settings?.lunchDurationMin || 60) * 60000)); } catch { /* */ }
  };
  const backFromLunch = async () => {
    endClockBreak();
    await applyPresence("active");
    try { localStorage.removeItem(`lunch_until:${userId}`); } catch { /* */ }
  };
  const handleClockOut = async () => {
    if (onBreak || settings?.presenceState === "out_to_lunch") {
      await applyPresence("active");
      try { localStorage.removeItem(`lunch_until:${userId}`); } catch { /* */ }
    }
    clockOutAndFill();
  };

  const btn = "inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors";

  return (
    <WidgetSection id="work-clock" icon={Clock} title="My clock" dark={dark}>
      {!clockIn ? (
        <button
          type="button"
          onClick={() => handleClockIn()}
          className={`${btn} w-full bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]`}
        >
          <Play className="w-4 h-4" /> Clock in
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className={`text-lg font-bold tabular-nums ${dark ? "text-slate-100" : "text-slate-800"}`}>{clockedElapsed() || "0m"}</span>
            <span className={`text-[10px] uppercase tracking-wider font-semibold ${onBreak ? "text-orange-400" : dark ? "text-emerald-400" : "text-emerald-600"}`}>
              {onBreak ? "On lunch" : "Working"}
            </span>
          </div>
          {clockIn.description?.trim() && (
            <p className={`text-[11px] truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>{clockIn.description}</p>
          )}
          <div className="flex gap-1.5">
            {onBreak ? (
              <button type="button" onClick={backFromLunch} className={`${btn} flex-1 ${dark ? "bg-[var(--color-surface-raised)] text-slate-200 hover:bg-slate-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                <Undo2 className="w-3.5 h-3.5" /> Back
              </button>
            ) : (
              <button type="button" onClick={goLunch} className={`${btn} flex-1 ${dark ? "bg-orange-500/20 text-orange-200 hover:bg-orange-500/30" : "bg-orange-100 text-orange-700 hover:bg-orange-200"}`}>
                <Coffee className="w-3.5 h-3.5" /> On lunch
              </button>
            )}
            <button type="button" onClick={handleClockOut} className={`${btn} flex-1 ${dark ? "bg-[var(--color-surface-raised)] text-slate-200 hover:bg-slate-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
              <LogOut className="w-3.5 h-3.5" /> Clock out
            </button>
          </div>
          {!onBreak && (
            <p className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
              Lunch logs as {lunchPaid ? "paid" : "unpaid"} — change in Settings.
            </p>
          )}
        </div>
      )}
    </WidgetSection>
  );
}
