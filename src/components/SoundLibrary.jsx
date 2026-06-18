import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Volume2, VolumeX, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "../context/ThemeContext";
import SoundCard from "./SoundCard";
import FileDropZone from "./FileDropZone";
import {
  POMODORO_SOUND_PRESETS,
  USER_SOUND_PREFIX,
  TEAM_SOUND_PREFIX,
  playCompletionSound,
  stopCompletionSound,
  warmupAudioContext,
} from "../lib/pomodoroSound";

const CATEGORY_LABELS = {
  calm: "Calm",
  standard: "Standard",
  aggressive: "Loud",
};

// Unified sound library — used both for managing your alarms in
// Settings and for picking them inside the timer's sound panel. The
// card primitive is identical in both surfaces; what changes is the
// header (upload vs playback controls) and which overflow actions are
// available per card.
//
// Props:
//   mode             "manage" | "pick"
//   userSounds       custom sounds the current user owns (rename/delete in manage)
//   teamSounds       custom sounds from the active team (read-only here)
//   soundSettings    { workEndPreset, breakEndPreset, volume, pitch, repeat }
//   onSelectFocus(presetId)
//   onSelectBreak(presetId)
//   onUpdateSettings(patch)   used by pick mode for volume/pitch/repeat
//   onAddSound(file)          manage only
//   onRenameSound(id, name)   manage only
//   onRemoveSound(sound)      manage only
//   onError(message)          upload reject / playback errors
export default function SoundLibrary({
  mode = "pick",
  userSounds = [],
  teamSounds = [],
  soundSettings,
  onSelectFocus,
  onSelectBreak,
  onUpdateSettings,
  onAddSound,
  onRenameSound,
  onRemoveSound,
  onError,
}) {
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [previewingId, setPreviewingId] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const previewTimeoutRef = useRef(null);

  // Stop any in-flight preview when the library unmounts (e.g. the
  // Sound panel collapses in the timer). Otherwise a card's audio
  // would keep ringing into the next view.
  useEffect(() => {
    return () => {
      stopCompletionSound();
      if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    };
  }, []);

  // Single lookup for resolving custom sound previews, keyed by the
  // preset id format used everywhere (usound:id / tsound:id).
  const customSoundsByPresetId = useMemo(() => {
    const map = {};
    for (const s of userSounds) {
      if (s?.url) map[`${USER_SOUND_PREFIX}${s.id}`] = { url: s.url, name: s.name };
    }
    for (const s of teamSounds) {
      if (s?.url) map[`${TEAM_SOUND_PREFIX}${s.id}`] = { url: s.url, name: s.name };
    }
    return map;
  }, [userSounds, teamSounds]);

  function handlePreview(presetId) {
    if (previewingId === presetId) {
      stopCompletionSound();
      setPreviewingId(null);
      if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
      return;
    }
    stopCompletionSound();
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    setPreviewingId(presetId);
    warmupAudioContext();
    playCompletionSound(
      { ...soundSettings, repeat: 1 },
      { presetId, customSoundsByPresetId },
    ).catch(() => onError?.("Couldn't play sound"));
    // Best-effort visual clear after a generous window. Synth recipes
    // top out around 4s; file sounds up to 5MB are usually <30s. If
    // the user hits a different card before this fires, we cancel
    // above and reset cleanly.
    previewTimeoutRef.current = setTimeout(() => {
      setPreviewingId((curr) => (curr === presetId ? null : curr));
    }, 6000);
  }

  async function handleAdd(file) {
    if (!file || !onAddSound) return;
    setUploading(true);
    try {
      await onAddSound(file);
    } finally {
      setUploading(false);
    }
  }

  // Header content differs by mode.
  let header = null;
  if (mode === "manage") {
    header = (
      <FileDropZone
        accept={{ "audio/*": [] }}
        maxSize={5 * 1024 * 1024}
        uploading={uploading}
        buttonLabel="Upload sound"
        uploadingLabel="Uploading…"
        hint="MP3 / WAV / OGG / M4A / FLAC · up to 5 MB"
        onFile={handleAdd}
        onReject={onError}
      />
    );
  } else if (mode === "pick" && soundSettings && onUpdateSettings) {
    header = (
      <PlaybackControls
        dark={dark}
        settings={soundSettings}
        onUpdate={onUpdateSettings}
        advancedOpen={advancedOpen}
        onToggleAdvanced={() => setAdvancedOpen((v) => !v)}
        onStop={() => { stopCompletionSound(); setPreviewingId(null); }}
        anythingPlaying={previewingId != null}
      />
    );
  }

  // Build the section list once.
  const sections = [];
  if (userSounds.length > 0) {
    sections.push({
      key: "user",
      title: "Your sounds",
      items: userSounds.map((s) => ({
        presetId: `${USER_SOUND_PREFIX}${s.id}`,
        label: s.name || "Untitled sound",
        sublabel: "Custom",
        sound: s,
        owned: true,
      })),
    });
  }
  if (teamSounds.length > 0) {
    sections.push({
      key: "team",
      title: "Team sounds",
      items: teamSounds.map((s) => ({
        presetId: `${TEAM_SOUND_PREFIX}${s.id}`,
        label: s.name || "Untitled sound",
        sublabel: "Team",
        sound: s,
        owned: false,
      })),
    });
  }
  for (const cat of ["calm", "standard", "aggressive"]) {
    const items = POMODORO_SOUND_PRESETS.filter((p) => p.category === cat).map((p) => ({
      presetId: p.id,
      label: p.label,
      sublabel: null,
      sound: p,
      owned: false,
    }));
    if (items.length > 0) {
      sections.push({ key: cat, title: CATEGORY_LABELS[cat] || cat, items });
    }
  }

  // Empty state for manage mode when the user has zero custom sounds
  // and there are no team sounds either. The presets section still
  // covers them, so we don't need a separate empty card.
  const isEmpty = userSounds.length === 0 && teamSounds.length === 0;

  return (
    <div className="space-y-4">
      {header}

      {mode === "manage" && isEmpty && (
        <p className={`text-xs px-1 ${dark ? "text-slate-400" : "text-slate-500"}`}>
          Upload your own alarm, or pick from the built-in sounds below.
        </p>
      )}

      <div className="space-y-4">
        {sections.map((section) => (
          <section key={section.key} className="space-y-1.5">
            <h4
              className={`text-[10px] font-semibold uppercase tracking-wider px-1 ${
                dark ? "text-slate-500" : "text-slate-400"
              }`}
            >
              {section.title}
            </h4>
            <div className="space-y-2">
              {section.items.map((item) => (
                <SoundCard
                  key={item.presetId}
                  dark={dark}
                  label={item.label}
                  sublabel={item.sublabel}
                  isPlaying={previewingId === item.presetId}
                  isFocusSound={soundSettings?.workEndPreset === item.presetId}
                  isBreakSound={soundSettings?.breakEndPreset === item.presetId}
                  canRename={mode === "manage" && item.owned}
                  canRemove={mode === "manage" && item.owned}
                  onTogglePreview={() => handlePreview(item.presetId)}
                  onSetAsFocus={() => onSelectFocus?.(item.presetId)}
                  onSetAsBreak={() => onSelectBreak?.(item.presetId)}
                  onRename={(name) => onRenameSound?.(item.sound.id, name)}
                  onRemove={() => onRemoveSound?.(item.sound)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function PlaybackControls({ dark, settings, onUpdate, advancedOpen, onToggleAdvanced, onStop, anythingPlaying }) {
  const vol = Math.round((settings?.volume ?? 0.75) * 100);
  const pitch = settings?.pitch ?? 1;
  const repeat = settings?.repeat ?? 1;

  return (
    <div
      className={`space-y-3 rounded-xl border p-3 ${
        dark ? "bg-[var(--color-surface-raised)] border-[var(--color-border)]" : "bg-slate-50 border-slate-200"
      }`}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onUpdate({ volume: vol === 0 ? 0.75 : 0 })}
          aria-label={vol === 0 ? "Unmute" : "Mute"}
          className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
            dark ? "text-slate-300 hover:bg-slate-700/50" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {vol === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={vol}
          onChange={(e) => onUpdate({ volume: Number(e.target.value) / 100 })}
          aria-label="Volume"
          className="flex-1 accent-[var(--color-accent)]"
        />
        <span className={`w-10 text-right text-xs font-mono tabular-nums ${dark ? "text-slate-400" : "text-slate-500"}`}>
          {vol}%
        </span>
      </div>

      <button
        type="button"
        onClick={onToggleAdvanced}
        className={`w-full flex items-center justify-between text-[11px] font-semibold py-1 ${
          dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"
        }`}
      >
        <span className="uppercase tracking-wider">Advanced</span>
        {advancedOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {advancedOpen && (
        <div className="space-y-3">
          <label className="flex items-center gap-3">
            <span className={`shrink-0 w-12 text-[11px] font-semibold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-500"}`}>
              Pitch
            </span>
            <input
              type="range"
              min={50}
              max={150}
              value={Math.round(pitch * 100)}
              onChange={(e) => onUpdate({ pitch: Number(e.target.value) / 100 })}
              aria-label="Pitch"
              className="flex-1 accent-[var(--color-accent)]"
            />
            <span className={`w-12 text-right text-xs font-mono tabular-nums ${dark ? "text-slate-400" : "text-slate-500"}`}>
              {pitch.toFixed(2)}×
            </span>
          </label>

          <div className="flex items-center gap-3">
            <span className={`shrink-0 w-12 text-[11px] font-semibold uppercase tracking-wider ${dark ? "text-slate-400" : "text-slate-500"}`}>
              Repeat
            </span>
            <div className="flex-1 flex items-center gap-1">
              {[
                { value: 1, label: "1×" },
                { value: 2, label: "2×" },
                { value: 3, label: "3×" },
                { value: 5, label: "5×" },
                { value: 0, label: "∞" },
              ].map((opt) => {
                const active = repeat === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onUpdate({ repeat: opt.value })}
                    aria-pressed={active}
                    className={`flex-1 h-7 rounded-md text-xs font-semibold transition-colors ${
                      active
                        ? "bg-[var(--color-accent)] text-white shadow-sm"
                        : dark
                          ? "bg-slate-700/40 text-slate-300 hover:bg-slate-700"
                          : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {anythingPlaying && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onStop}
          className="w-full h-8 text-xs"
        >
          <Square className="w-3 h-3 mr-1.5" fill="currentColor" /> Stop sound
        </Button>
      )}
    </div>
  );
}
