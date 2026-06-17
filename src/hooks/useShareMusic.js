import { useEffect, useState } from "react";
import { getJitsiApi, subscribeJitsiApi } from "../lib/jitsiBridge";

// Drives the "Share music" affordance.
//
// `available` reflects whether a Jitsi instance is alive (i.e. the
// user is in the room call). Without it, sharing has nowhere to go.
//
// `sharing` reflects whether THIS user is currently screen-sharing.
// We mirror Jitsi's `screenSharingStatusChanged` event because Jitsi
// is the source of truth — the user could have toggled share via
// Jitsi's own toolbar.
//
// `share()` calls Jitsi's toggleShareScreen, which surfaces the
// browser's native picker. On Chrome/Edge that includes the
// "Share tab audio" checkbox — we tell the user to check it. We do
// NOT capture media ourselves; piping an external MediaStream into
// Jitsi via External API isn't supported, and Jitsi's built-in path
// handles codec negotiation + audio mixing for free.
export function useShareMusic() {
  const [api, setApi] = useState(getJitsiApi);
  const [sharing, setSharing] = useState(false);

  useEffect(() => subscribeJitsiApi(setApi), []);

  useEffect(() => {
    if (!api) {
      setSharing(false);
      return;
    }
    const onChange = (evt) => {
      // Jitsi fires this for every participant; we only care about
      // local. The "on" flag tells us if WE are sharing.
      if (typeof evt?.on === "boolean") setSharing(evt.on);
    };
    api.addListener("screenSharingStatusChanged", onChange);
    return () => {
      try { api.removeListener("screenSharingStatusChanged", onChange); } catch { /* */ }
    };
  }, [api]);

  const available = !!api;

  function share() {
    const a = getJitsiApi();
    if (!a) return;
    try { a.executeCommand("toggleShareScreen"); } catch { /* */ }
  }

  return { available, sharing, share, stop: share }; // toggleShareScreen is its own stop
}
