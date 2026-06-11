import { useEffect } from "react";

export function useTimerTick({ isRunning, userId, endsAtMsRef, setSecondsLeft }) {
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setSecondsLeft((s) => {
        if (userId && endsAtMsRef.current) {
          return Math.max(0, Math.ceil((endsAtMsRef.current - Date.now()) / 1000));
        }
        return s <= 1 ? 0 : s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning, userId, endsAtMsRef, setSecondsLeft]);
}
