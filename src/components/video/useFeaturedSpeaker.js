import { useEffect, useRef, useState } from "react";

// Tracks the "featured" active speaker with a DECAY, so a brief pause mid-
// sentence doesn't drop the focus off them (the jarring snap you see on the
// kiosk, and the reason a paused speaker vanishes). Pass LiveKit's ordered
// useSpeakingParticipants() list; returns the identity to feature, or null.
//
//   • Someone speaking → they're featured immediately (a louder/newer speaker
//     takes over right away — that responsiveness is what you want).
//   • Everyone goes quiet → the last speaker stays featured for `decayMs`. If
//     they (or anyone) resume within that window, the timer is cancelled and the
//     feature holds. Only after a sustained silence does it release to null, so
//     callers fall back to their default framing (first tile / even grid).
//
// `hold: true` — never release on silence: keep the last speaker featured
// indefinitely (until someone else speaks). Used by Spotlight so the big tile
// holds on whoever spoke last instead of snapping back to the first tile.
//
// Net effect: focus follows the conversation but rides through the natural gaps,
// the way Meet/Zoom do.
export function useFeaturedSpeaker(speaking, { decayMs = 2500, hold = false } = {}) {
  const [featured, setFeatured] = useState(null);
  const timerRef = useRef(null);
  const topId = speaking && speaking.length ? speaking[0]?.identity || null : null;

  useEffect(() => {
    if (topId) {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      setFeatured((cur) => (cur === topId ? cur : topId));
      return;
    }
    // Nobody speaking right now. When holding, keep the last speaker (no release).
    if (hold) return;
    // Otherwise hold the current feature, then release after the decay window if
    // it's still quiet. Don't reset the timer on unrelated re-renders — only arm
    // it once per silence.
    if (!timerRef.current) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setFeatured(null);
      }, decayMs);
    }
  }, [topId, decayMs, hold]);

  // Cancel a pending release on unmount.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return featured;
}
