import { useEffect, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  GridLayout,
  ParticipantTile,
  TrackToggle,
  MediaDeviceMenu,
  DisconnectButton,
  useTracks,
  useParticipants,
  useLocalParticipant,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";
import { Eye, Video, Smile, PhoneOff } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import EmoteBar from "../emotes/EmoteBar";
import { LIVEKIT_URL, fetchLiveKitToken, liveKitRoomName } from "../../lib/livekit";

// LiveKit provider — the A/B counterpart to <JitsiCall>.
//
// We compose LiveKit's primitives (GridLayout + ParticipantTile +
// RoomAudioRenderer + ControlBar) rather than the all-in-one
// <VideoConference> so the call matches the app and adapts to context:
//   • compact (PiP) → just the grid, no control bar (the app frames PiP).
//   • publish=false (spectate) → connect subscribe-only: you see/hear
//     everyone without publishing your own camera/mic.
//
// We always connect subscribe-only and then enable camera/mic via the
// local-participant API (PublishController) so spectate ↔ join can flip
// live without reconnecting.

function PublishController({ publish, choices }) {
  const { localParticipant } = useLocalParticipant();
  useEffect(() => {
    if (!localParticipant) return;
    // Tag our role so every client can render spectators as a name list
    // instead of giving them a (camera-off) tile in the grid.
    localParticipant.setAttributes({ role: publish ? "publisher" : "spectator" }).catch(() => { /* */ });
    const wantVideo = publish && (choices ? choices.videoEnabled !== false : true);
    const wantAudio = publish && (choices ? choices.audioEnabled !== false : true);
    localParticipant
      .setCameraEnabled(wantVideo, choices?.videoDeviceId ? { deviceId: choices.videoDeviceId } : undefined)
      .catch(() => { /* device denied/unavailable — stay subscribe-only */ });
    localParticipant
      .setMicrophoneEnabled(wantAudio, choices?.audioDeviceId ? { deviceId: choices.audioDeviceId } : undefined)
      .catch(() => { /* */ });
  }, [localParticipant, publish, choices]);
  return null;
}

// Custom control bar (replaces LiveKit's <ControlBar>) so reactions can sit
// between device selection and Leave, and so it collapses to icon-only when
// the tile is narrow — keeping a small video usable rather than forcing a
// large minimum size.
//
// The reactions popup (Google-Meet style) is centered on the bar FRAME, not
// on the off-center smiley button — so it stays put regardless of how many
// controls flank it.
function CallControlBar({ publish, tight, emote }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [reactionsOpen, setReactionsOpen] = useState(false);
  // Mirror the overlay's charge + recents so the shared <EmoteBar> shows the
  // same glow and custom emojis here without re-rendering the whole call.
  const [charge, setCharge] = useState(null);
  const [recents, setRecents] = useState([]);
  useEffect(() => emote?.subscribeCharge?.(setCharge), [emote]);
  useEffect(() => emote?.subscribeRecents?.(setRecents), [emote]);
  return (
    <div className="relative flex items-center justify-center flex-wrap gap-1.5 px-2 py-2">
      {reactionsOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setReactionsOpen(false)} />
          <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20">
            <EmoteBar
              orientation="row"
              btn={36}
              recents={recents}
              charge={charge}
              onEmit={emote?.start}
              onPick={emote?.pick}
              dark={dark}
            />
          </div>
        </>
      )}

      {publish && (
        <>
          <TrackToggle source={Track.Source.Microphone} />
          {!tight && <MediaDeviceMenu kind="audioinput" />}
          <TrackToggle source={Track.Source.Camera} />
          {!tight && <MediaDeviceMenu kind="videoinput" />}
          <TrackToggle source={Track.Source.ScreenShare} />
        </>
      )}
      <button
        type="button"
        className="lk-button"
        onClick={() => setReactionsOpen((v) => !v)}
        aria-label="Reactions"
        aria-expanded={reactionsOpen}
        title="Reactions"
      >
        <Smile className="w-5 h-5" />
      </button>
      <DisconnectButton>{tight ? <PhoneOff className="w-4 h-4" /> : "Leave"}</DisconnectButton>
    </div>
  );
}

