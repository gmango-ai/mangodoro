// The changelog is the single source of truth for "what's new". CHANGELOG.md is
// bundled at build time (?raw). The newest section (heading + body) is the
// release marker the in-app prompt compares against what the user last saw.
import raw from "../../CHANGELOG.md?raw";

export const changelogMarkdown = raw;

// Build version, injected by vite (define). Guarded so tests/SSR don't crash.
export const appVersion =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";

// The newest section heading (for display).
export function latestEntryId() {
  const m = raw.match(/^##[ \t]+(.+)$/m);
  return m ? m[1].trim() : "";
}

// Release marker for the in-app prompt: the full newest section (heading +
// bullets). Same-day CI merges add bullets without changing the heading, so
// comparing the whole section catches fresh updates under an unchanged date.
export function latestReleaseMarker() {
  const m = raw.match(/^##[ \t]+(.+)$/m);
  if (!m) return "";
  const start = m.index;
  const bodyStart = raw.indexOf("\n", start);
  const rest = bodyStart === -1 ? "" : raw.slice(bodyStart + 1);
  const next = rest.search(/^##[ \t]+/m);
  const end = next === -1 ? raw.length : bodyStart + 1 + next;
  return raw.slice(start, end).trim();
}

// CHANGELOG.md for display: drop the redundant "# Changelog" H1 (the modal has
// its own title) but keep the intro paragraph.
export function changelogBody() {
  return raw.replace(/^#[ \t]+Changelog[ \t]*\n/, "");
}
