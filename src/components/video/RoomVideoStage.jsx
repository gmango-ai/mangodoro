import { useEffect, useMemo, useRef, useState } from "react";
import { Video, VideoOff, Mic, MicOff, Settings, Eye, LogIn, ArrowLeft, X, Sparkles, Volume2, VolumeX } from "lucide-react";
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
  } = usePersistentUserChoices({ defaults: { username: displayName, videoEnabled: true, audioEnabled: true } });

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

  // Device lists (re-enumerate once the camera grant lands so labels show).
  const [devices, setDevices] = useState({ cams: [], mics: [] });
  useEffect(() => {
    let alive = true;
    navigator.mediaDevices?.enumerateDevices?.()
      .then((ds) => {
        if (!alive) return;
        setDevices({
          cams: ds.filter((d) => d.kind === "videoinput"),
          mics: ds.filter((d) => d.kind === "audioinput"),
        });
      })
      .catch(() => { /* not enumerable yet */ });
    return () => { alive = false; };
  }, [camOn, videoTrack]);

  const [gearOpen, setGearOpen] = useState(false);

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
  });

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
      <button
        type="button"
        onClick={onBack}
        className="absolute top-3 left-3 z-20 inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/70 hover:bg-black/90 text-white text-[13px] font-semibold shadow-lg ring-1 ring-white/15 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      {compact ? (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
          <UserAvatar url="" name={displayName} size={56} />
          <div className="text-white font-semibold text-sm">
            {othersInCall ? `${participants?.length || ""} in call` : "Start the call"}
          </div>
          <div className="flex items-center gap-2">{toggles}</div>
          <div className="w-full max-w-[280px]">{joinRow}</div>
        </div>
      ) : (
        <>
          <div className="relative flex-1 min-h-0 bg-black flex items-center justify-center">
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

            {othersInCall && (
              <div className="absolute top-2 right-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/40 text-white text-[11px] font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {participants?.length || ""} in call
              </div>
            )}

            {/* Overlaid controls — float on the preview, never push the CTA down. */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
              {toggles}
              <BgPicker bg={bg} onChange={setBg} />
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setGearOpen((v) => !v)}
                  title="Devices"
                  aria-label="Choose devices"
                  className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/15 text-white hover:bg-white/25 shrink-0"
                >
                  <Settings className="w-5 h-5" />
                </button>
                {gearOpen && (
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-56 rounded-xl bg-slate-900/95 backdrop-blur p-2 text-white shadow-xl">
                    <DeviceSelect label="Camera" devices={devices.cams} value={userChoices.videoDeviceId} onChange={saveVideoInputDeviceId} />
                    <DeviceSelect label="Microphone" devices={devices.mics} value={userChoices.audioDeviceId} onChange={saveAudioInputDeviceId} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Pinned footer — Join is ALWAYS visible. */}
          <div className="shrink-0 p-3 bg-gradient-to-t from-black/70 via-black/40 to-transparent -mt-px">
            {joinRow}
          </div>
        </>
      )}
    </div>
  );
}

