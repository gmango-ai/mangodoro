# Meeting timer music

Drop MP3 (or any browser-playable audio) files into this directory.
The track list the in-room timer reads from lives in
`src/lib/meetingTimerTracks.js` — each entry's `src` resolves under
this folder (e.g. `lofi.mp3` → `/music/lofi.mp3` at runtime).

Filenames referenced today:

- `lofi.mp3`     — "Lo-fi loop"
- `focus.mp3`    — "Focus tones"
- `ambient.mp3`  — "Ambient pad"

Missing files are tolerated — the timer still runs, the audio element
just silently fails to load and the UI shows a "No audio" badge. So
you can ship without all three and add them over time.

A future PR will move this list into Supabase Storage so teams can
upload their own tracks without redeploying.
