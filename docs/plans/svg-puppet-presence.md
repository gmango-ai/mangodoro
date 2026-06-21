# SVG Puppet Presence — "video calls without video"

**Status:** 💡 Idea / deferred. **Not building now.** Video (the Jitsi↔LiveKit
A/B, see `video-provider-ab-test`) is the primary long-term path. This is a
**future easter-egg / opt-in mode**, captured here so the idea + decisions
aren't lost.

**Date:** 2026-06-20. **Decision owner:** Jacob.

---

## The concept

Instead of a webcam video stream, each person is represented by a **customizable
2D character** — Muppet-like, built from **SVG parts**. The character's mouth
moves with your actual voice and (optionally) head/brows/blink track your webcam,
so it *feels* like a live call — presence, attention, "they're talking" — **without
ever sending video.** The puppets stand in the office rooms we already built; the
floor becomes a little stage.

It's a **presence call, not a high-fidelity face call** — and that lower-pressure,
no-"am-I-presentable" vibe is arguably *better* for all-day focus-coworking than
video, not a downgrade.

## Why 2D SVG (the chosen direction)

- **Light on mobile** — no WebGL/3D render or heavy GPU load; the mobile-compute
  risk that kills the 3D/VRM version mostly goes away.
- **Customization = swap SVG parts** — body/fur color, eyes, mouth, nose, brows,
  hair, hats/accessories. Very "modular felt puppet." Config is a small JSON per
  user (extend the existing user avatar/`user_settings`).
- **Muppet aesthetic is forgiving** — crude/exaggerated reads as *charming*, not
  broken. We need almost none of the tracking fidelity a realistic avatar demands.

(3D/three.js was considered for "sits in the room" depth but rejected for now on
mobile cost. Revisit only if 2D feels flat in the spatial office.)

## Expressiveness — progressive tiers (this is also the mobile answer)

| Tier | Input | Drives | Device load |
|---|---|---|---|
| **0 — Audio-reactive** | mic amplitude (RMS) | jaw open/close, idle blink + sway | ~none; any phone, no camera |
| **1 — Webcam expression** | MediaPipe FaceLandmarker | head pose, blink, brows, smile | moderate; opt-in |
| **2 — Body/gesture** | MediaPipe Pose/Holistic | lean, nod, hand waves | heavy; desktop opt-in |

**Tier 0 alone already feels alive** ("puppet talks when I talk") and costs
nothing — so mobile gets a working charming presence with zero tracking; webcam is
pure progressive enhancement. Lip-sync is **derived locally from the received audio
amplitude** — we do *not* send mouth data.

## Architecture

- **Render:** layered SVG groups animated via CSS/JS transforms; mouth via path
  morph or swapping a few mouth-shape ("viseme") paths. Consider Rive or Live2D as
  off-the-shelf 2D-rig options vs hand-rolled SVG (open question below).
- **Transport (cheap):** motion params are tiny (~tens of bytes/frame). Broadcast
  them over the **Supabase Realtime channel we already use for emotes**
  (`room:roomId`), *not* the media SFU. Everyone renders everyone else's puppet
  locally.
- **Audio (the only irreducible cost):** keep on the existing SFU (LiveKit/Jitsi
  **audio-only** is cheap). The whole "video call" collapses to *cheap audio +
  free-ish puppet motion broadcast + local SVG render*.
- **Placement:** puppets occupy the office room view (reuse `RoomVideoStage`'s slot
  / the room canvas).
- **Customization storage:** per-user puppet config JSON, persisted like the
  current avatar.

## Cost rationale (why this is interesting)

- **Bandwidth: ~10–100× cheaper** than video (motion data ~5–30 kbps vs video
  ~300–1500 kbps).
- **Per-minute SFU billing doesn't drop** *unless* the visual layer leaves the
  media server — which this design does (motion over Supabase Realtime, only audio
  on the SFU). So on a self-host or audio-only plan it's a big real saving.
- **Cost shifts from server bandwidth → client compute**, but 2D SVG is light, so
  the mobile penalty is small (the reason we picked 2D over 3D).

## The actual hard part

**It's the art, not the code.** A cohesive, customizable SVG puppet kit (a base
rig + a library of swappable parts that all look good together) needs an artist or
a very disciplined asset system. The engineering (MediaPipe + SVG rig + Realtime
broadcast) is tractable; the bottleneck and the differentiator is a charming,
consistent parts library.

## Phasing (when/if we pick this up)

- **Phase 0 — proof:** one base SVG puppet in a room, jaw driven by *your own* mic
  RMS, idle blink/sway. No networking, no camera. Answers the only two questions
  that matter: does it *feel alive*, and is it smooth on a phone?
- **Phase 1:** MediaPipe FaceLandmarker → head pose / blink / brow / smile (opt-in
  webcam).
- **Phase 2:** broadcast motion over Supabase Realtime; render remote players'
  puppets in the room → multiplayer "call."
- **Phase 3:** SVG character creator (parts + colors), persisted per user.
- **Phase 4:** audio via LiveKit/Jitsi audio-only; optional body/gesture (Pose).

## Open questions / decisions to revisit

- **Rig tech:** hand-rolled SVG (CSS/JS transforms + path morph) vs **Rive** vs
  **Live2D**. Rive/Live2D give real rigging tooling but add a dependency + asset
  workflow.
- **Mouth model:** simple jaw-open amplitude vs a small viseme set for better
  lip-sync.
- **Coexistence with video:** is this a per-room mode, a per-user toggle, or a
  separate "avatar room" type? How do video and puppet participants share a room
  (or do they)?
- **Audio amplitude source:** need the remote audio locally to compute RMS for
  lip-sync — straightforward via Web Audio on the WebRTC audio track.
- **Asset sourcing:** who builds the puppet parts kit, and how modular (fixed
  anchor points so any mouth fits any face).

## Dependencies / relationship to other work

- Rides on **whatever audio transport wins** the Jitsi↔LiveKit A/B
  (`video-provider-ab-test`) — not blocking, and benefits from audio-only being
  cheap on every provider.
- Reuses the **office room floor** and the **Supabase Realtime emote/presence
  channel** already in place.
