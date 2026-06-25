import { useEffect, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  ParticipantTile,
  TrackToggle,
  DisconnectButton,
  LayoutContextProvider,
  usePinnedTracks,
  useSpeakingParticipants,
  useMediaDeviceSelect,
  useTracks,
  useParticipants,
  useLocalParticipant,
  useRoomContext,
  useMaybeTrackRefContext,
} from "@livekit/components-react";
import { Track, RoomEvent, setLogLevel } from "livekit-client";
import "@livekit/components-styles";
import { Eye, Video, Smile, PhoneOff, LayoutGrid, Presentation, Focus, Waves, ChevronDown, Check, Plus, Users, Mic, MicOff, UserX, X, DoorOpen, Volume2, Sparkles, Pin, PinOff } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import { useTeam } from "../../context/TeamContext";
import EmoteBar from "../emotes/EmoteBar";
import { LIVEKIT_URL, fetchLiveKitToken, liveKitRoomName } from "../../lib/livekit";
import { kickFromCall, muteParticipantTrack, setRoomPin, clearRoomPin } from "../../lib/livekitModerate";
import { useRoomCluster, useClusterRoles, ATTR_ROOM_DEVICE } from "./useRoomCluster";
import { pickBestMicrophone } from "./bestMic";
import { createVoiceDetector } from "./autoMic";

// LiveKit's client logs at "info" by default, which floods the console with
// per-connection play-by-play (signal connecting, connection state changes,
// track publish/unpublish, "already connected to room") — and doubles it under
// React StrictMode in dev, which mounts/unmounts effects twice. It also warns
// on the benign connect→leave→connect churn StrictMode causes ("could not
// createOffer with closed peer connection"). Drop it to "error" so only real
// failures surface. Module-level so it runs once, before any room connects.
setLogLevel("error");

// LiveKit provider — the A/B counterpart to <JitsiCall>.
//
// We compose LiveKit's primitives (Grid/Focus/Carousel layouts +
// ParticipantTile + RoomAudioRenderer + a custom ControlBar) rather than the
// all-in-one <VideoConference> so the call matches the app and adapts to
// context:
//   • compact (PiP) → just the stage, no control bar (the app frames PiP).
//   • publish=false (spectate) → connect subscribe-only: you see/hear
//     everyone without publishing your own camera/mic.
//
// We always connect subscribe-only and then enable camera/mic via the
// local-participant API (PublishController) so spectate ↔ join can flip
// live without reconnecting.

// Per-device preferences for the local self-view processors + layout. Kept in
// localStorage so they persist across calls and apply even in PiP (which has
// no control bar to toggle them).
const PREF = { bg: "ql_lk_bg", bgCustom: "ql_lk_bg_custom", noise: "ql_lk_noise", layout: "ql_lk_layout", autoMic: "ql_lk_automic" };
function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}
function savePref(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch {
    /* ignore */
  }
}

function refKey(t) {
  return t ? `${t.participant?.identity || ""}:${t.source}` : "";
}

// Krisp bundles several MB of WASM; load it on demand — only when a call enables
// noise cancellation — so it never weighs down the eager app bundle. (The camera
// background pipeline lazy-loads its own MediaPipe deps in refinedBackground.js.)
// stopProcessor() is a track method, so DISABLING needs no package.
let _krispModPromise;
const loadKrispMod = () => (_krispModPromise ||= import("@livekit/krisp-noise-filter"));

// Built-in virtual backgrounds — rendered as gradients on a canvas so we ship
// no binary image assets. The same gradient backs the menu thumbnail (via CSS)
// and the processor (via this canvas data URL), so they match exactly.
const BG_PRESETS = [
  { id: "ocean", label: "Ocean", colors: ["#0ea5e9", "#0f766e"] },
  { id: "sunset", label: "Sunset", colors: ["#fb923c", "#db2777"] },
  { id: "violet", label: "Violet", colors: ["#7c3aed", "#2563eb"] },
  { id: "forest", label: "Forest", colors: ["#16a34a", "#0f766e"] },
  { id: "slate", label: "Slate", colors: ["#475569", "#0f172a"] },
];
const _bgUrlCache = {};
function bgPresetUrl(id) {
  if (_bgUrlCache[id]) return _bgUrlCache[id];
  const preset = BG_PRESETS.find((p) => p.id === id);
  if (!preset) return null;
  try {
    const w = 1280, h = 720;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, preset.colors[0]);
    g.addColorStop(1, preset.colors[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    _bgUrlCache[id] = c.toDataURL("image/jpeg", 0.85);
    return _bgUrlCache[id];
  } catch {
    return null;
  }
}

// Downscale an uploaded image to a sane size + JPEG so the data URL stays small
// enough for localStorage and light for the segmenter to composite each frame.
function fileToScaledDataUrl(file, maxW = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.85));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// Map a bg descriptor ("blur:<r>" | "image:<id|custom>") to the refined
// processor's options. Returns null for an unresolved image (e.g. no custom yet).
function bgToOptions(bg, customBg) {
  if (bg.startsWith("blur:")) return { mode: "blur", blurRadius: parseInt(bg.slice(5), 10) || 10 };
  if (bg.startsWith("image:")) {
    const key = bg.slice(6);
    const url = key === "custom" ? customBg : bgPresetUrl(key);
    return url ? { mode: "image", imageUrl: url } : null;
  }
  return null;
}

