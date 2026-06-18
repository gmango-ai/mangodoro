// Curated track list for the in-room meeting timer.
//
// Each entry has:
//   id    — stable identifier persisted to sync_sessions.meeting_timer_track.
//           Do NOT rename existing ids; if a track is removed, in-flight
//           timers fall back to "no audio" gracefully.
//   label — short display name shown in the picker
//   src   — public URL (anything an HTMLAudioElement can load). The
//           default entries point under /music/ which maps to /public/music/
//           — drop your MP3s there. See public/music/README.md.
//
// The list is intentionally short. A future PR can pull tracks from
// Supabase Storage so teams can upload their own.

export const TIMER_TRACKS = [
  { id: "none",         label: "No music",     src: null },
  { id: "lofi",         label: "Lo-fi loop",   src: "/music/lofi.mp3" },
  { id: "focus",        label: "Focus tones",  src: "/music/focus.mp3" },
  { id: "ambient",      label: "Ambient pad",  src: "/music/ambient.mp3" },
];

export function findTrack(id) {
  if (!id) return TIMER_TRACKS[0];
  return TIMER_TRACKS.find((t) => t.id === id) || TIMER_TRACKS[0];
}

export const TIMER_DURATION_PRESETS = [
  { id: "5",  label: "5 min",  seconds: 5 * 60 },
  { id: "10", label: "10 min", seconds: 10 * 60 },
  { id: "15", label: "15 min", seconds: 15 * 60 },
  { id: "25", label: "25 min", seconds: 25 * 60 },
  { id: "45", label: "45 min", seconds: 45 * 60 },
];
