import { useEffect, useMemo, useRef, useState } from "react";
import { Video, VideoOff, Mic, MicOff, Settings, Eye, LogIn, ArrowLeft, X, Sparkles, Volume2, VolumeX, Users } from "lucide-react";
import { usePreviewTracks, usePersistentUserChoices } from "@livekit/components-react";
import "@livekit/components-styles";
import { useTheme } from "../../context/ThemeContext";
import { useApp } from "../../context/AppContext";
import { useVideoCall } from "../../context/VideoCallContext";
import { Button } from "@/components/ui/button";
import UserAvatar from "../UserAvatar";
import { useRoomCallPresence } from "./useRoomCallPresence";
import { createRefinedBackgroundProcessor } from "./refinedBackground";
import { bgToOptions, loadBgPref, loadBgCustomPref, saveBgPref, BLUR_LEVELS, BG_PRESETS } from "./backgroundEffects";
import { PREF, loadPref, savePref } from "./callPrefs";

// Applies the SAME background processor the call uses to a pre-join preview
// track, driven by the shared localStorage pref — so the blur/background you see
// before joining is exactly what gets published. Returns [bg, setBg]; setBg
// persists, so the call picks it up when it mounts. Heavy (MediaPipe/RVM) so it
// only runs while a preview track exists and a background is actually selected.
function usePreviewBackground(videoTrack) {
  const [bg, setBgState] = useState(loadBgPref);
  const customBg = useMemo(() => loadBgCustomPref(), []);
  useEffect(() => {
    if (!videoTrack) return undefined;
    let active = true;
    (async () => {
      try {
        const opts = bgToOptions(bg, customBg);
        if (opts) {
          const proc = createRefinedBackgroundProcessor(opts);
          if (!active) return;
          await videoTrack.setProcessor(proc);
        } else {
          await videoTrack.stopProcessor();
        }
      } catch { /* leave the raw camera if the effect can't load */ }
    })();
    return () => { active = false; };
  }, [videoTrack, bg, customBg]);
  const setBg = (v) => { setBgState(v); saveBgPref(v); };
  return [bg, setBg];
}