function PublishController({ publish, choices, micMuted }) {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const { cluster, isMicSource } = useRoomCluster();
  const bestMicAppliedRef = useRef(false);

  useEffect(() => {
    if (!localParticipant) return;
    // Tag our role so every client can render spectators as a name list
    // instead of giving them a (camera-off) tile in the grid.
    localParticipant.setAttributes({ role: publish ? "publisher" : "spectator" }).catch(() => { /* */ });
    const wantVideo = publish && (choices ? choices.videoEnabled !== false : true);
    // Your mic is live only when YOU haven't muted it AND (solo, or you're the
    // room's mic source). The in-room gate is the "behind the scenes" auto-mute —
    // it doesn't flip your personal mute button; that stays your own control.
    const wantAudio = publish && !micMuted && (cluster ? isMicSource : true);
    localParticipant
      .setCameraEnabled(wantVideo, choices?.videoDeviceId ? { deviceId: choices.videoDeviceId } : undefined)
      .catch(() => { /* device denied/unavailable — stay subscribe-only */ });
    localParticipant
      .setMicrophoneEnabled(wantAudio, choices?.audioDeviceId ? { deviceId: choices.audioDeviceId } : undefined)
      .catch(() => { /* */ });
  }, [localParticipant, publish, choices, cluster, isMicSource, micMuted]);

  // When this device becomes the room's mic source, move to the best available
  // mic (a dedicated/USB mic over the built-in). Skip if the user explicitly
  // picked a mic; run once per activation.
  useEffect(() => {
    if (!isMicSource) {
      bestMicAppliedRef.current = false;
      return undefined;
    }
    if (!publish || !room || choices?.audioDeviceId || bestMicAppliedRef.current) return undefined;
    bestMicAppliedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const best = await pickBestMicrophone();
        if (!cancelled && best?.deviceId) await room.switchActiveDevice("audioinput", best.deviceId);
      } catch {
        /* keep the current mic */
      }
    })();
    return () => { cancelled = true; };
  }, [isMicSource, publish, room, choices?.audioDeviceId]);

  return null;
}

// Manages the in-room cluster: leader handoff when the room speaker drops.
// Mounted exactly once (it owns the `manage` side-effects); renders nothing.
function RoomClusterManager() {
  useRoomCluster({ manage: true });
  return null;
}

// Proximity-style auto mic-switching (experimental, opt-in). Only active in a
// room that HAS a device — the device stays the stable audio sink (speakers)
// while the mic moves between people. Each in-room person runs local voice
// detection: speak → auto-claim the room mic (their close mic beats the device's
// far one); go quiet → release so the device reclaims. The detector keys on
// close/loud own-voice over an adaptive floor, so it's cleanest on a headset and
// best-effort on speakers (an in-room mic also hears the room speaker, which no
// per-device echo-cancel can remove). Thresholds will want real-world tuning.
function AutoMicController({ enabled }) {
  const cl = useRoomCluster();
  const hasDevice = cl.members.some((p) => p.attributes?.[ATTR_ROOM_DEVICE] === "1");
  const active = enabled && !!cl.cluster && hasDevice;
  // Keep the latest claim/release in a ref so the detector isn't torn down and
  // the mic re-opened on every render.
  const apiRef = useRef(cl);
  apiRef.current = cl;
  const heldRef = useRef(false);
  useEffect(() => {
    if (!active) return undefined;
    const stop = createVoiceDetector({
      onChange: (speaking) => {
        if (speaking) {
          apiRef.current.claimAuto();
          heldRef.current = true;
        } else if (heldRef.current) {
          apiRef.current.releaseAuto();
          heldRef.current = false;
        }
      },
    });
    return () => {
      stop?.();
      if (heldRef.current) {
        apiRef.current.releaseAuto();
        heldRef.current = false;
      }
    };
  }, [active]);
  return null;
}

// Audio playback. In a room only the AUDIO SINK (the device's speakers, or the
// lone speaker in a device-less room) plays the call aloud — anyone else in the
// room would double up and echo. Solo participants render normally.
function ClusterAudioRenderer() {
  const { cluster, isAudioSink } = useRoomCluster();
  if (cluster && !isAudioSink) return null;
  return <RoomAudioRenderer />;
}

// Stops audio from even being *sent* to in-room participants who aren't the
// sink. They hear the call through the room speaker in person, so they need no
// audio on their own device. Unsubscribing (vs just not playing) means the SFU
// stops delivering those streams here at all — matching "in-room people only
// need external audio, via the room speaker". This also covers a person who
// took over the mic: they publish, but the device still plays for the room, so
// they don't subscribe either. Re-subscribes the moment they become the sink.
function FollowerAudioGate() {
  const { cluster, isAudioSink } = useRoomCluster();
  const suppress = !!cluster && !isAudioSink;
  const audioTracks = useTracks(
    [Track.Source.Microphone, Track.Source.ScreenShareAudio],
    { onlySubscribed: false },
  );
  useEffect(() => {
    audioTracks.forEach((tr) => {
      const pub = tr.publication;
      if (!pub || tr.participant?.isLocal || typeof pub.setSubscribed !== "function") return;
      pub.setSubscribed(!suppress);
    });
  }, [suppress, audioTracks]);
  return null;
}

