import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { JITSI_DOMAIN, fetchVideoCallToken, loadJitsiExternalApi, roomNameForRoom } from "../../lib/jitsi";
import { registerJitsiApi, unregisterJitsiApi } from "../../lib/jitsiBridge";
import EmoteOverlay from "../emotes/EmoteOverlay";

// Embeds a JitsiMeetExternalAPI iframe into the surrounding div.
// Mounts the iframe on the first render, calls `onJoined` /
// `onLeft` so the parent can update its presence state, and cleans
// up `api.dispose()` on unmount so the iframe doesn't keep the
// camera + mic active after navigating away.
//
// Both audio and video start unmuted by default — this is the
// "feel like you're in the office" mode the team picked. Each user
// can mute / unmute via Jitsi's own toolbar inside the iframe.
//
// roomId          — the Mangodoro room id; used to derive a stable,
//                   per-room Jitsi room name.
// displayName     — what other participants see in the call.
// onJoined/onLeft — fired when the local participant joins / leaves.
export default function VideoCall({ roomId, displayName, onJoined, onLeft }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { session } = useApp();
  const containerRef = useRef(null);
  const apiRef = useRef(null);
  const [error, setError] = useState(null);

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
            // Hide the Jitsi welcome/branding inside the embed —
            // we own the chrome around it.
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
        // TimerWidget's "Share music" button). Unregister happens in
        // the cleanup below so a brief gap during HMR reload doesn't
        // leave a stale reference live.
        registerJitsiApi(api);

        // Log every Jitsi lifecycle event we care about so we can
        // see in the console why the embed isn't reaching "joined"
        // when something goes sideways. Cheap to keep; surfacing
        // these helped diagnose JaaS bootstrap issues.
        const log = (evt) => (data) =>
          // eslint-disable-next-line no-console
          console.info(`[Jitsi] ${evt}`, data ?? "");
        api.addListener("readyToClose", log("readyToClose"));
        api.addListener("errorOccurred", (data) => {
          log("errorOccurred")(data);
          if (!cancelled && data) {
            const err = data.error;
            setError(
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

        // "We got past auth and into the conference." We let the Jitsi
        // iframe show its own connecting state rather than overlaying our
        // own — our overlay used to linger over an already-live feed.
        api.addListener("videoConferenceJoined", (data) => {
          log("videoConferenceJoined")(data);
          if (!cancelled) onJoined?.();
        });
        api.addListener("videoConferenceLeft", (data) => {
          log("videoConferenceLeft")(data);
          if (!cancelled) onLeft?.();
        });
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || "Could not load the video call");
        }
      }
    })();

    return () => {
      cancelled = true;
      unregisterJitsiApi();
      try { apiRef.current?.dispose(); } catch { /* */ }
      apiRef.current = null;
    };
    // We deliberately don't re-init when displayName changes —
    // disposing + re-creating the iframe would drop the user from the
    // call. Display name updates flow through api.executeCommand
    // ("displayName", ...) below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Best-effort teardown on tab close. The unmount cleanup above does
  // not reliably run when a tab/window is closed, so a closed tab could
  // otherwise keep the media bridge connected until the server times the
  // peer out. pagehide is the most dependable unload signal (fires on
  // mobile + bfcache where beforeunload often doesn't).
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
          <div
            ref={containerRef}
            className="w-full h-full rounded-xl overflow-hidden"
            aria-label="Video call"
          />
          {/* Floating emoji-reaction bar + particles. Scope by roomId
              so everyone in the same room (regardless of which Jitsi
              tile they're staring at) sees each other's emotes drift
              up over the video. Pinned to the right edge so the bar
              clears Jitsi's own bottom control toolbar. */}
          {roomId && (
            <EmoteOverlay channelKey={`room:${roomId}`} barPosition="right-center" />
          )}
        </>
      )}
    </div>
  );
}