// Compact background/blur picker for the pre-join. Writes the shared pref, so the
// choice carries into the call. Mirrors the in-call menu's None / blur levels /
// gradient presets.
function BgPicker({ bg, onChange }) {
  const [open, setOpen] = useState(false);
  const active = bg && bg !== "none";
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Background / blur"
        aria-label="Background / blur"
        className={`inline-flex items-center justify-center w-9 h-9 rounded-full shrink-0 transition-colors ${
          active ? "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]" : "bg-white/15 text-white hover:bg-white/25"
        }`}
      >
        <Sparkles className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 w-48 rounded-xl bg-slate-900/95 backdrop-blur p-1.5 text-white shadow-xl ring-1 ring-white/10">
          <div className="px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wider opacity-60">Background</div>
          <button
            type="button"
            onClick={() => { onChange("none"); setOpen(false); }}
            className={`w-full text-left px-2 py-1.5 rounded-md text-[12px] hover:bg-white/10 ${bg === "none" || !bg ? "bg-white/10" : ""}`}
          >
            None
          </button>
          {BLUR_LEVELS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => { onChange(l.id); setOpen(false); }}
              className={`w-full text-left px-2 py-1.5 rounded-md text-[12px] hover:bg-white/10 ${bg === l.id ? "bg-white/10" : ""}`}
            >
              Blur · {l.label}
            </button>
          ))}
          <div className="grid grid-cols-5 gap-1 px-1 pt-1.5">
            {BG_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.label}
                onClick={() => { onChange(`image:${p.id}`); setOpen(false); }}
                className={`h-7 rounded-md ring-1 ${bg === `image:${p.id}` ? "ring-white" : "ring-white/20"}`}
                style={{ backgroundImage: `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]})` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// A labelled on/off toggle row for the lobby settings popover — mirrors the
// in-call mic-menu toggles (noise cancellation, push-to-talk) so the lobby reads
// as the same settings surface.
function LobbyToggleRow({ label, hint, active, onClick }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={active}
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-1.5 text-left rounded-md hover:bg-white/10"
    >
      <span className="flex-1 min-w-0">
        <span className="block text-[12px]">{label}</span>
        {hint && <span className="block text-[10px] opacity-50">{hint}</span>}
      </span>
      <span className={`text-[10px] font-bold uppercase tracking-wide ${active ? "text-[var(--color-accent)]" : "opacity-50"}`}>
        {active ? "On" : "Off"}
      </span>
    </button>
  );
}

function DeviceSelect({ label, devices, value, onChange }) {
  return (
    <label className="block mb-1.5 last:mb-0">
      <span className="block text-[10px] uppercase tracking-wider opacity-60 mb-0.5">{label}</span>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md bg-white/10 px-2 py-1.5 text-[12px] outline-none cursor-pointer"
      >
        {devices.length === 0 && <option value="">System default</option>}
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId} className="text-slate-900">
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

// Shared lobby settings gear (camera / mic / speaker pickers + noise cancel +
// push-to-talk), used by BOTH pre-join surfaces — the start lobby (GreenRoom)
// and the watch-the-call lobby (SpectatePreJoin) — so they read as one settings
// surface. Speaker / noise / PTT write the SAME localStorage keys the live call
// reads, so the choices apply on join. Camera + mic device ids come from the
// caller's usePersistentUserChoices (LiveKit's own persistence).
function LobbySettingsGear({ videoDeviceId, onPickCamera, audioDeviceId, onPickMic }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const [devices, setDevices] = useState({ cams: [], mics: [], speakers: [] });
  const [spk, setSpk] = useState(() => loadPref(PREF.speaker, ""));
  const [noise, setNoise] = useState(() => loadPref(PREF.noise, "1") === "1");
  const [ptt, setPtt] = useState(() => loadPref(PREF.ptt, "0") === "1");
  const pickSpeaker = (id) => { setSpk(id); savePref(PREF.speaker, id); };
  const toggleNoise = () => setNoise((v) => { savePref(PREF.noise, v ? "0" : "1"); return !v; });
  const togglePtt = () => setPtt((v) => { savePref(PREF.ptt, v ? "0" : "1"); return !v; });

  // (Re)enumerate when opened so labels show after the media grant lands.
  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    navigator.mediaDevices?.enumerateDevices?.()
      .then((ds) => {
        if (!alive) return;
        setDevices({
          cams: ds.filter((d) => d.kind === "videoinput"),
          mics: ds.filter((d) => d.kind === "audioinput"),
          speakers: ds.filter((d) => d.kind === "audiooutput"),
        });
      })
      .catch(() => { /* not enumerable yet */ });
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => { alive = false; document.removeEventListener("mousedown", onDown); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Call settings"
        aria-label="Call settings"
        aria-expanded={open}
        className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/15 text-white hover:bg-white/25 shrink-0"
      >
        <Settings className="w-5 h-5" />
      </button>
      {open && (
        // Right-anchored (the gear is a right-side dock control) so it grows
        // inward and never spills off the panel. Width caps to the panel on a
        // narrow tile / PiP.
        <div className="absolute bottom-full mb-2 right-0 z-50 w-56 max-w-[calc(100vw-2rem)] max-h-[60vh] overflow-y-auto rounded-xl bg-slate-900/95 backdrop-blur p-2 text-white shadow-xl">
          <DeviceSelect label="Camera" devices={devices.cams} value={videoDeviceId} onChange={onPickCamera} />
          <DeviceSelect label="Microphone" devices={devices.mics} value={audioDeviceId} onChange={onPickMic} />
          {devices.speakers.length > 0 && (
            <DeviceSelect label="Speaker" devices={devices.speakers} value={spk} onChange={pickSpeaker} />
          )}
          <div className="my-1.5 border-t border-white/10" />
          <LobbyToggleRow label="Noise cancellation" active={noise} onClick={toggleNoise} />
          <LobbyToggleRow label="Push to talk" hint="hold Space in the call" active={ptt} onClick={togglePtt} />
        </div>
      )}
    </div>
  );
}

// Stable onError for usePreviewTracks — its effect deps are
// [JSON.stringify(options), onError, mutex], so an INLINE onError (new identity
// every render) re-runs the effect on every parent re-render, tearing down and
// rebuilding the preview track → the black↔feed flash. A module-level function
// is referentially stable, so the track is created once.
function logPreviewError(e) {
  console.warn("[greenroom]", e?.message);
}

// Pre-call "green room": a live camera preview that fills the tile, with mic /
// camera / device controls overlaid and the Join button PINNED so it's always
// visible (no scrolling — the old <PreJoin> overflowed a short tile). The
// preview config is memoized so usePreviewTracks builds the camera track ONCE —
// recreating it per render is what made it flash black↔feed. Collapses to a
// minimal card (avatar + Join) when the tile is squished. Device + toggle
// choices persist (one-tap rejoin) and become the `choices` we hand to the call.
function GreenRoom({ displayName, othersInCall, participants, onJoin, onWatch, onBack, dark }) {
  const {
    userChoices,
    saveAudioInputEnabled,
    saveVideoInputEnabled,
    saveAudioInputDeviceId,
    saveVideoInputDeviceId,
    // Camera OFF by default — walking up to a room shouldn't grab your webcam;
    // you opt in by toggling it on to preview. The choice persists thereafter.
  } = usePersistentUserChoices({ defaults: { username: displayName, videoEnabled: false, audioEnabled: true } });

  const camOn = userChoices.videoEnabled;
  const micOn = userChoices.audioEnabled;

  // Stable options → the preview track is created once; only rebuilt when the
  // camera is toggled or its device changes (NOT on every parent re-render).
  const trackOpts = useMemo(
    () => ({ audio: false, video: camOn ? { deviceId: userChoices.videoDeviceId || undefined } : false }),
    [camOn, userChoices.videoDeviceId],
  );
  const tracks = usePreviewTracks(trackOpts, logPreviewError);
  const videoTrack = useMemo(() => tracks?.find((t) => t.kind === "video"), [tracks]);
  // Apply your saved blur/background to the preview so you see (and can change)
  // it before starting the call; the choice carries through via the shared pref.
  const [bg, setBg] = usePreviewBackground(videoTrack);

  const videoRef = useRef(null);
  // Lock the preview to the camera's NATIVE aspect ratio so it shows the exact
  // framing you'll publish — object-cover filling an arbitrary tile cropped
  // differently than the call does, making it a misleading preview.
  const [previewAspect, setPreviewAspect] = useState(16 / 9);
  useEffect(() => {
    const el = videoRef.current;
    if (!videoTrack || !el) return undefined;
    videoTrack.attach(el);
    const onMeta = () => {
      if (el.videoWidth && el.videoHeight) setPreviewAspect(el.videoWidth / el.videoHeight);
    };
    el.addEventListener("loadedmetadata", onMeta);
    onMeta();
    return () => {
      el.removeEventListener("loadedmetadata", onMeta);
      try { videoTrack.detach(el); } catch { /* */ }
    };
  }, [videoTrack]);

  // Device + audio settings live in the shared <LobbySettingsGear> below.
  // "I'm in this room" — join the room's shared audio muted so co-located people
  // don't echo on entry. Persisted (a laptop that lives in the room stays set).
  const [inRoom, setInRoom] = useState(() => {
    try { return localStorage.getItem("mango:inRoomAudio") === "1"; } catch { return false; }
  });
  const toggleInRoom = () => setInRoom((v) => {
    const next = !v;
    try { localStorage.setItem("mango:inRoomAudio", next ? "1" : "0"); } catch { /* */ }
    return next;
  });

  // Responsive: collapse to a minimal card when the tile gets small.
  const wrapRef = useRef(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setCompact(el.clientHeight < 300 || el.clientWidth < 300));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const join = () => onJoin({
    username: userChoices.username || displayName,
    videoEnabled: camOn,
    audioEnabled: micOn,
    videoDeviceId: userChoices.videoDeviceId,
    audioDeviceId: userChoices.audioDeviceId,
    inRoom,
  });

  const inRoomToggle = (
    <button
      type="button"
      onClick={toggleInRoom}
      aria-pressed={inRoom}
      title={inRoom ? "You'll join muted (sharing this room's audio)" : "I'm in this room — join muted to avoid echo"}
      className={`inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-full text-[12px] font-semibold transition-colors shrink-0 ${
        inRoom ? "bg-[var(--color-accent)] text-white" : "bg-white/10 text-white/70 hover:bg-white/20"
      }`}
    >
      <Users className="w-4 h-4" /> {inRoom ? "In this room · muted" : "I'm in this room"}
    </button>
  );

  const toggleBtn = (active, OnIcon, OffIcon, title, onClick) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`inline-flex items-center justify-center w-10 h-10 rounded-full transition-colors shrink-0 ${
        active ? "bg-white/15 text-white hover:bg-white/25" : "bg-rose-500/90 text-white hover:bg-rose-500"
      }`}
    >
      {active ? <OnIcon className="w-5 h-5" /> : <OffIcon className="w-5 h-5" />}
    </button>
  );
  const toggles = (
    <>
      {toggleBtn(micOn, Mic, MicOff, micOn ? "Mute mic" : "Unmute mic", () => saveAudioInputEnabled(!micOn))}
      {toggleBtn(camOn, Video, VideoOff, camOn ? "Turn off camera" : "Turn on camera", () => saveVideoInputEnabled(!camOn))}
    </>
  );
  const joinRow = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={join}
        className="flex-1 inline-flex items-center justify-center gap-1.5 h-11 rounded-full bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white font-semibold shadow-lg"
      >
        <LogIn className="w-4 h-4" /> {othersInCall ? "Join call" : "Start call"}
      </button>
      {othersInCall && (
        <button
          type="button"
          onClick={onWatch}
          className="inline-flex items-center gap-1.5 h-11 px-4 rounded-full border border-white/20 text-white hover:bg-white/10 font-semibold"
        >
          <Eye className="w-4 h-4" /> Watch
        </button>
      )}
    </div>
  );

  return (
    <div
      ref={wrapRef}
      className={`relative w-full h-full rounded-xl overflow-hidden border flex flex-col ${
        dark ? "border-[var(--color-border)] bg-slate-950" : "border-slate-200 bg-slate-900"
      }`}
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="absolute top-3 left-3 z-20 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/70 hover:bg-black/90 text-white text-[13px] font-semibold shadow-lg ring-1 ring-white/15 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      )}

      {compact ? (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
          <UserAvatar url="" name={displayName} size={56} />
          <div className="text-white font-semibold text-sm">
            {othersInCall ? `${participants?.length || ""} in call` : "Start the call"}
          </div>
          <div className="flex items-center gap-2">{toggles}</div>
          {inRoomToggle}
          <div className="w-full max-w-[280px]">{joinRow}</div>
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-0 bg-black flex items-center justify-center">
            {camOn && videoTrack ? (
              // Centered box locked to the camera's aspect (letterboxed in the
              // tile) so the preview = what the call publishes, not a tile-shaped crop.
              <div
                className="relative max-w-full max-h-full overflow-hidden rounded-md"
                style={{ aspectRatio: String(previewAspect) }}
              >
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                  style={{ transform: "scaleX(-1)" }}
                />
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                <UserAvatar url="" name={displayName} size={64} />
                <span className="text-white/70 text-sm font-medium">Camera off</span>
              </div>
            )}
          </div>

          {othersInCall && (
            <div className="absolute top-2 right-2 z-10 inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/40 text-white text-[11px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {participants?.length || ""} in call
            </div>
          )}

          {/* Bottom dock — controls + Join, pinned to the tile's bottom edge as an
              absolute overlay so the CTA is ALWAYS visible. (As a flow sibling the
              Join row could get pushed below the tile when the aspect-locked
              preview filled the height — only the top few pixels showed.) */}
          <div className="absolute bottom-0 left-0 right-0 z-10 flex flex-col gap-2 p-3 bg-gradient-to-t from-black/85 via-black/45 to-transparent">
            <div className="flex items-center justify-center gap-2">
              {toggles}
              <BgPicker bg={bg} onChange={setBg} />
              <LobbySettingsGear
                videoDeviceId={userChoices.videoDeviceId}
                onPickCamera={saveVideoInputDeviceId}
                audioDeviceId={userChoices.audioDeviceId}
                onPickMic={saveAudioInputDeviceId}
              />
            </div>
            <div className="flex justify-center">{inRoomToggle}</div>
            {joinRow}
          </div>
        </>
      )}
    </div>
  );
}

