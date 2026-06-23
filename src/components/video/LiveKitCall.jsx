import { useEffect, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  GridLayout,
  ParticipantTile,
  TrackToggle,
  DisconnectButton,
  LayoutContextProvider,
  FocusLayoutContainer,
  FocusLayout,
  CarouselLayout,
  usePinnedTracks,
  useSpeakingParticipants,
  useMediaDeviceSelect,
  useTracks,
  useParticipants,
  useLocalParticipant,
  useRoomContext,
  useMaybeTrackRefContext,
  useParticipantAttributes,
} from "@livekit/components-react";
import { Track, setLogLevel } from "livekit-client";
import "@livekit/components-styles";
import { Eye, Video, Smile, PhoneOff, LayoutGrid, SquareUser, Waves, ChevronDown, Check, Plus, Users, MicOff, UserX, X, DoorOpen, Volume2 } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { useSyncSession } from "../../context/SyncSessionContext";
import EmoteBar from "../emotes/EmoteBar";
import { LIVEKIT_URL, fetchLiveKitToken, liveKitRoomName } from "../../lib/livekit";
import { kickFromCall, muteParticipantTrack } from "../../lib/livekitModerate";
import { useRoomCluster, ATTR_CLUSTER, ATTR_LEADER, ATTR_ROOM_DEVICE } from "./useRoomCluster";
import { pickBestMicrophone } from "./bestMic";

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
const PREF = { bg: "ql_lk_bg", bgCustom: "ql_lk_bg_custom", noise: "ql_lk_noise", layout: "ql_lk_layout" };
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

