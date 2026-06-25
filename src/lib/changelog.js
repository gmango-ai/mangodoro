// The changelog is the single source of truth for "what's new". CHANGELOG.md is
// bundled at build time (?raw), and the newest "## …" heading is used as the
// release marker the in-app prompt compares against what the user last saw.
import raw from "../../CHANGELOG.md?raw";

export const changelogMarkdown = raw;

// Build version, injected by vite (define). Guarded so tests/SSR don't crash.
export const appVersion =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";

// The newest release marker = the first top-level "## …" heading (newest first).
export function latestEntryId() {
  const m = raw.match(/^##[ \t]+(.+)$/m);
  return m ? m[1].trim() : "";
}

// CHANGELOG.md for display: drop the redundant "# Changelog" H1 (the modal has
// its own title) but keep the intro paragraph.
export function changelogBody() {
  return raw.replace(/^#[ \t]+Changelog[ \t]*\n/, "");
}