// Watching-the-call lobby overlay. The LIVE CALL fills the tile behind this (the
// parent's stageRef) — "walk into the office, see everyone". This overlays the
// only dock (Join / Watch-audio / settings) plus an OPTIONAL small self-preview
// PiP. Camera stays OFF until you turn it on (persisted join intent never grabs
// the webcam); turning it on shows your processed self-view as the PiP so you can
// check yourself before joining. Join upgrades spectate→publish in place with
// these AV + background choices.
function SpectatePreJoin({ displayName, participants = [], listen, onToggleListen, onJoin, onLeave }) {
  const {
    userChoices, saveAudioInputEnabled, saveVideoInputEnabled,
    saveAudioInputDeviceId, saveVideoInputDeviceId,
  } = usePersistentUserChoices({ defaults: { username: displayName, videoEnabled: false, audioEnabled: true } });
  const camOn = userChoices.videoEnabled;
  const micOn = userChoices.audioEnabled;
  const [camPreview, setCamPreview] = useState(camOn);
  // "I'm in this room" — join the room's shared audio muted so people sitting
  // together don't echo. Persisted (a laptop that lives in the room stays set).
  const [inRoom, setInRoom] = useState(() => {
    try { return localStorage.getItem("mango:inRoomAudio") === "1"; } catch { return false; }
  });
  const toggleInRoom = () => setInRoom((v) => {
    const next = !v;
    try { localStorage.setItem("mango:inRoomAudio", next ? "1" : "0"); } catch { /* */ }
    return next;
  });

  const trackOpts = useMemo(
    () => ({ audio: false, video: camPreview ? { deviceId: userChoices.videoDeviceId || undefined } : false }),
    [camPreview, userChoices.videoDeviceId],
  );
  const tracks = usePreviewTracks(trackOpts, logPreviewError);
  const videoTrack = useMemo(() => tracks?.find((t) => t.kind === "video"), [tracks]);
  const [bg, setBg] = usePreviewBackground(videoTrack);

  const videoRef = useRef(null);
  const [aspect, setAspect] = useState(16 / 9);
  useEffect(() => {
    const el = videoRef.current;
    if (!videoTrack || !el) return undefined;
    videoTrack.attach(el);
    const onMeta = () => { if (el.videoWidth && el.videoHeight) setAspect(el.videoWidth / el.videoHeight); };
    el.addEventListener("loadedmetadata", onMeta);
    onMeta();
    return () => {
      el.removeEventListener("loadedmetadata", onMeta);
      try { videoTrack.detach(el); } catch { /* */ }
    };
  }, [videoTrack]);

  const join = () => onJoin({
    username: userChoices.username || displayName,
    videoEnabled: camPreview,
    audioEnabled: micOn,
    videoDeviceId: userChoices.videoDeviceId,
    audioDeviceId: userChoices.audioDeviceId,
    inRoom,
  });

  const T = (active, OnIcon, OffIcon, title, onClick) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`inline-flex items-center justify-center w-10 h-10 rounded-full shrink-0 transition-colors ${
        active ? "bg-white/15 text-white hover:bg-white/25" : "bg-rose-500/90 text-white hover:bg-rose-500"
      }`}
    >
      {active ? <OnIcon className="w-5 h-5" /> : <OffIcon className="w-5 h-5" />}
    </button>
  );

  return (
    <>
      {/* "You're watching" pill, top-left, over the live call. */}
      <div className="absolute top-3 left-3 z-40 inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur text-white text-[11px] font-semibold pointer-events-none">
        <Eye className="w-3.5 h-3.5 opacity-80" />
        Watching{participants.length ? ` · ${participants.length} in call` : ""}
      </div>

      {/* Optional self-preview PiP (only when you turn your camera on to check
          yourself before joining) — small, bottom-left, above the dock. When the
          camera's off there's no PiP at all; the live call just fills. */}
      {camPreview && videoTrack && (
        <div
          className="absolute bottom-20 left-3 z-40 w-32 sm:w-40 rounded-lg overflow-hidden ring-1 ring-white/25 shadow-2xl bg-slate-900"
          style={{ aspectRatio: String(aspect) }}
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
            style={{ transform: "scaleX(-1)" }}
          />
          <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/55 text-white text-[9px] font-medium">You</span>
        </div>
      )}

      {/* Control dock. */}
      <div className="absolute inset-x-0 bottom-4 z-40 flex justify-center pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-900/85 backdrop-blur px-2.5 py-2 shadow-xl ring-1 ring-white/10">
          {T(micOn, Mic, MicOff, micOn ? "Join with mic on" : "Join muted", () => saveAudioInputEnabled(!micOn))}
          {T(camPreview, Video, VideoOff, camPreview ? "Turn camera off" : "Turn camera on to preview", () => {
            const next = !camPreview;
            setCamPreview(next);
            saveVideoInputEnabled(next);
          })}
          {/* Listen — OFF by default so auto-preview is silent (no in-room
              feedback). Neutral (not alarming) styling since muted is the safe state. */}
          <button
            type="button"
            onClick={onToggleListen}
            title={listen ? "Mute the call preview" : "Listen to the call"}
            aria-label={listen ? "Mute the call preview" : "Listen to the call"}
            className={`inline-flex items-center justify-center w-10 h-10 rounded-full shrink-0 transition-colors ${
              listen ? "bg-white/15 text-white hover:bg-white/25" : "bg-white/10 text-white/55 hover:bg-white/20"
            }`}
          >
            {listen ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>
          {/* In this room — join the shared audio muted so co-located people
              don't echo on entry. */}
          <button
            type="button"
            onClick={toggleInRoom}
            title={inRoom ? "You'll join muted (sharing this room's audio)" : "I'm in this room — join muted to avoid echo"}
            aria-label="I'm in this room"
            aria-pressed={inRoom}
            className={`inline-flex items-center justify-center w-10 h-10 rounded-full shrink-0 transition-colors ${
              inRoom ? "bg-[var(--color-accent)] text-white" : "bg-white/10 text-white/55 hover:bg-white/20"
            }`}
          >
            <Users className="w-5 h-5" />
          </button>
          <BgPicker bg={bg} onChange={setBg} />
          <LobbySettingsGear
            videoDeviceId={userChoices.videoDeviceId}
            onPickCamera={saveVideoInputDeviceId}
            audioDeviceId={userChoices.audioDeviceId}
            onPickMic={saveAudioInputDeviceId}
          />
          <button
            type="button"
            onClick={join}
            className="inline-flex items-center gap-1.5 h-10 px-5 rounded-full bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-[13px] font-semibold"
          >
            <LogIn className="w-4 h-4" /> Join call
          </button>
          <button
            type="button"
            onClick={onLeave}
            title="Stop watching"
            aria-label="Stop watching"
            className="inline-flex items-center justify-center w-10 h-10 rounded-full text-white/70 hover:text-white hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </>
  );
}

