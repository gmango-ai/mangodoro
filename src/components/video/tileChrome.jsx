// Shared participant-tile chrome + grid helpers for BOTH call surfaces — the
// member call (LiveKitCall.jsx) and the device kiosk (DevicePortalCall.jsx).
// These were forked between the two, which is how the kiosk drifted (e.g. a
// camera-off person showed LiveKit's blank gray silhouette on the kiosk while
// the member call had a proper avatar). Everything here is presentational and
// CONTEXT-FREE — the kiosk renders outside TeamProvider, so nothing may reach
// for useTeam/pin/hand-raise context; callers pass what they've resolved as
// props (e.g. the member call resolves the profile photo from its roster and
// passes `avatarSrc`; the kiosk has no roster and passes null → initials).
import { useEffect, useState } from "react";
import { ParticipantTile, useIsSpeaking, useConnectionQualityIndicator } from "@livekit/components-react";
import { Track, ConnectionQuality } from "livekit-client";
import { MicOff } from "lucide-react";
import { bestGrid } from "./layoutSolver";

// Stable per-track key: identity + source. Identical on both surfaces so they
// address tiles the same way (focus keys, dedupe, ranking).
export function refKey(t) {
  return t ? `${t.participant?.identity || ""}:${t.source}` : "";
}

// A soft, deterministic per-person gradient for the camera-off initials avatar.
export function avatarGradient(id) {
  let h = 0;
  for (let i = 0; i < (id || "").length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `linear-gradient(135deg, hsl(${hue} 52% 48%), hsl(${(hue + 38) % 360} 55% 34%))`;
}

// First+last initial for an initials avatar / fallback.
export function getInitials(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Camera-off overlay: the person's profile photo over a soft gradient, with a
// single-initial avatar as the fallback (guest, no photo, or a load error).
// Covers LiveKit's default gray silhouette. `avatarSrc` is resolved by the
// caller (null → initials only). Own its own image-error state.
export function CameraOffAvatar({ participant, avatarSrc, dispName }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [avatarSrc]);
  const name = dispName || participant?.name || participant?.identity || "Guest";
  const initial = (name.trim()[0] || "?").toUpperCase();
  return (
    <div
      className="absolute inset-0 z-[1] flex items-center justify-center"
      style={{ background: "radial-gradient(circle at 50% 36%, #1b2840, #0b1220)" }}
    >
      <div
        className="rounded-full flex items-center justify-center overflow-hidden text-white font-semibold ring-1 ring-white/10 shadow-lg"
        style={{
          width: "clamp(44px, 26%, 116px)",
          aspectRatio: "1",
          fontSize: "clamp(16px, 4vw, 40px)",
          background: avatarGradient(participant?.identity || name),
        }}
      >
        {avatarSrc && !failed ? (
          <img src={avatarSrc} alt="" className="w-full h-full object-cover" onError={() => setFailed(true)} />
        ) : (
          initial
        )}
      </div>
    </div>
  );
}

// Speaking ring — an inset glow so it never shifts layout. Matches the tile's
// rounding; pulses softly while the person is talking.
export function SpeakingRing() {
  return (
    <div
      className="absolute inset-0 z-20 pointer-events-none animate-pulse"
      style={{
        borderRadius: "var(--lk-border-radius, 0.75rem)",
        boxShadow: "inset 0 0 0 3px rgba(16,185,129,0.95), 0 0 14px -2px rgba(16,185,129,0.6)",
      }}
    />
  );
}

// Name + mute pill, glassy bottom-left (replaces LiveKit's metadata bar, which
// the camera-off overlay would otherwise cover). `weak` shows a connection dot
// (amber, or red when `lost`).
export function TileNamePill({ dispName, isLocal, micOff, weak, lost }) {
  return (
    <div className="absolute bottom-1.5 left-1.5 z-10 inline-flex items-center gap-1 max-w-[calc(100%-12px)] px-2 py-0.5 rounded-md bg-black/55 backdrop-blur-sm pointer-events-none">
      {micOff && <MicOff className="w-3 h-3 text-rose-300 shrink-0" />}
      <span className="text-[11px] font-medium text-white truncate">
        {dispName}{isLocal ? " (You)" : ""}
      </span>
      {weak && (
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${lost ? "bg-red-500" : "bg-amber-400"}`}
          title={lost ? "Connection lost" : "Weak connection"}
        />
      )}
    </div>
  );
}

// Largest tile count that still fits at a comfortable minimum width — the cap
// before the grid spills into the audience row. Walks the same bestGrid the
// grid uses so the threshold matches what would actually render.
export function capFor(w, h, minW = 130, aspect = 16 / 9, gap = 8) {
  if (w <= 0 || h <= 0) return 99;
  let best = 1;
  for (let n = 1; n <= 60; n++) {
    const { tileW } = bestGrid(n, w, h, aspect, gap);
    if (tileW >= minW) best = n; else break;
  }
  return best;
}

// Order tiles so the grid keeps who matters when it overflows: screen share and
// pins first, then featured / active speakers, then cameras-on, then cameras-off.
// Stable within a tier (original order) so tiles don't shuffle every render —
// only a new speaker or pin promotes into view.
export function rankTiles(tracks, { featuredId, speaking, globalPinId, pinnedTrackKey } = {}) {
  const speakingIds = new Set((speaking || []).map((p) => p.identity));
  const score = (t) => {
    if (t.source === Track.Source.ScreenShare) return 0;
    const id = t.participant?.identity;
    if (globalPinId && id === globalPinId) return 1;
    if (pinnedTrackKey && refKey(t) === pinnedTrackKey) return 2;
    if (id && (id === featuredId || speakingIds.has(id))) return 3;
    const camOn = !!t.publication && !t.publication.isMuted;
    return camOn ? 4 : 5;
  };
  return tracks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => score(a.t) - score(b.t) || a.i - b.i)
    .map((x) => x.t);
}

// One overflow person — initials avatar with a speaking pulse. Speaking promotes
// them back into the grid (rankTiles), so the pulse here is the "they're talking,
// watch them pop up" cue.
export function AudienceChip({ participant }) {
  const isSpeaking = useIsSpeaking(participant);
  const name = participant?.name || participant?.identity || "Guest";
  const initial = (name.trim()[0] || "?").toUpperCase();
  return (
    <div className="flex flex-col items-center gap-1 w-14 shrink-0" title={name}>
      <div className={`relative w-11 h-11 rounded-full flex items-center justify-center text-white font-semibold text-sm bg-slate-700 ${isSpeaking ? "ring-2 ring-emerald-400" : "ring-1 ring-white/15"}`}>
        {initial}
        {isSpeaking && <span className="absolute inset-0 rounded-full ring-2 ring-emerald-400 animate-ping pointer-events-none" />}
      </div>
      <span className="text-[10px] text-slate-300 truncate max-w-full">{name}</span>
    </div>
  );
}

// The audience row — overflow participants past the grid cap, as a scrollable
// strip of chips.
export function AudienceRow({ tracks }) {
  return (
    <div className="shrink-0 h-[80px] flex items-center gap-2 px-3 overflow-x-auto bg-black/30 border-t border-white/10">
      <span className="text-[10px] font-bold uppercase tracking-wider text-white/50 shrink-0 mr-1">
        +{tracks.length}
      </span>
      {tracks.map((t) => <AudienceChip key={refKey(t)} participant={t.participant} />)}
    </div>
  );
}

// A minimal, context-free participant tile for the kiosk: the LiveKit tile plus
// the shared chrome (name pill, camera-off avatar, speaking ring). No pin /
// expand / hand-raise / self-view controls — a wall display is passive, and
// those depend on member-only React context the kiosk doesn't provide. The
// kiosk has no roster, so the camera-off avatar falls back to initials. Owns
// its per-tile subscriptions (speaking, connection quality) so it re-renders
// on those alone.
export function KioskParticipantTile({ trackRef }) {
  const participant = trackRef?.participant;
  const isSpeaking = useIsSpeaking(participant);
  const { quality } = useConnectionQualityIndicator({ participant });
  const lost = quality === ConnectionQuality.Lost;
  const weak = lost || quality === ConnectionQuality.Poor;
  const camOff = trackRef?.source === Track.Source.Camera && (!trackRef?.publication || trackRef.publication.isMuted);
  const micOff = !!participant && participant.isMicrophoneEnabled === false;
  const dispName = participant?.name || participant?.identity || "Guest";
  return (
    <div className="group relative flex w-full h-full rounded-xl overflow-hidden ring-1 ring-white/[0.07]">
      <ParticipantTile trackRef={trackRef} style={{ flex: 1, minWidth: 0, minHeight: 0 }} />
      <TileNamePill dispName={dispName} isLocal={participant?.isLocal} micOff={micOff} weak={weak} lost={lost} />
      {camOff && <CameraOffAvatar participant={participant} avatarSrc={null} dispName={dispName} />}
      {isSpeaking && <SpeakingRing />}
    </div>
  );
}
