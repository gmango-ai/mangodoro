import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "../../context/ThemeContext";
import { resolveVideoProvider, VIDEO } from "../../lib/videoProvider";
import { track, isMobileClient } from "../../lib/analytics";
import JitsiCall from "./JitsiCall";
import LiveKitCall from "./LiveKitCall";
import EmoteOverlay from "../emotes/EmoteOverlay";

// Provider dispatcher for a single room's call.
//
// Resolves which provider this room is assigned (Jitsi or LiveKit — see
// videoProvider.js for the per-room A/B split), renders the matching
// provider component, and owns the cross-provider concerns:
//   • the shared "couldn't load the call" error UI
//   • the EmoteOverlay (reactions float over either provider)
//   • PostHog instrumentation — attempt / connected / failed / ended,
//     tagged with provider + platform + duration, which is the whole
//     point of running the experiment.
//
// roomId          — the Mangodoro room id (stable for this component's
//                   life; PersistentVideoCall keys us by roomId).
// displayName     — what other participants see.
// onJoined/onLeft — fired when the local participant joins / leaves.
export default function VideoCall({ roomId, displayName, compact, publish, choices, onJoinIn, onJoined, onLeft }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [error, setError] = useState(null);

  const provider = useMemo(() => resolveVideoProvider(roomId), [roomId]);

  // Analytics lifecycle — refs so we don't re-render on timing bookkeeping.
  const attemptAtRef = useRef(0);
  const connectedAtRef = useRef(0);
  // The emote overlay owns the reaction channel + particle fountain; the
  // LiveKit toolbar's reaction buttons drive it through this stable API
  // (start = tap-or-hold-to-charge-burst; subscribeCharge = glow updates).
  const emoteRef = useRef(null);
  const emoteApiRef = useRef(null);
  if (!emoteApiRef.current) {
    emoteApiRef.current = {
      start: (glyph, ev, key) => emoteRef.current?.start?.(glyph, ev, key),
      pick: (glyph) => emoteRef.current?.pick?.(glyph),
      subscribeCharge: (cb) => emoteRef.current?.subscribeCharge?.(cb) ?? (() => {}),
      subscribeRecents: (cb) => emoteRef.current?.subscribeRecents?.(cb) ?? (() => {}),
    };
  }

  useEffect(() => {
    if (!roomId) return;
    const isMobile = isMobileClient();
    attemptAtRef.current = Date.now();
    connectedAtRef.current = 0;
    setError(null);
    track("video_call_attempt", { provider, room_id: roomId, is_mobile: isMobile });

    return () => {
      // Only count a "session" if we actually connected.
      if (connectedAtRef.current) {
        track("video_call_ended", {
          provider,
          room_id: roomId,
          is_mobile: isMobile,
          duration_s: Math.round((Date.now() - connectedAtRef.current) / 1000),
        });
      }
    };
  }, [roomId, provider]);

  const handleJoined = () => {
    if (!connectedAtRef.current) {
      connectedAtRef.current = Date.now();
      track("video_call_connected", {
        provider,
        room_id: roomId,
        is_mobile: isMobileClient(),
        ms_to_connect: attemptAtRef.current ? Date.now() - attemptAtRef.current : null,
      });
    }
    onJoined?.();
  };

  const handleError = (message) => {
    setError(message);
    track("video_call_failed", {
      provider,
      room_id: roomId,
      is_mobile: isMobileClient(),
      error: message,
    });
  };

  const ProviderCall = provider === VIDEO.LIVEKIT ? LiveKitCall : JitsiCall;

  return (
    <div className="relative w-full h-full">
      {error ? (
        <div className={`w-full h-full rounded-xl border flex items-center justify-center text-center p-6 ${
          dark ? "border-[var(--color-border)] bg-[var(--color-surface)] text-slate-300" : "border-slate-200 bg-white text-slate-600"
        }`}>
          <div>
            <p className="text-sm font-semibold mb-1">Couldn't load the call</p>
            <p className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>{error}</p>
          </div>
        </div>
      ) : (
        <>
          <ProviderCall
            roomId={roomId}
            displayName={displayName}
            compact={compact}
            publish={publish}
            choices={choices}
            onJoinIn={onJoinIn}
            emote={emoteApiRef.current}
            onJoined={handleJoined}
            onLeft={onLeft}
            onError={handleError}
          />
          {/* Reaction particles, scoped by roomId so everyone sees each
              other's emotes over the video. On LiveKit the trigger lives in
              the call toolbar (barPosition hidden); Jitsi keeps the floating
              bar since we can't inject into its iframe toolbar. */}
          {roomId && (
            <EmoteOverlay
              ref={emoteRef}
              channelKey={`room:${roomId}`}
              barPosition={provider === VIDEO.LIVEKIT ? "hidden" : "right-center"}
              senderName={displayName}
            />
          )}
        </>
      )}
    </div>
  );
}
