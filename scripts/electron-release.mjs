// Create + push an `electron-v<version>` tag, which triggers the
// "Release Electron" GitHub Action (builds the macOS DMG and drafts a
// GitHub Release with the artifacts).
//
// Usage:
//   bun run electron:release 1.0.5
//   npm run electron:release -- 1.0.5
//
// The tag is the source of truth — the workflow stamps electron/package.json
// from the version in the tag, so you don't need to bump it by hand first.

import { execSync } from "node:child_process";

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const die = (msg) => { console.error(`✖ ${msg}`); process.exit(1); };

const version = process.argv[2];
if (!version) {
  die("Pass a version, e.g.  bun run electron:release 1.0.5");
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  die(`Invalid version "${version}" — expected x.y.z`);
}

// Build from a clean tree so the tagged ref matches what you tested.
if (sh("git status --porcelain")) {
  die("Working tree is dirty — commit or stash before releasing.");
}

const tag = `electron-v${version}`;
const exists = (() => {
  try { sh(`git rev-parse -q --verify refs/tags/${tag}`); return true; } catch { return false; }
})();
if (exists) die(`Tag ${tag} already exists.`);

const branch = sh("git rev-parse --abbrev-ref HEAD");
console.log(`Releasing ${tag} from ${branch}…`);
sh(`git tag ${tag}`);
sh(`git push origin ${tag}`);
console.log(`✓ Pushed ${tag}. The "Release Electron" workflow is building the DMG;`);
console.log(`  a DRAFT release will appear under Releases. Watch it with:  gh run watch`);
