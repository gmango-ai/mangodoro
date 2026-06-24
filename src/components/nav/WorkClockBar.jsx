import { useRef, useState } from "react";
import { Coffee, LogOut, Play, Undo2 } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import Popover from "../goals/Popover";

// Compact clock-in control for the top bar. Not clocked in → a "Clock in" pill;
// clocked in → a live-elapsed pill that opens a small menu (On lunch / Back /
// Clock out). Drives the same AppContext clock as the log-hours form.
export default function WorkClockBar({ dark }) {
  const {
    clockIn, clockedTick, handleClockIn, clockOutAndFill,
    startClockBreak, endClockBreak, clockedElapsed, settings, updateStatus, session,
  } = useApp();
  const { syncSession, setStatus: setSyncStatus } = useSyncSession();
  const userId = session?.user?.id;
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  void clockedTick; // re-render the elapsed label as it ticks

  const applyPresence = async (state) => {
    try {
      if (syncSession && setSyncStatus) await setSyncStatus({ presenceState: state });
      else await updateStatus({ presenceState: state });
    } catch { /* best-effort */ }
  };

  const onBreak = !!clockIn?.activeBreak;
  const lunchPaid = settings?.lunchBreakPaid;
  const goLunch = async () => {
    if (!clockIn || onBreak) return;
    startClockBreak({ unpaid: !lunchPaid, kind: "lunch" });
    await applyPresence("out_to_lunch");
    try { localStorage.setItem(`lunch_until:${userId}`, String(Date.now() + (settings?.lunchDurationMin || 60) * 60000)); } catch { /* */ }
    setOpen(false);
  };
  const backFromLunch = async () => {
    endClockBreak();
    await applyPresence("active");
    try { localStorage.removeItem(`lunch_until:${userId}`); } catch { /* */ }
    setOpen(false);
  };
  const clockOut = () => { clockOutAndFill(); setOpen(false); };

  const item = `w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left text-xs ${dark ? "text-slate-200 hover:bg-white/5" : "text-slate-700 hover:bg-slate-50"}`;

  if (!clockIn) {
    return (
      <button
        ref={anchorRef}
        type="button"
        onClick={() => handleClockIn()}
        title="Clock in"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
          dark ? "bg-[var(--color-surface-raised)] text-slate-300 hover:text-slate-100" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
        }`}
      >
        <Play className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Clock in</span>
      </button>
    );
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={onBreak ? "On lunch" : "Clocked in"}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
          onBreak
            ? dark ? "bg-orange-500/20 text-orange-200" : "bg-orange-100 text-orange-700"
            : dark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-100 text-emerald-700"
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${onBreak ? "bg-orange-400" : "bg-emerald-500"}`} />
        <span className="tabular-nums">{clockedElapsed() || "0m"}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} width={208} dark={dark}>
        {clockIn.description?.trim() && (
          <p className={`px-2.5 py-1.5 text-xs truncate ${dark ? "text-slate-400" : "text-slate-500"}`}>{clockIn.description}</p>
        )}
        {onBreak ? (
          <button type="button" onClick={backFromLunch} className={item}><Undo2 className="w-3.5 h-3.5" /> Back from lunch</button>
        ) : (
          <button type="button" onClick={goLunch} className={item}><Coffee className="w-3.5 h-3.5" /> On lunch · {lunchPaid ? "paid" : "unpaid"}</button>
        )}
        <button type="button" onClick={clockOut} className={item}><LogOut className="w-3.5 h-3.5" /> Clock out</button>
      </Popover>
    </>
  );
}
