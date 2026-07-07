import { useEffect, useRef } from "react";
import { useConnectionState, useParticipants, useSpeakingParticipants } from "@livekit/components-react";
import { registerDriveControls, reportDriveCall, resetDriveCall } from "./driveBridge";

// Mirrors the live call into the drive-mode bridge and registers the mic
// toggle. Called once from ConferenceLayout (inside the LiveKit room tree),
// which owns micMuted/onToggleMic. Reports are change-detected in the bridge,
// so speaking churn costs nothing when no drive screen is subscribed.
export function useDriveBridge({ micMuted, onToggleMic }) {
  const connState = useConnectionState();
  const participants = useParticipants();
  const speaking = useSpeakingParticipants();

  const toggleRef = useRef(onToggleMic);
  toggleRef.current = onToggleMic;
  useEffect(() => {
    registerDriveControls({ toggleMic: () => toggleRef.current?.() });
    return () => {
      registerDriveControls(null);
      resetDriveCall();
    };
  }, []);

  // Prefer a remote speaker — while you talk you don't need to be told.
  const speaker = speaking.find((p) => !p.isLocal) || speaking[0] || null;
  const speakerName = !speaker ? "" : speaker.isLocal ? "You" : speaker.name || speaker.identity || "Someone";

  useEffect(() => {
    reportDriveCall({
      connected: connState === "connected",
      micMuted: !!micMuted,
      speakerName,
      participantCount: participants.length,
    });
  }, [connState, micMuted, speakerName, participants.length]);
}