// Applies the self-view processors to the LOCAL tracks: our refined background
// pipeline on the camera (refinedBackground.js — MediaPipe + WebGL edge refine)
// and Krisp noise cancellation on the mic (@livekit/krisp-noise-filter, a
// LiveKit Cloud feature). Re-runs when settings change or the underlying track
// republishes (mute/unmute, device swap).
function EffectsController({ bg, customBg, noiseEnabled }) {
  const { cameraTrack, microphoneTrack } = useLocalParticipant();
  const procRef = useRef(null);
  const appliedToRef = useRef(null);

  useEffect(() => {
    const t = cameraTrack?.track;
    if (!t || t.kind !== "video") return undefined;
    let active = true;
    (async () => {
      try {
        if (!bg || bg === "none") {
          if (appliedToRef.current === t) await t.stopProcessor();
          procRef.current = null;
          appliedToRef.current = null;
          return;
        }
        const opts = bgToOptions(bg, customBg);
        if (!opts) return;
        const { createRefinedBackgroundProcessor } = await import("./refinedBackground");
        if (!active) return;
        // Update the running processor in place when only params changed; build
        // a fresh one (which spins up MediaPipe + WebGL) only on first apply or
        // when the camera track itself changed.
        if (procRef.current && appliedToRef.current === t) {
          procRef.current.updateOptions(opts);
        } else {
          const proc = createRefinedBackgroundProcessor(opts);
          procRef.current = proc;
          appliedToRef.current = t;
          await t.setProcessor(proc);
        }
      } catch {
        /* unsupported / failed — leave the raw camera so the call still works */
      }
    })();
    return () => { active = false; };
  }, [bg, customBg, cameraTrack]);

  useEffect(() => {
    const t = microphoneTrack?.track;
    if (!t || t.kind !== "audio") return undefined;
    let active = true;
    (async () => {
      try {
        if (noiseEnabled) {
          const { KrispNoiseFilter, isKrispNoiseFilterSupported } = await loadKrispMod();
          if (active && isKrispNoiseFilterSupported()) await t.setProcessor(KrispNoiseFilter());
        } else {
          await t.stopProcessor();
        }
      } catch {
        /* unsupported (e.g. not LiveKit Cloud) — leave the raw track */
      }
    })();
    return () => { active = false; };
  }, [noiseEnabled, microphoneTrack]);

  return null;
}

// A settings row inside a device menu — a labelled on/off toggle (e.g. blur,
// noise cancellation) that lives alongside the device list.
function SettingRow({ icon: Icon, label, active, onClick }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={active}
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left rounded-md hover:bg-white/10"
    >
      <Icon className="w-3.5 h-3.5 opacity-80 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      <span className={`text-[10px] font-bold uppercase tracking-wide ${active ? "text-[var(--lk-accent-bg,#22d3ee)]" : "opacity-50"}`}>
        {active ? "On" : "Off"}
      </span>
    </button>
  );
}

// Background picker for the camera menu: off, three blur strengths, and
// virtual-background images (built-in gradients + a custom upload). Lives
// inside the camera device menu so all video settings sit together.
function BackgroundEffects({ value, onChange, customBg, onUpload }) {
  const chip = (val, label) => (
    <button
      type="button"
      onClick={() => onChange(val)}
      aria-pressed={value === val}
      className={`px-2 py-1 rounded-md text-[11px] font-medium text-left transition-colors ${
        value === val ? "bg-white/15 text-white" : "opacity-80 hover:bg-white/10"
      }`}
    >
      {label}
    </button>
  );
  const thumbCls = (sel) =>
    `aspect-square rounded overflow-hidden ring-1 transition ${
      sel ? "ring-2 ring-white" : "ring-white/15 hover:ring-white/40"
    }`;
  return (
    <div className="px-1 py-1">
      <div className="px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wider opacity-60">Background</div>
      <div className="grid grid-cols-2 gap-1 px-1">
        {chip("none", "None")}
        {chip("blur:4", "Blur · Light")}
        {chip("blur:9", "Blur · Medium")}
        {chip("blur:18", "Blur · Strong")}
      </div>
      <div className="mt-1.5 px-1 grid grid-cols-5 gap-1">
        {BG_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            title={p.label}
            aria-label={`Background: ${p.label}`}
            onClick={() => onChange(`image:${p.id}`)}
            className={thumbCls(value === `image:${p.id}`)}
            style={{ backgroundImage: `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]})` }}
          />
        ))}
        {customBg && (
          <button
            type="button"
            title="Custom background"
            onClick={() => onChange("image:custom")}
            className={thumbCls(value === "image:custom")}
          >
            <img src={customBg} alt="" className="w-full h-full object-cover" />
          </button>
        )}
        <label
          title="Upload an image"
          className="aspect-square rounded ring-1 ring-white/15 flex items-center justify-center cursor-pointer hover:bg-white/10"
        >
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
          />
          <Plus className="w-3.5 h-3.5 opacity-70" />
        </label>
      </div>
    </div>
  );
}

