import { useTheme } from "../../context/ThemeContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { usePomodoro } from "../../pomodoro/PomodoroContext";
import { MODE_LABELS } from "../../pomodoro/constants";
import { PomodoroConfirmPrompts } from "./PomodoroPipParts";

// Renders the confirm-before-discard prompt when a controller action
// (mode switch / reset / duration change / alt break) would discard
// in-progress work. The label changes based on what's being confirmed
// and whether others are in the sync session.
export default function PendingActionBanner() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { pendingAction, confirmPendingAction, cancelPendingAction, isSynced } = usePomodoro();
  useSyncSession();

  if (!pendingAction) return null;
  const syncSuffix = isSynced ? " for everyone in this session." : ".";

  let outboundPrompt = "";
  let outboundConfirmLabel = "Confirm";
  if (pendingAction.type === "switchMode") {
    outboundPrompt = `Switch to ${MODE_LABELS[pendingAction.newMode]}? This will stop the current timer${syncSuffix}`;
    outboundConfirmLabel = "Switch";
  } else if (pendingAction.type === "reset") {
    outboundPrompt = `Reset the timer? Current progress will be lost${syncSuffix}`;
    outboundConfirmLabel = "Reset";
  } else if (pendingAction.type === "applyCustomDuration") {
    outboundPrompt = `Change the duration? This will stop the current timer${syncSuffix}`;
    outboundConfirmLabel = "Apply";
  } else if (pendingAction.type === "switchAlternateBreak") {
    outboundPrompt = `Switch to ${MODE_LABELS[pendingAction.newMode]}? Your focus streak will reset${syncSuffix}`;
    outboundConfirmLabel = "Switch";
  }

  return (
    <PomodoroConfirmPrompts
      dark={dark}
      pendingAction={pendingAction}
      outboundPrompt={outboundPrompt}
      outboundConfirmLabel={outboundConfirmLabel}
      onConfirmOutbound={confirmPendingAction}
      onCancelOutbound={cancelPendingAction}
    />
  );
}