// Pre-join experience for a room that's ALREADY in a call: your own camera shown
// big (proper call size) with your blur/background applied; the parent shrinks the
// live call (others) into a corner. Camera stays OFF until you explicitly turn it
// on here (persisted join intent never grabs the webcam), then the hero shows your
// processed self-view. Join upgrades spectate→publish in place with these AV +
// background choices. Returns a fragment (hero + control dock) so the parent can
// keep the live-call corner as a stable sibling.
function SpectatePreJoin({ displayName, listen, onToggleListen, onJoin, onLeave }) {
  const { userChoices, saveAudioInputEnabled, saveVideoInputEnabled } =
    usePersistentUserChoices({ defaults: { username: displayName, videoEnabled: false, audioEnabled: true } });
  const camOn = userChoices.videoEnabled;
  const micOn = userChoices.audioEnabled;
  const [camPreview, setCamPreview] = useState(camOn);

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
    videoEnabled: camOn,
    audioEnabled: micOn,
    videoDeviceId: userChoices.videoDeviceId,
    audioDeviceId: userChoices.audioDeviceId,
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
      {/* Hero self-preview (z-0, behind the corner call). */}
      <div className="absolute inset-0 z-0 flex items-center justify-center p-3">
        {camPreview && videoTrack ? (
          <div
            className="relative max-w-full max-h-full rounded-xl overflow-hidden shadow-2xl"
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
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-center">
            <UserAvatar url="" name={displayName} size={72} />
            <span className="text-white/70 text-sm font-medium">Camera off — turn it on to preview</span>
          </div>
        )}
      </div>

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
          <BgPicker bg={bg} onChange={setBg} />
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
  const [setupOpen, setSetupOpen] = useState(false);

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
    if (othersInCall && !inCall && !inAnotherCall && !setupOpen && !dismissed && !autoRef.current) {
      autoRef.current = true;
      startCall(roomId, displayName, { mode: "spectate", listen: false });
    }
  }, [othersInCall, inCall, inAnotherCall, setupOpen, dismissed, roomId, displayName, startCall]);

  // ── In the call ──────────────────────────────────────────────
  // The persistent call (LiveKitCall) portals INTO stageRef. stageRef stays the
  // SAME element across spectate↔join (only its className changes), so the call
  // never re-glues / flashes PiP on join. When SPECTATING it's shrunk to a corner
  // (z-30) and SpectatePreJoin renders your big self-preview behind it (z-0) + the
  // control dock (z-40); when JOINED it fills the tile. The pre-join pieces are
  // SIBLINGS of stageRef, never children, so React nodes and the manual call host
  // don't share a parent.
  if (inCall) {
    return (
      <div className="relative w-full h-full rounded-xl overflow-hidden" style={{ background: "#0f172a" }}>
        <div
          ref={stageRef}
          className={spectating
            ? "absolute top-3 right-3 w-40 sm:w-52 lg:w-60 aspect-video rounded-lg overflow-hidden ring-1 ring-white/25 shadow-2xl z-30 bg-slate-900"
            : "absolute inset-0"}
        />
        {spectating && (
          <SpectatePreJoin
            displayName={displayName}
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

  // ── Green room (camera preview + always-visible Join) ────────
  if (setupOpen) {
    return (
      <GreenRoom
        displayName={displayName}
        othersInCall={othersInCall}
        participants={observed.participants}
        onJoin={(choices) => join(choices)}
        onWatch={watch}
        onBack={() => setSetupOpen(false)}
        dark={dark}
      />
    );
  }

  // ── Auto-preview connecting ──────────────────────────────────
  // Others are in the call and we haven't been dismissed → the effect above is
  // about to flip us into spectate. Show a neutral fill instead of flashing the
  // choice card for a frame.
  if (othersInCall && !dismissed) {
    return (
      <div className={`${shellCls} items-center justify-center`}>
        <span className="text-white/55 text-sm font-medium">Connecting preview…</span>
      </div>
    );
  }

  // ── Choice card (you dismissed the preview, or no one's in the call) ─────────
  return (
    <div className={`${shellCls} items-center justify-center text-center px-6`}>
      {othersInCall ? (
        <>
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
        </>
      ) : (
        <>
          <div className="p-3 rounded-full bg-white/10 backdrop-blur-sm mb-3">
            <Video className="w-6 h-6 text-white/80" />
          </div>
          <p className="text-sm font-semibold text-white">No one's in the call</p>
          <p className="text-xs text-white/60 max-w-[320px] mt-1 mb-4">
            Set up your camera and mic, then start a call — teammates in this room get a join prompt.
          </p>
        </>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          onClick={() => setSetupOpen(true)}
          className="rounded-full bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white"
        >
          <LogIn className="w-4 h-4 mr-1.5" />
          {othersInCall ? "Set up & join" : "Set up & start"}
        </Button>
        {othersInCall && (
          <Button
            onClick={watch}
            variant="outline"
            className="rounded-full border-white/20 text-white hover:bg-white/10"
          >
            <Eye className="w-4 h-4 mr-1.5" />
            Just watch
          </Button>
        )}
      </div>
      <p className="text-[11px] text-white/50 mt-3">
        {othersInCall ? "Watch without turning on your camera, or set up and join in." : "Your camera + mic stay off until you start."}
      </p>
    </div>
  );
}