// A small toggleable "N watching" pill → expandable name list, shown over
// the grid so spectators take a line of text, not a whole tile.
function SpectatorList({ spectators }) {
  const [open, setOpen] = useState(false);
  if (!spectators.length) return null;
  return (
    <div className="absolute top-2 right-2 z-10 text-white flex flex-col items-end">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="People watching without their camera on"
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-900/70 backdrop-blur-sm text-[11px] font-semibold hover:bg-slate-900/90"
      >
        <Eye className="w-3.5 h-3.5 opacity-80" />
        {spectators.length} watching
      </button>
      {open && (
        <div className="mt-1 w-44 max-h-40 overflow-auto rounded-lg bg-slate-900/90 backdrop-blur-sm p-1.5 text-[12px]">
          {spectators.map((p) => (
            <div key={p.identity} className="truncate px-1.5 py-0.5">{p.name || p.identity}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConferenceLayout({ compact, publish, onJoinIn, emote }) {
  // Collapse the control bar to icon-only below this width so the video can
  // stay small without the toolbar overflowing.
  const rootRef = useRef(null);
  const [tight, setTight] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const apply = () => setTight(el.clientWidth < 380);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const participants = useParticipants();
  // Spectators are listed by name; publishers (even camera-off) get a tile.
  const spectators = participants.filter((p) => p.attributes?.role === "spectator" && !p.isLocal);

  const shown = tracks.filter((t) => {
    const p = t.participant;
    if (!p) return true;
    if (p.attributes?.role === "spectator") return false; // listed, not tiled
    if (!publish && p.isLocal) return false; // don't show your own empty tile
    return true;
  });

  return (
    <div ref={rootRef} className="flex flex-col w-full h-full">
      <div className="relative flex-1 min-h-0">
        <GridLayout tracks={shown} style={{ height: "100%" }}>
          <ParticipantTile />
        </GridLayout>
        <SpectatorList spectators={spectators} />
        {/* Spectator → publisher. Rendered ON the overlay (the app's stage
            placeholder underneath is covered by this call). */}
        {!publish && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10">
            <button
              type="button"
              onClick={() => onJoinIn?.()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-[12px] font-semibold shadow-lg"
            >
              <Eye className="w-3.5 h-3.5 opacity-90" /> Watching
              <span className="opacity-60">·</span>
              <Video className="w-3.5 h-3.5" /> Join in
            </button>
          </div>
        )}
      </div>
      {!compact && (
        <div className="shrink-0">
          <CallControlBar publish={publish} tight={tight} emote={emote} />
        </div>
      )}
    </div>
  );
}

export default function LiveKitCall({ roomId, displayName, compact, publish = true, choices, onJoinIn, emote, onJoined, onLeft, onError }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [token, setToken] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setToken(null);
    (async () => {
      try {
        const t = await fetchLiveKitToken(liveKitRoomName(roomId), displayName);
        if (!cancelled) setToken(t);
      } catch (e) {
        if (!cancelled) onError?.(e?.message || "Could not get a LiveKit token");
      }
    })();
    return () => { cancelled = true; };
    // Re-mint only on room change (identity is the user, not the name).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  if (!LIVEKIT_URL) {
    onError?.("LiveKit is not configured (missing VITE_LIVE_KIT_URL)");
    return null;
  }

  if (!token) {
    return <div className="w-full h-full rounded-xl overflow-hidden bg-slate-900" aria-label="Connecting to call" />;
  }

  const lkTheme = {
    height: "100%",
    "--lk-bg": dark ? "#0b1220" : "#0f172a",
    "--lk-bg-secondary": dark ? "#0f172a" : "#1e293b",
    "--lk-fg": "#f1f5f9",
    "--lk-accent-bg": "var(--color-accent)",
    "--lk-accent-fg": "#ffffff",
    "--lk-control-bg": "rgba(255,255,255,0.08)",
    "--lk-control-fg": "#f1f5f9",
    "--lk-border-radius": "0.75rem",
  };

  return (
    <div
      className="w-full h-full rounded-xl overflow-hidden"
      data-lk-theme="default"
      style={lkTheme}
    >
      <LiveKitRoom
        serverUrl={LIVEKIT_URL}
        token={token}
        connect
        // Always connect subscribe-only; PublishController enables devices
        // when publishing so spectate↔join flips without a reconnect.
        video={false}
        audio={false}
        style={{ height: "100%" }}
        onConnected={() => onJoined?.()}
        onDisconnected={() => onLeft?.()}
        onError={(e) => onError?.(e?.message || "LiveKit connection error")}
      >
        <PublishController publish={publish} choices={choices} />
        <ConferenceLayout compact={compact} publish={publish} onJoinIn={onJoinIn} emote={emote} />
        {/* Required for participants to be audible. */}
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  );
}
