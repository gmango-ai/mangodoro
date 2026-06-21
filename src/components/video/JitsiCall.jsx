import { useEffect, useRef } from "react";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { JITSI_DOMAIN, fetchVideoCallToken, loadJitsiExternalApi, roomNameForRoom } from "../../lib/jitsi";
import { registerJitsiApi, unregisterJitsiApi } from "../../lib/jitsiBridge";

// Jitsi provider: embeds a JitsiMeetExternalAPI iframe into the
// surrounding div. Extracted verbatim from the old VideoCall so the
// dispatcher (VideoCall.jsx) can swap it for <LiveKitCall> per room.
//
// Errors are reported via onError (the dispatcher owns the shared error
// UI + the analytics "failed" event); this component just renders the
// iframe container.
export default function JitsiCall({ roomId, displayName, onJoined, onLeft, onError }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { session } = useApp();
  const containerRef = useRef(null);
  const apiRef = useRef(null);

  useEffect(() => {
    if (!roomId || !containerRef.current) return;
    let cancelled = false;

    (async () => {
      try {
        const Ctor = await loadJitsiExternalApi();
        if (cancelled || !containerRef.current) return;

        // Public meet.jit.si returns null. JaaS path mints via the
        // `mint-jaas-jwt` Supabase edge function (cached per-tab).
        const jwt = await fetchVideoCallToken(
          roomNameForRoom(roomId),
          session?.user?.id,
          displayName,
        );

        const opts = {
          roomName: roomNameForRoom(roomId),
          parentNode: containerRef.current,
          width: "100%",
          height: "100%",
          userInfo: {
            displayName: displayName || "Mangodoro guest",
            email: session?.user?.email || undefined,
          },
          configOverwrite: {
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            disableModeratorIndicator: true,
            prejoinPageEnabled: false,
            hideConferenceSubject: true,
            hideConferenceTimer: false,
            disableProfile: true,
          },
          interfaceConfigOverwrite: {
            DEFAULT_BACKGROUND: dark ? "#0f172a" : "#f8fafc",
            SHOW_JITSI_WATERMARK: false,
            SHOW_BRAND_WATERMARK: false,
            TOOLBAR_BUTTONS: [
              "microphone", "camera", "desktop", "fullscreen",
              "fodeviceselection", "hangup", "chat", "raisehand",
              "videoquality", "filmstrip", "settings", "tileview",
            ],
          },
          ...(jwt ? { jwt } : {}),
        };

        const api = new Ctor(JITSI_DOMAIN, opts);
        apiRef.current = api;
        // Publish the api to module-level subscribers (e.g. the
        // TimerWidget's "Share music" button).
        registerJitsiApi(api);

        const log = (evt) => (data) =>
          // eslint-disable-next-line no-console
          console.info(`[Jitsi] ${evt}`, data ?? "");
        api.addListener("readyToClose", log("readyToClose"));
        api.addListener("errorOccurred", (data) => {
          log("errorOccurred")(data);
          if (!cancelled && data) {
            const err = data.error;
            onError?.(
              data.message ||
              (typeof err === "string" ? err : err?.message) ||
              err?.name ||
              data.type ||
              "Jitsi error"
            );
          }
        });
        api.addListener("participantJoined", log("participantJoined"));
        api.addListener("participantLeft", log("participantLeft"));
        api.addListener("knockingParticipant", log("knockingParticipant"));
        api.addListener("dataChannelOpened", log("dataChannelOpened"));

        api.addListener("videoConferenceJoined", (data) => {
          log("videoConferenceJoined")(data);
          if (!cancelled) onJoined?.();
        });
        api.addListener("videoConferenceLeft", (data) => {
          log("videoConferenceLeft")(data);
          if (!cancelled) onLeft?.();
        });
      } catch (e) {
        if (!cancelled) onError?.(e?.message || "Could not load the video call");
      }
    })();

    return () => {
      cancelled = true;
      unregisterJitsiApi();
      try { apiRef.current?.dispose(); } catch { /* */ }
      apiRef.current = null;
    };
    // Don't re-init on displayName change — that would drop the user.
    // Name updates flow through executeCommand below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Best-effort teardown on tab close (unmount cleanup doesn't reliably
  // run on mobile / bfcache; pagehide does).
  useEffect(() => {
    const onPageHide = () => {
      try { apiRef.current?.dispose(); } catch { /* */ }
      apiRef.current = null;
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  // Propagate display-name changes without tearing down the iframe.
  useEffect(() => {
    if (apiRef.current && displayName) {
      try { apiRef.current.executeCommand("displayName", displayName); } catch { /* */ }
    }
  }, [displayName]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full rounded-xl overflow-hidden"
      aria-label="Video call"
    />
  );
}