// Per-track settings dropdown: the device picker (mic / camera) PLUS that
// track's processing settings below it. Replaces LiveKit's <MediaDeviceMenu>
// so all audio settings (mic + noise cancellation) live under the mic, and all
// video settings (camera + background blur/image) under the camera.
function DeviceSettingsMenu({ kind, label, children }) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind });
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="lk-button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label} settings`}
        title={`${label} settings`}
      >
        <ChevronDown className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 w-60 max-h-[70vh] overflow-y-auto rounded-lg bg-slate-900/95 backdrop-blur-sm text-white p-1.5 shadow-xl text-[12px]">
          <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider opacity-60">{label}</div>
          <div className="max-h-44 overflow-auto">
            {devices.length === 0 ? (
              <div className="px-2.5 py-1.5 opacity-60">No devices found</div>
            ) : (
              devices.map((d) => {
                const selected = d.deviceId === activeDeviceId;
                return (
                  <button
                    key={d.deviceId}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => { setActiveMediaDevice(d.deviceId); setOpen(false); }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left rounded-md hover:bg-white/10"
                  >
                    <span className="flex-1 truncate">{d.label || "Unnamed device"}</span>
                    {selected && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
          {children && <div className="mt-1 pt-1 border-t border-white/10">{children}</div>}
        </div>
      )}
    </div>
  );
}

// In-room ("companion mode") control. When several people share one physical
// room, one device becomes the room speaker (mic + audio) and the others join
// muted so the room doesn't echo. Not in a room → one click joins an existing
// one (if a neighbour started it) or starts a new one. In a room → a small
// popover shows who's together and a Leave action.
function RoomClusterButton({ autoMic, onToggleAutoMic }) {
  const {
    cluster, members, isMicSource, isAudioSink, existingCluster,
    startRoom, joinRoom, takeSpeaker, stepDown, takeSink, releaseSink, leaveRoom,
  } = useRoomCluster();
  const roles = useClusterRoles();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!cluster) {
    const joining = !!existingCluster;
    return (
      <button
        type="button"
        className="lk-button"
        title={
          joining
            ? `Join ${existingCluster.leaderName || "the"} room — mutes your mic & call audio (for when you're together in person)`
            : "Make this the room speaker — others sharing your room join muted so it doesn't echo"
        }
        aria-label={joining ? "Join room" : "Make this the room speaker"}
        onClick={() => (joining ? joinRoom(existingCluster) : startRoom())}
      >
        <DoorOpen className="w-5 h-5" />
      </button>
    );
  }

  const deviceInRoom = members.some((p) => roles.get(p.identity)?.isDevice);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="lk-button"
        aria-pressed="true"
        aria-expanded={open}
        title={isMicSource ? "You're the room mic" : "You're in a shared room (muted)"}
        onClick={() => setOpen((v) => !v)}
      >
        <DoorOpen className="w-5 h-5" style={{ color: "var(--lk-accent-bg, #22d3ee)" }} />
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 w-60 rounded-lg bg-slate-900/95 backdrop-blur-sm text-white p-2 shadow-xl text-[12px]">
          <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider opacity-60">
            {isMicSource ? "You're the room mic" : "In this room · muted"}
          </div>
          <ul className="max-h-40 overflow-auto mb-1.5">
            {members.map((p) => {
              const r = roles.get(p.identity) || {};
              const tag = r.isDevice
                ? "device"
                : r.isMicSource && r.isAudioSink
                  ? "mic + speaker"
                  : r.isMicSource
                    ? "mic"
                    : r.isAudioSink
                      ? "speaker"
                      : null;
              return (
                <li key={p.identity} className="flex items-center gap-1.5 px-1 py-0.5">
                  <span className="flex-1 min-w-0 truncate">
                    {p.name || p.identity}
                    {p.isLocal && <span className="opacity-60"> (you)</span>}
                  </span>
                  {tag ? (
                    <span className="inline-flex items-center gap-1 text-amber-300 shrink-0">
                      <Volume2 className="w-3.5 h-3.5" />
                      {tag}
                    </span>
                  ) : (
                    <MicOff className="w-3.5 h-3.5 opacity-50 shrink-0" title="Muted" />
                  )}
                </li>
              );
            })}
          </ul>
          <div className="space-y-1">
            {isMicSource ? (
              <button
                type="button"
                onClick={() => { stepDown(); setOpen(false); }}
                className="w-full px-2 py-1.5 rounded-md bg-white/10 hover:bg-white/15 text-left font-medium"
              >
                {deviceInRoom ? "Give mic back to room device" : "Step down as room mic"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { takeSpeaker(); setOpen(false); }}
                className="w-full px-2 py-1.5 rounded-md bg-white/10 hover:bg-white/15 text-left font-medium"
              >
                Take over the room mic
              </button>
            )}
            {deviceInRoom && (
              isAudioSink ? (
                <button
                  type="button"
                  onClick={() => { releaseSink(); setOpen(false); }}
                  className="w-full px-2 py-1.5 rounded-md bg-white/10 hover:bg-white/15 text-left font-medium"
                >
                  Give room speakers back to device
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { takeSink(); setOpen(false); }}
                  className="w-full px-2 py-1.5 rounded-md bg-white/10 hover:bg-white/15 text-left font-medium"
                  title="Play the call through this computer's speakers instead of the device's."
                >
                  Use my speakers for the room
                </button>
              )
            )}
            <button
              type="button"
              onClick={() => { leaveRoom(); setOpen(false); }}
              className="w-full px-2 py-1.5 rounded-md bg-white/10 hover:bg-white/15 text-left"
            >
              Leave room
            </button>
          </div>
          {deviceInRoom && (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={!!autoMic}
              onClick={() => onToggleAutoMic?.()}
              className="mt-1.5 pt-1.5 border-t border-white/10 w-full flex items-center gap-2 px-2 py-1 text-left rounded-md hover:bg-white/10"
              title="Experimental: automatically hand the room mic to whoever's speaking (their closer mic)."
            >
              <Sparkles className="w-3.5 h-3.5 opacity-80 shrink-0" />
              <span className="flex-1">Auto-switch mic to the speaker</span>
              <span className={`text-[10px] font-bold uppercase tracking-wide ${autoMic ? "text-[var(--lk-accent-bg,#22d3ee)]" : "opacity-50"}`}>
                {autoMic ? "On" : "Off"}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Personal mic mute. The icon reflects only what YOU did — not the in-room
// auto-mute, which happens behind the scenes. When you're in a room and your
// audio is being carried by the room mic, the icon still shows your own state
// and the tooltip (plus the "In room" tile badge) explains why you may not be
// transmitting. So: MicOff = you muted yourself; Mic + "In room" badge = the
// room is carrying you.
function MicButton({ micMuted, onToggleMic }) {
  const { cluster, isMicSource } = useRoomCluster();
  const carriedByRoom = !!cluster && !isMicSource;
  const title = micMuted
    ? "Unmute"
    : carriedByRoom
      ? "You're in the room — the room mic carries your audio"
      : "Mute";
  return (
    <button
      type="button"
      className="lk-button"
      aria-pressed={micMuted}
      aria-label={micMuted ? "Unmute microphone" : "Mute microphone"}
      title={title}
      onClick={() => onToggleMic?.()}
    >
      {micMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
    </button>
  );
}

// Layout-mode picker (grid / presenter / spotlight). A small popover keyed off
// the current mode's icon, replacing the old grid↔speaker toggle.
function LayoutMenu({ mode, onSet }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const items = [
    { id: "grid", label: "Grid", Icon: LayoutGrid },
    { id: "presenter", label: "Presenter", Icon: Presentation },
    { id: "spotlight", label: "Spotlight", Icon: Focus },
  ];
  const Cur = (items.find((i) => i.id === mode) || items[0]).Icon;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="lk-button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Layout"
      >
        <Cur className="w-5 h-5" />
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 w-40 rounded-lg bg-slate-900/95 backdrop-blur-sm text-white p-1 shadow-xl text-[12px]">
          {items.map((it) => {
            const sel = mode === it.id;
            return (
              <button
                key={it.id}
                type="button"
                role="menuitemradio"
                aria-checked={sel}
                onClick={() => { onSet(it.id); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-white/10 ${sel ? "text-[var(--lk-accent-bg,#22d3ee)]" : ""}`}
              >
                <it.Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left">{it.label}</span>
                {sel && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Custom control bar (replaces LiveKit's <ControlBar>) so reactions + the
// layout toggle sit where we want and it collapses to icon-only when the tile
// is narrow — keeping a small video usable rather than forcing a large minimum
// size. Per-track processing (blur, noise cancellation) lives in each device
// menu, not as separate buttons.
//
// The reactions popup (Google-Meet style) is centered on the bar FRAME, not
// on the off-center smiley button — so it stays put regardless of how many
// controls flank it.
function CallControlBar({
  publish, tight, emote,
  layoutMode, onSetLayout,
  bg, onChangeBg, customBg, onUploadBg,
  noiseEnabled, onToggleNoise,
  autoMic, onToggleAutoMic,
  micMuted, onToggleMic,
  peopleOpen, onTogglePeople,
}) {
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
    <div
      className="relative flex items-center justify-center flex-wrap gap-1.5 px-2.5 py-2 rounded-2xl bg-black/45 backdrop-blur-md shadow-xl ring-1 ring-white/10"
      style={{ "--lk-border-radius": "9999px" }}
    >
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
          <MicButton micMuted={micMuted} onToggleMic={onToggleMic} />
          {!tight && (
            <DeviceSettingsMenu kind="audioinput" label="Microphone">
              <SettingRow icon={Waves} label="Noise cancellation" active={noiseEnabled} onClick={onToggleNoise} />
            </DeviceSettingsMenu>
          )}
          <TrackToggle source={Track.Source.Camera} />
          {!tight && (
            <DeviceSettingsMenu kind="videoinput" label="Camera">
              <BackgroundEffects value={bg} onChange={onChangeBg} customBg={customBg} onUpload={onUploadBg} />
            </DeviceSettingsMenu>
          )}
          <TrackToggle source={Track.Source.ScreenShare} />
          {/* In-room companion mode: become the room speaker / join muted. */}
          <RoomClusterButton autoMic={autoMic} onToggleAutoMic={onToggleAutoMic} />
        </>
      )}

      {/* Layout picker (viewing — available whether or not you publish). */}
      <LayoutMenu mode={layoutMode} onSet={onSetLayout} />

      {/* People / moderation roster. */}
      <button
        type="button"
        className="lk-button"
        onClick={onTogglePeople}
        aria-pressed={peopleOpen}
        title="People in this call"
      >
        <Users className="w-5 h-5" />
      </button>

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
// the stage so spectators take a line of text, not a whole tile.
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

// Host moderation roster: lists everyone in the call. The session leader gets
// mute / remove actions per participant (the action is enforced server-side by
// the livekit-moderate edge function; this UI gate is just for affordance).
// The room-level "global pin" — a team admin pins a participant and everyone's
// view focuses them. Stored in LiveKit room metadata (set by livekit-moderate),
// so it propagates to every client via RoomMetadataChanged. Returns the pinned
// participant identity (a user uid) or null.
function parseGlobalPin(metadata) {
  if (!metadata) return null;
  try {
    return JSON.parse(metadata)?.pinnedIdentity || null;
  } catch {
    return null;
  }
}
function useGlobalPin() {
  const room = useRoomContext();
  const [pinnedId, setPinnedId] = useState(() => parseGlobalPin(room?.metadata));
  useEffect(() => {
    if (!room) return undefined;
    const update = () => setPinnedId(parseGlobalPin(room.metadata));
    update();
    room.on(RoomEvent.RoomMetadataChanged, update);
    return () => room.off(RoomEvent.RoomMetadataChanged, update);
  }, [room]);
  return pinnedId;
}

function PeoplePanel({ roomId, onClose }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const { syncSession } = useSyncSession();
  const { isAdmin, isOwner } = useTeam();
  const myId = localParticipant?.identity;
  const leaderId = syncSession?.leader_id || null;
  const isHost = !!leaderId && leaderId === myId;
  // Pinning for everyone is a team admin power (server re-checks against the
  // room's team; this just gates the affordance).
  const isOrgAdmin = !!isAdmin || !!isOwner;
  const globalPinId = useGlobalPin();
  const [busy, setBusy] = useState(null);
  const [confirmKick, setConfirmKick] = useState(null);

  const doKick = async (id) => {
    setBusy(id);
    const { error } = await kickFromCall(roomId, id);
    setBusy(null);
    setConfirmKick(null);
    if (error) console.warn("kick:", error.message);
  };
  const doMute = async (p) => {
    const micPub = p.getTrackPublication?.(Track.Source.Microphone);
    if (!micPub?.trackSid) return;
    setBusy(p.identity);
    const { error } = await muteParticipantTrack(roomId, p.identity, micPub.trackSid);
    setBusy(null);
    if (error) console.warn("mute:", error.message);
  };
  const doPin = async (id) => {
    setBusy(id);
    const { error } = await setRoomPin(roomId, id);
    setBusy(null);
    if (error) console.warn("pin:", error.message);
  };
  const doUnpin = async (id) => {
    setBusy(id);
    const { error } = await clearRoomPin(roomId);
    setBusy(null);
    if (error) console.warn("unpin:", error.message);
  };

  return (
    <div
      className={`absolute top-2 left-2 z-20 w-64 max-h-[85%] overflow-auto rounded-lg backdrop-blur-sm p-2 shadow-xl text-[12px] ${
        dark ? "bg-slate-900/95 text-slate-100" : "bg-slate-900/90 text-white"
      }`}
    >
      <div className="flex items-center justify-between px-1 pb-1.5">
        <span className="font-semibold">In this call · {participants.length}</span>
        <button type="button" onClick={onClose} aria-label="Close" className="p-0.5 rounded hover:bg-white/10">
          <X className="w-4 h-4" />
        </button>
      </div>
      <ul className="space-y-0.5">
        {participants.map((p) => {
          const isSelf = p.identity === myId;
          const isLeader = p.identity === leaderId;
          const isSpectator = p.attributes?.role === "spectator";
          const isPinned = p.identity === globalPinId;
          const micPub = p.getTrackPublication?.(Track.Source.Microphone);
          const micOn = !!micPub && !micPub.isMuted;
          return (
            <li key={p.identity} className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-white/5">
              <span className="flex-1 min-w-0 truncate">
                {p.name || p.identity}
                {isSelf && <span className="opacity-60"> (you)</span>}
                {isLeader && <span className="text-amber-300"> ★</span>}
                {isPinned && <Pin className="inline w-3 h-3 text-amber-300 ml-1 -mt-0.5" />}
                {isSpectator && <span className="opacity-50"> · watching</span>}
              </span>
              {(isOrgAdmin || (isHost && !isSelf)) && (
                <span className="flex items-center gap-0.5 shrink-0">
                  {isOrgAdmin && (
                    isPinned ? (
                      <button
                        type="button"
                        title="Unpin for everyone"
                        disabled={busy === p.identity}
                        onClick={() => doUnpin(p.identity)}
                        className="p-1 rounded text-amber-300 hover:bg-white/15 disabled:opacity-40"
                      >
                        <PinOff className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        title="Pin for everyone"
                        disabled={busy === p.identity}
                        onClick={() => doPin(p.identity)}
                        className="p-1 rounded hover:bg-white/15 disabled:opacity-40"
                      >
                        <Pin className="w-3.5 h-3.5" />
                      </button>
                    )
                  )}
                  {isHost && !isSelf && micOn && (
                    <button
                      type="button"
                      title="Mute mic"
                      disabled={busy === p.identity}
                      onClick={() => doMute(p)}
                      className="p-1 rounded hover:bg-white/15 disabled:opacity-40"
                    >
                      <MicOff className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {isHost && !isSelf && (
                    confirmKick === p.identity ? (
                      <button
                        type="button"
                        disabled={busy === p.identity}
                        onClick={() => doKick(p.identity)}
                        className="px-1.5 py-0.5 rounded bg-red-500/80 hover:bg-red-500 text-[10px] font-semibold disabled:opacity-40"
                      >
                        Remove?
                      </button>
                    ) : (
                      <button
                        type="button"
                        title="Remove from call"
                        onClick={() => setConfirmKick(p.identity)}
                        className="p-1 rounded text-red-300 hover:bg-red-500/20"
                      >
                        <UserX className="w-3.5 h-3.5" />
                      </button>
                    )
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {!isHost && (
        <p className="px-1 pt-1.5 text-[10px] opacity-50">Only the session leader can mute or remove.</p>
      )}
    </div>
  );
}

// A ParticipantTile with an in-room badge. When a participant is part of a
// physical-room cluster, their tile gets a small chip — amber "Room device" /
// "Room mic" for whoever carries the room's audio, muted "In room" for the
// rest — so the grouping is visible right in the grid. Looks the tile's role up
// in the shared cluster-roles map (so it reflects the EFFECTIVE leader, e.g.
// after a take-over). Wraps the default tile in a flex box and lets it fill, so
// the grid layout is unaffected.
function ClusterParticipantTile({ trackRef: trackRefProp }) {
  // Our layout engine passes the track ref explicitly; inside a LiveKit layout
  // it comes from context. Either way ParticipantTile gets it as a prop.
  const ctxTrackRef = useMaybeTrackRefContext();
  const trackRef = trackRefProp || ctxTrackRef;
  const participant = trackRef?.participant;
  const roles = useClusterRoles();
  const globalPinId = useGlobalPin();
  const role = participant ? roles.get(participant.identity) : null;
  const isPinned = !!participant?.identity && participant.identity === globalPinId;
  const inRoom = !!role?.inRoom;
  // Amber for whoever carries the room's audio I/O — the device, the current mic
  // source, or the speakers — muted chip for the rest.
  const active = !!role && (role.isDevice || role.isMicSource || role.isAudioSink);
  const label = role?.isDevice
    ? "Room device"
    : role?.isMicSource && role?.isAudioSink
      ? "Room mic + speaker"
      : role?.isMicSource
        ? "Room mic"
        : role?.isAudioSink
          ? "Room speaker"
          : "In room";
  return (
    <div style={{ position: "relative", display: "flex", width: "100%", height: "100%" }}>
      <ParticipantTile trackRef={trackRef} style={{ flex: 1, minWidth: 0, minHeight: 0 }} />
      {(isPinned || inRoom) && (
        <div className="absolute top-1.5 left-1.5 z-10 flex flex-col items-start gap-1 pointer-events-none">
          {isPinned && (
            <div
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold backdrop-blur-sm bg-amber-500/85 text-white"
              title="Pinned for everyone by an admin"
            >
              <Pin className="w-3 h-3 shrink-0" />
              Pinned
            </div>
          )}
          {inRoom && (
            <div
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold backdrop-blur-sm ${
                active ? "bg-amber-500/85 text-white" : "bg-slate-900/70 text-slate-100"
              }`}
              title={
                active
                  ? `${label} — carries this room's audio`
                  : "In the room · muted here (heard through the room speaker)"
              }
            >
              {active ? <Volume2 className="w-3 h-3 shrink-0" /> : <MicOff className="w-3 h-3 shrink-0" />}
              {label}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Largest uniform tile size (at `aspect`) that fits `n` tiles in W×H. Picks the
// column count that maximises tile area, so cells are never ultra-wide or
// skinny-tall — the aspect "clamp" that stops faces from being cropped.
function bestGrid(n, W, H, aspect, gap) {
  if (n <= 0 || W <= 0 || H <= 0) return { cols: 1, tileW: 0, tileH: 0 };
  let best = { cols: 1, tileW: 0, tileH: 0, area: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (W - gap * (cols - 1)) / cols;
    const ch = (H - gap * (rows - 1)) / rows;
    if (cw <= 0 || ch <= 0) continue;
    let tw = cw;
    let th = cw / aspect;
    if (th > ch) { th = ch; tw = ch * aspect; }
    const area = tw * th;
    if (area > best.area) best = { cols, tileW: tw, tileH: th, area };
  }
  return best;
}

function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const apply = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// A uniform, aspect-clamped grid of tiles (replaces LiveKit's GridLayout, whose
// cells filled arbitrary shapes and cropped faces). Every tile is the same
// ~16:9 box, sized as large as possible to fit them all, centered.
function VideoGrid({ tracks, aspect = 16 / 9, gap = 8 }) {
  const ref = useRef(null);
  const { w, h } = useSize(ref);
  const { cols, tileW, tileH } = bestGrid(tracks.length, w, h, aspect, gap);
  return (
    <div ref={ref} className="absolute inset-0 p-1">
      <div
        className="grid w-full h-full place-content-center"
        style={{ gap, gridTemplateColumns: `repeat(${Math.max(1, cols)}, ${tileW}px)`, gridAutoRows: `${tileH}px` }}
      >
        {tracks.map((tr) => (
          <ClusterParticipantTile key={refKey(tr)} trackRef={tr} />
        ))}
      </div>
    </div>
  );
}

// The video stage. Switches between layout modes — grid (uniform clamped
// tiles), presenter (one big focus + a strip of the rest), and spotlight (just
// the focus). An explicit focus (your pin, the admin's global pin, or a screen
// share) forces a focused layout even in grid; a squished tile collapses to
// spotlight. Clicking a tile's focus button pins it (LiveKit's
// LayoutContextProvider wires that into ParticipantTile for free).
function Stage({ compact, publish, onJoinIn, layoutMode, roomId, peopleOpen, onClosePeople }) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const participants = useParticipants();
  const speaking = useSpeakingParticipants();
  const pinned = usePinnedTracks();
  const globalPinId = useGlobalPin();
  const rootRef = useRef(null);
  const { w, h } = useSize(rootRef);

  // Keep the last active speaker so the focus doesn't fall away during a silence
  // between turns.
  const [stickySpeaker, setStickySpeaker] = useState(null);
  const topSpeaker = speaking?.[0]?.identity;
  useEffect(() => {
    if (topSpeaker) setStickySpeaker(topSpeaker);
  }, [topSpeaker]);

  // Spectators are listed by name; publishers (even camera-off) get a tile.
  const spectators = participants.filter((p) => p.attributes?.role === "spectator" && !p.isLocal);
  const shown = tracks.filter((t) => {
    const p = t.participant;
    if (!p) return true;
    if (p.attributes?.role === "spectator") return false; // listed, not tiled
    if (!publish && p.isLocal) return false; // don't show your own empty tile
    return true;
  });

  const screenTrack = shown.find((t) => t.source === Track.Source.ScreenShare);
  const speakerTrack = stickySpeaker
    ? shown.find((t) => t.participant?.identity === stickySpeaker && t.source === Track.Source.Camera)
    : null;
  // The admin's global pin (room metadata) focuses this participant for everyone,
  // unless you've locally pinned someone else. Their screen share wins over their
  // camera (the presenter case).
  const globalPinTrack = globalPinId
    ? shown.find((t) => t.participant?.identity === globalPinId && t.source === Track.Source.ScreenShare)
      || shown.find((t) => t.participant?.identity === globalPinId && t.source === Track.Source.Camera)
    : null;
  // An EXPLICIT focus (your pin > admin global pin > a screen share) forces a
  // focused layout even in grid mode. The big tile otherwise follows the active
  // speaker, then the first tile.
  const forcedFocus = (pinned && pinned[0]) || globalPinTrack || screenTrack || null;
  const focusTrack = forcedFocus || speakerTrack || shown[0] || null;

  // A squished tile (e.g. a tiny office panel) collapses to just the speaker.
  const squished = (h > 0 && h < 200) || (w > 0 && w < 220);
  let mode = layoutMode;
  if (squished) mode = "spotlight";
  else if (forcedFocus && layoutMode === "grid") mode = "presenter";

  const others = focusTrack ? shown.filter((t) => refKey(t) !== refKey(focusTrack)) : [];

  return (
    <div ref={rootRef} className="relative flex-1 min-h-0">
      {mode === "grid" && <VideoGrid tracks={shown} />}

      {/* VideoGrid (even for one tile) applies the aspect clamp, so the focus is
          letterboxed to ~16:9 instead of object-cover slicing a wide/short tile. */}
      {mode === "spotlight" && focusTrack && <VideoGrid tracks={[focusTrack]} />}

      {mode === "presenter" && focusTrack && (
        <div className="absolute inset-0 flex flex-col gap-1.5 p-1">
          <div className="relative flex-1 min-h-0">
            <VideoGrid tracks={[focusTrack]} />
          </div>
          {others.length > 0 && (
            <div className="relative shrink-0 h-[22%] min-h-[76px] max-h-[150px]">
              <VideoGrid tracks={others} />
            </div>
          )}
        </div>
      )}

      <SpectatorList spectators={spectators} />
      {peopleOpen && <PeoplePanel roomId={roomId} onClose={onClosePeople} />}

      {/* The spectator → publisher control lives in RoomVideoStage's JoinDock,
          overlaid on this call (it owns the persisted mic/camera join intent and
          the live preview context). PiP has no join affordance — go back to the
          room to join. onJoinIn is still wired for any future in-call use. */}
    </div>
  );
}

function ConferenceLayout({ compact, publish, onJoinIn, emote, roomId, micMuted, onToggleMic }) {
  // Collapse the control bar to icon-only below this width so the video can
  // stay small without the toolbar overflowing.
  const rootRef = useRef(null);
  const [tight, setTight] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const apply = () => setTight(el.clientWidth < 380);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-hiding controls: the bar floats over the video and fades after a few
  // seconds idle, returning on any pointer activity (Meet / FaceTime style). It
  // stays put while the pointer is over it (so menus don't vanish mid-use).
  const [controlsShown, setControlsShown] = useState(true);
  const hideTimerRef = useRef(null);
  const overBarRef = useRef(false);
  const reveal = () => {
    setControlsShown(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (!overBarRef.current) hideTimerRef.current = setTimeout(() => setControlsShown(false), 3000);
  };
  useEffect(() => {
    reveal();
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onBarEnter = () => {
    overBarRef.current = true;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setControlsShown(true);
  };
  const onBarLeave = () => { overBarRef.current = false; reveal(); };

  const [layoutMode, setLayoutMode] = useState(() => {
    const v = loadPref(PREF.layout, "grid");
    if (v === "grid" || v === "presenter" || v === "spotlight") return v;
    return v === "speaker" ? "presenter" : "grid"; // migrate the old grid/speaker pref
  });
  // Background effect descriptor: "none" | "blur:<radius>" | "image:<id|custom>".
  const [bg, setBg] = useState(() => loadPref(PREF.bg, "none"));
  const [customBg, setCustomBg] = useState(() => loadPref(PREF.bgCustom, "") || null);
  // Noise cancellation defaults ON (the whole point), where supported.
  const [noiseEnabled, setNoiseEnabled] = useState(() => loadPref(PREF.noise, "1") === "1");
  // Proximity auto mic-switching is experimental → defaults OFF.
  const [autoMic, setAutoMic] = useState(() => loadPref(PREF.autoMic, "0") === "1");

  useEffect(() => savePref(PREF.layout, layoutMode), [layoutMode]);
  useEffect(() => savePref(PREF.bg, bg), [bg]);
  useEffect(() => savePref(PREF.noise, noiseEnabled ? "1" : "0"), [noiseEnabled]);
  useEffect(() => savePref(PREF.autoMic, autoMic ? "1" : "0"), [autoMic]);

  const onUploadBg = async (file) => {
    try {
      const url = await fileToScaledDataUrl(file);
      try { localStorage.setItem(PREF.bgCustom, url); } catch { /* quota — keep in memory only */ }
      setCustomBg(url);
      setBg("image:custom");
    } catch {
      /* unreadable image — ignore */
    }
  };

  return (
    <div
      ref={rootRef}
      className="relative flex flex-col w-full h-full"
      onPointerMove={compact ? undefined : reveal}
      onPointerDown={compact ? undefined : reveal}
    >
      <EffectsController bg={bg} customBg={customBg} noiseEnabled={noiseEnabled} />
      <AutoMicController enabled={autoMic} />
      <LayoutContextProvider>
        <Stage
          compact={compact}
          publish={publish}
          onJoinIn={onJoinIn}
          layoutMode={layoutMode}
          roomId={roomId}
          peopleOpen={peopleOpen}
          onClosePeople={() => setPeopleOpen(false)}
        />
      </LayoutContextProvider>
      {!compact && (
        <div
          className={`absolute inset-x-0 bottom-0 z-30 flex justify-center px-2 pb-3 pointer-events-none transition-opacity duration-300 ${
            controlsShown ? "opacity-100" : "opacity-0"
          }`}
        >
          <div
            className={controlsShown ? "pointer-events-auto" : "pointer-events-none"}
            onMouseEnter={onBarEnter}
            onMouseLeave={onBarLeave}
          >
            <CallControlBar
              publish={publish}
              tight={tight}
              emote={emote}
              layoutMode={layoutMode}
              onSetLayout={setLayoutMode}
              bg={bg}
              onChangeBg={setBg}
              customBg={customBg}
              onUploadBg={onUploadBg}
              noiseEnabled={noiseEnabled}
              onToggleNoise={() => setNoiseEnabled((v) => !v)}
              autoMic={autoMic}
              onToggleAutoMic={() => setAutoMic((v) => !v)}
              micMuted={micMuted}
              onToggleMic={onToggleMic}
              peopleOpen={peopleOpen}
              onTogglePeople={() => setPeopleOpen((v) => !v)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function LiveKitCall({ roomId, displayName, compact, publish = true, choices, onJoinIn, emote, onJoined, onLeft, onError }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [token, setToken] = useState(null);
  // Personal mic mute — your own control, kept separate from the room's
  // behind-the-scenes auto-mute. Seeded from the join choice.
  const [micMuted, setMicMuted] = useState(choices?.audioEnabled === false);
  const toggleMic = () => setMicMuted((v) => !v);

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
        <PublishController publish={publish} choices={choices} micMuted={micMuted} />
        <ConferenceLayout compact={compact} publish={publish} onJoinIn={onJoinIn} emote={emote} roomId={roomId} micMuted={micMuted} onToggleMic={toggleMic} />
        {/* Owns in-room cluster management (leader handoff). Mount once. */}
        <RoomClusterManager />
        {/* In-room followers receive no audio at all (the room speaker carries
            it for them); everyone else plays normally. */}
        <FollowerAudioGate />
        {/* Required for participants to be audible — suppressed for in-room
            followers so the leader's speakers don't echo back through them. */}
        <ClusterAudioRenderer />
      </LiveKitRoom>
    </div>
  );
}
