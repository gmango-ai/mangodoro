import { lazy, Suspense } from "react";

// The one full emoji picker used everywhere (chat reactions, the emote bar).
// emoji-picker-react is heavy, so it's code-split and only loads when a "+ more"
// affordance is opened. Config is centralised here so the theme + sizing stay
// identical across surfaces.
const EmojiPicker = lazy(() => import("emoji-picker-react"));

export default function FullEmojiPicker({ onPick, dark, width = 300, height = 380 }) {
  return (
    <Suspense fallback={null}>
      <EmojiPicker
        onEmojiClick={(d) => onPick?.(d.emoji)}
        theme={dark ? "dark" : "light"}
        // native so it matches the native glyphs in the quick-reaction strips
        // (and skips loading the Apple-image sprite sheet).
        emojiStyle="native"
        width={width}
        height={height}
        lazyLoadEmojis
        autoFocusSearch={false}
        skinTonesDisabled
        previewConfig={{ showPreview: false }}
        searchPlaceholder="Search emoji"
      />
    </Suspense>
  );
}