// What goes in the room view's video tile.
//
// Join model (deliberately NOT auto-join from the hallway):
//   • Enter a room from the hallway → you choose. The <GreenRoom> (live camera
//     preview + always-visible Join, no camera grab until you open it) lets you
//     pick + preview camera/mic before joining, or "Just watch" to spectate
//     (see/hear everyone without publishing).
//   • The ONLY auto-join is carry-over: if you're already in a call and move
//     rooms, the call follows you (handled in PersistentVideoCall).
//
// When you're in the call, the real media is owned by PersistentVideoCall at
// the app shell (so it survives navigation); this component just hands it a
// stageRef to position over and renders the spectate "Join in" affordance.
export default function RoomVideoStage({ roomId, displayName }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { session } = useApp();
  const userId = session?.user?.id;

  const { call, startCall, setStageEl, updateCall, endCall } = useVideoCall();
  const inCall = call?.roomId === roomId;
  const spectating = inCall && call?.mode === "spectate";
  // In a call somewhere else → carry-over is about to move it here; show a
  // neutral placeholder rather than flashing the pre-join card.
  const inAnotherCall = !!call && call.roomId !== roomId;

  const stageRef = useRef(null);
  useEffect(() => {
    if (!inCall) return;
    setStageEl(stageRef.current);
    return () => setStageEl(null);
  }, [inCall, setStageEl]);

  // `dismissed` (set when you Stop watching) stops us immediately re-spectating;
  // it resets when you move to another room so re-entering previews again.
  const [dismissed, setDismissed] = useState(false);
  const autoRef = useRef(false);
  const wasInCallRef = useRef(false);
  useEffect(() => { setDismissed(false); autoRef.current = false; }, [roomId]);

  // If a spectate session ends without "Stop watching", allow auto-preview to retry.
  useEffect(() => {
    if (wasInCallRef.current && !inCall && !dismissed) autoRef.current = false;
    wasInCallRef.current = inCall;
  }, [inCall, dismissed]);

  // Spectators announce as "observe" so they don't show up as participants
  // in the room's call-presence; publishers announce as "join".
  const observed = useRoomCallPresence({
    roomId, userId, displayName,
    mode: inCall && !spectating ? "join" : "observe",
  });
  const othersInCall = observed.isAnyoneInCall;

  const join = (choices) => startCall(roomId, displayName, { mode: "join", choices });
  const watch = () => startCall(roomId, displayName, { mode: "spectate" });

  // Auto-preview: when others are already in the call, drop straight into a live
  // subscribe-only spectate so you SEE the room before deciding, instead of a
  // static card. SILENT by default (listen:false) — auto-playing the call audio
  // the moment you walk up risks an in-room feedback loop (your speaker replaying
  // the call into a nearby participant's mic). Tap Listen in the dock to hear.
  // `autoRef` fires it once per room visit; `dismissed` respects "Stop watching".
  useEffect(() => {
    if (othersInCall && !inCall && !inAnotherCall && !dismissed && !autoRef.current) {
      autoRef.current = true;
      startCall(roomId, displayName, { mode: "spectate", listen: false });
    }
  }, [othersInCall, inCall, inAnotherCall, dismissed, roomId, displayName, startCall]);

  // ── In the call ──────────────────────────────────────────────
  // The persistent call (LiveKitCall) portals INTO stageRef. stageRef ALWAYS
  // fills the tile — the live call is the big thing the moment you're connected,
  // whether you're spectating ("walk into the office, see everyone") or joined.
  // While spectating, the call renders CHROMELESS (its own bar suppressed, see
  // PersistentVideoCall) and SpectatePreJoin overlays the only dock (z-40) plus
  // an OPTIONAL small self-preview PiP. stageRef keeps the same element across
  // spectate↔join (only siblings change), so the call never re-glues on join.
  if (inCall) {
    return (
      <div className="relative w-full h-full rounded-xl overflow-hidden" style={{ background: "#0f172a" }}>
        <div ref={stageRef} className="absolute inset-0" />
        {spectating && (
          <SpectatePreJoin
            displayName={displayName}
            participants={observed.participants}
            listen={call?.listen === true}
            onToggleListen={() => updateCall({ listen: !(call?.listen === true) })}
            onJoin={(choices) => updateCall({ mode: "join", choices })}
            onLeave={() => { setDismissed(true); endCall(); }}
          />
        )}
      </div>
    );
  }

  // ── Carry-over in flight ─────────────────────────────────────
  if (inAnotherCall) {
    return <div className="w-full h-full rounded-xl overflow-hidden bg-slate-900" aria-label="Moving your call" />;
  }

  const shellCls = `relative w-full h-full rounded-xl border overflow-hidden flex flex-col ${
    dark ? "border-[var(--color-border)] bg-[var(--color-surface)]" : "border-slate-200 bg-slate-900"
  }`;

  // ── Others in the call ───────────────────────────────────────
  // The auto-preview effect drops you straight into a live (muted) spectate so
  // you SEE the call the moment you walk up. While that connects, show a neutral
  // fill rather than flashing a card for a frame.
  if (othersInCall && !dismissed) {
    return (
      <div className={`${shellCls} items-center justify-center`}>
        <span className="text-white/55 text-sm font-medium">Connecting preview…</span>
      </div>
    );
  }

  // ── You stopped watching, but a call is still running ────────
  // A compact rejoin card (not the full lobby) — peek at who's in, then Join or
  // watch again.
  if (othersInCall && dismissed) {
    return (
      <div className={`${shellCls} items-center justify-center text-center px-6`}>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <p className="text-sm font-semibold text-white">{observed.participants.length} in call</p>
        </div>
        <div className="flex items-center justify-center gap-1.5 mb-4">
          {observed.participants.slice(0, 6).map((p) => (
            <span key={p.user_id} className="ring-2 ring-white/30 rounded-full">
              <UserAvatar url="" name={p.display_name || "Member"} size={32} />
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            onClick={watch}
            className="rounded-full bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white"
          >
            <Eye className="w-4 h-4 mr-1.5" /> Watch again
          </Button>
          <Button
            onClick={() => join({ videoEnabled: false, audioEnabled: true })}
            variant="outline"
            className="rounded-full border-white/20 text-white hover:bg-white/10"
          >
            <LogIn className="w-4 h-4 mr-1.5" /> Join call
          </Button>
        </div>
      </div>
    );
  }

  // ── Empty room → the start lobby directly (no choice-card hop) ───────────────
  // GreenRoom IS the lobby: self-preview (camera off until you opt in) + a
  // primary "Start call". No Back — there's nothing behind it now.
  return (
    <GreenRoom
      displayName={displayName}
      othersInCall={othersInCall}
      participants={observed.participants}
      onJoin={(choices) => join(choices)}
      onWatch={watch}
      onBack={null}
      dark={dark}
    />
  );
}