function PublishController({ publish, choices }) {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const { isFollower, isLeader } = useRoomCluster();
  const bestMicAppliedRef = useRef(false);

  useEffect(() => {
    if (!localParticipant) return;
    // Tag our role so every client can render spectators as a name list
    // instead of giving them a (camera-off) tile in the grid.
    localParticipant.setAttributes({ role: publish ? "publisher" : "spectator" }).catch(() => { /* */ });
    const wantVideo = publish && (choices ? choices.videoEnabled !== false : true);
    // Followers in a shared physical room go mic-silent: the room leader's mic
    // already carries everyone in the space, so a second live mic here would
    // just feed back. Camera is untouched — each person keeps their own tile.
    const wantAudio = publish && !isFollower && (choices ? choices.audioEnabled !== false : true);
    localParticipant
      .setCameraEnabled(wantVideo, choices?.videoDeviceId ? { deviceId: choices.videoDeviceId } : undefined)
      .catch(() => { /* device denied/unavailable — stay subscribe-only */ });
    localParticipant
      .setMicrophoneEnabled(wantAudio, choices?.audioDeviceId ? { deviceId: choices.audioDeviceId } : undefined)
      .catch(() => { /* */ });
  }, [localParticipant, publish, choices, isFollower]);

  // When this device becomes the room speaker, move its mic to the best
  // available source (a dedicated/USB mic over the built-in). Skip if the user
  // explicitly picked a mic; run once per leader activation.
  useEffect(() => {
    if (!isLeader) {
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
  }, [isLeader, publish, room, choices?.audioDeviceId]);

  return null;
}

// Manages the in-room cluster: leader handoff when the room speaker drops.
// Mounted exactly once (it owns the `manage` side-effects); renders nothing.
function RoomClusterManager() {
  useRoomCluster({ manage: true });
  return null;
}

// Audio playback, suppressed for followers. A follower sits in the same
// physical room as the leader, whose speakers already play the call aloud —
// so playing it here too would double up and echo. Leaders and solo
// participants render audio as normal.
function ClusterAudioRenderer() {
  const { isFollower } = useRoomCluster();
  if (isFollower) return null;
  return <RoomAudioRenderer />;
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
        {chip("blur:6", "Blur · Light")}
        {chip("blur:12", "Blur · Medium")}
        {chip("blur:22", "Blur · Strong")}
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
function RoomClusterButton() {
  const { isLeader, isFollower, members, leaderId, existingCluster, startRoom, joinRoom, leaveRoom } = useRoomCluster();
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

  const inRoom = isLeader || isFollower;

  if (!inRoom) {
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="lk-button"
        aria-pressed="true"
        aria-expanded={open}
        title={isLeader ? "You're the room speaker" : "You're in a shared room (muted)"}
        onClick={() => setOpen((v) => !v)}
      >
        <DoorOpen className="w-5 h-5" style={{ color: "var(--lk-accent-bg, #22d3ee)" }} />
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-20 w-56 rounded-lg bg-slate-900/95 backdrop-blur-sm text-white p-2 shadow-xl text-[12px]">
          <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider opacity-60">
            {isLeader ? "You're the room speaker" : "In this room · muted"}
          </div>
          <ul className="max-h-40 overflow-auto mb-1.5">
            {members.map((p) => {
              const leads = p.identity === leaderId;
              return (
                <li key={p.identity} className="flex items-center gap-1.5 px-1 py-0.5">
                  <span className="flex-1 min-w-0 truncate">
                    {p.name || p.identity}
                    {p.isLocal && <span className="opacity-60"> (you)</span>}
                  </span>
                  {leads ? (
                    <Volume2 className="w-3.5 h-3.5 text-amber-300 shrink-0" title="Room speaker" />
                  ) : (
                    <MicOff className="w-3.5 h-3.5 opacity-50 shrink-0" title="Muted" />
                  )}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => { leaveRoom(); setOpen(false); }}
            className="w-full px-2 py-1.5 rounded-md bg-white/10 hover:bg-white/15 text-left font-medium"
          >
            Leave room
          </button>
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
  layoutMode, onToggleLayout,
  bg, onChangeBg, customBg, onUploadBg,
  noiseEnabled, onToggleNoise,
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
          <RoomClusterButton />
        </>
      )}

      {/* Layout toggle (viewing — available whether or not you publish). */}
      <button
        type="button"
        className="lk-button"
        onClick={onToggleLayout}
        title={layoutMode === "speaker" ? "Switch to grid view" : "Switch to speaker view"}
      >
        {layoutMode === "speaker" ? <LayoutGrid className="w-5 h-5" /> : <SquareUser className="w-5 h-5" />}
      </button>

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
function PeoplePanel({ roomId, onClose }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const { syncSession } = useSyncSession();
  const myId = localParticipant?.identity;
  const leaderId = syncSession?.leader_id || null;
  const isHost = !!leaderId && leaderId === myId;
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
          const micPub = p.getTrackPublication?.(Track.Source.Microphone);
          const micOn = !!micPub && !micPub.isMuted;
          return (
            <li key={p.identity} className="flex items-center gap-1.5 px-1 py-1 rounded hover:bg-white/5">
              <span className="flex-1 min-w-0 truncate">
                {p.name || p.identity}
                {isSelf && <span className="opacity-60"> (you)</span>}
                {isLeader && <span className="text-amber-300"> ★</span>}
                {isSpectator && <span className="opacity-50"> · watching</span>}
              </span>
              {isHost && !isSelf && (
                <span className="flex items-center gap-0.5 shrink-0">
                  {micOn && (
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
                  {confirmKick === p.identity ? (
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
// physical-room cluster, their tile gets a small chip — amber "Room speaker"
// for the one carrying the room's audio, muted "In room" for the followers —
// so the grouping is visible right in the grid. Reads the tile participant's
// OWN attributes (reactively, via useParticipantAttributes), so each tile
// decides its own badge with no cross-tile coordination. Wraps the default
// tile in a flex box and lets it fill, so the grid layout is unaffected.
function ClusterParticipantTile() {
  const trackRef = useMaybeTrackRefContext();
  const participant = trackRef?.participant;
  const { attributes } = useParticipantAttributes({ participant });
  const inRoom = !!attributes?.[ATTR_CLUSTER];
  const isSpeaker = inRoom && attributes?.[ATTR_LEADER] === participant?.identity;
  const isDevice = attributes?.[ATTR_ROOM_DEVICE] === "1";
  return (
    <div style={{ position: "relative", display: "flex", width: "100%", height: "100%" }}>
      <ParticipantTile style={{ flex: 1, minWidth: 0, minHeight: 0 }} />
      {inRoom && (
        <div
          className={`absolute top-1.5 left-1.5 z-10 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold backdrop-blur-sm pointer-events-none ${
            isSpeaker ? "bg-amber-500/85 text-white" : "bg-slate-900/70 text-slate-100"
          }`}
          title={
            isSpeaker
              ? `${isDevice ? "Room device" : "Room speaker"} — carries this room's audio`
              : "In the room · muted here (heard through the room speaker)"
          }
        >
          {isSpeaker ? <Volume2 className="w-3 h-3 shrink-0" /> : <MicOff className="w-3 h-3 shrink-0" />}
          {isSpeaker ? (isDevice ? "Room device" : "Room speaker") : "In room"}
        </div>
      )}
    </div>
  );
}

// The video stage. Renders a grid, or a focus layout (one big tile + a
// carousel filmstrip) when a tile is pinned, someone is screen-sharing, or
// speaker view is on. Clicking a tile's focus button pins it (LiveKit's
// LayoutContextProvider wires that into ParticipantTile for free); speaker
// view auto-focuses whoever is talking when nothing is manually pinned.
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

  // Keep the last active speaker so speaker view doesn't fall back to the grid
  // during a silence between turns.
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
  const speakerTrack =
    layoutMode === "speaker" && stickySpeaker
      ? shown.find((t) => t.participant?.identity === stickySpeaker && t.source === Track.Source.Camera)
      : null;
  // Manual pin wins, then an active screen share, then the active speaker.
  const focusTrack = (pinned && pinned[0]) || screenTrack || speakerTrack || null;
  const focusKey = refKey(focusTrack);
  const carousel = focusTrack ? shown.filter((t) => refKey(t) !== focusKey) : shown;

  return (
    <div className="relative flex-1 min-h-0">
      {focusTrack ? (
        <FocusLayoutContainer style={{ height: "100%" }}>
          <CarouselLayout tracks={carousel}>
            <ClusterParticipantTile />
          </CarouselLayout>
          <FocusLayout trackRef={focusTrack} />
        </FocusLayoutContainer>
      ) : (
        <GridLayout tracks={shown} style={{ height: "100%" }}>
          <ClusterParticipantTile />
        </GridLayout>
      )}

      <SpectatorList spectators={spectators} />
      {peopleOpen && <PeoplePanel roomId={roomId} onClose={onClosePeople} />}

      {/* Spectator → publisher. Rendered ON the overlay (the app's stage
          placeholder underneath is covered by this call). */}
      {!publish && !compact && (
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
  );
}

function ConferenceLayout({ compact, publish, onJoinIn, emote, roomId }) {
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

  const [layoutMode, setLayoutMode] = useState(() => loadPref(PREF.layout, "grid"));
  // Background effect descriptor: "none" | "blur:<radius>" | "image:<id|custom>".
  const [bg, setBg] = useState(() => loadPref(PREF.bg, "none"));
  const [customBg, setCustomBg] = useState(() => loadPref(PREF.bgCustom, "") || null);
  // Noise cancellation defaults ON (the whole point), where supported.
  const [noiseEnabled, setNoiseEnabled] = useState(() => loadPref(PREF.noise, "1") === "1");

  useEffect(() => savePref(PREF.layout, layoutMode), [layoutMode]);
  useEffect(() => savePref(PREF.bg, bg), [bg]);
  useEffect(() => savePref(PREF.noise, noiseEnabled ? "1" : "0"), [noiseEnabled]);

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
    <div ref={rootRef} className="flex flex-col w-full h-full">
      <EffectsController bg={bg} customBg={customBg} noiseEnabled={noiseEnabled} />
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
        <div className="shrink-0">
          <CallControlBar
            publish={publish}
            tight={tight}
            emote={emote}
            layoutMode={layoutMode}
            onToggleLayout={() => setLayoutMode((m) => (m === "speaker" ? "grid" : "speaker"))}
            bg={bg}
            onChangeBg={setBg}
            customBg={customBg}
            onUploadBg={onUploadBg}
            noiseEnabled={noiseEnabled}
            onToggleNoise={() => setNoiseEnabled((v) => !v)}
            peopleOpen={peopleOpen}
            onTogglePeople={() => setPeopleOpen((v) => !v)}
          />
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
        <ConferenceLayout compact={compact} publish={publish} onJoinIn={onJoinIn} emote={emote} roomId={roomId} />
        {/* Owns in-room cluster management (leader handoff). Mount once. */}
        <RoomClusterManager />
        {/* Required for participants to be audible — suppressed for in-room
            followers so the leader's speakers don't echo back through them. */}
        <ClusterAudioRenderer />
      </LiveKitRoom>
    </div>
  );
}
