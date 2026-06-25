// Generate a dated CHANGELOG.md section from the commits in a push to main.
// Run by .github/workflows/changelog.yml with BEFORE/AFTER set to the push
// range. Newest-first: a new "## <date>" section is inserted above the existing
// ones (or merged into today's section if one is already on top). Idempotent —
// re-running on the same range adds nothing new.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const commitExists = (sha) => {
  try { sh(`git cat-file -e ${sha}^{commit}`); return true; } catch { return false; }
};

const AFTER = process.env.AFTER || "HEAD";
let BEFORE = process.env.BEFORE || "";
const ZERO = "0000000000000000000000000000000000000000";

// Resolve a usable commit range. On a brand-new branch BEFORE is all-zeros, so
// fall back to just the latest commit (or the range since its parent).
let range;
if (!BEFORE || BEFORE === ZERO || !commitExists(BEFORE)) {
  try { sh(`git rev-parse ${AFTER}~1`); range = `${AFTER}~1..${AFTER}`; }
  catch { range = AFTER; } // single root commit
} else {
  range = `${BEFORE}..${AFTER}`;
}

const rawLog = range === AFTER
  ? sh(`git log -1 --pretty=format:%s ${AFTER}`)
  : sh(`git log --no-merges --pretty=format:%s ${range}`);

// Drop noise: merge commits, the bot's own changelog commits, version bumps.
const SKIP = /^(Merge\b|docs\(changelog\)|Bump version\b|chore\(release\))/i;
const subjects = [...new Set(
  (rawLog ? rawLog.split("\n") : []).map((s) => s.trim()).filter((s) => s && !SKIP.test(s)),
)];

if (!subjects.length) {
  console.log(`No changelog-worthy commits in range ${range}`);
  process.exit(0);
}

const date = (() => {
  try { return sh(`git show -s --format=%cs ${AFTER}`); } // committer date, YYYY-MM-DD
  catch { return new Date().toISOString().slice(0, 10); }
})();

const path = "CHANGELOG.md";
const lines = readFileSync(path, "utf8").split("\n");
const firstIdx = lines.findIndex((l) => /^## /.test(l));
const bullets = subjects.map((s) => `- ${s}`);

if (firstIdx !== -1 && lines[firstIdx].trim() === `## ${date}`) {
  // A section for today is already on top — merge in the new bullets, skipping
  // any that are already listed.
  const existing = new Set();
  for (let j = firstIdx + 1; j < lines.length && !/^## /.test(lines[j]); j++) {
    if (lines[j].startsWith("- ")) existing.add(lines[j].trim());
  }
  const fresh = bullets.filter((b) => !existing.has(b));
  if (!fresh.length) { console.log("Nothing new to add to today's section."); process.exit(0); }
  let insertAt = firstIdx + 1;
  if (lines[insertAt] === "") insertAt++;
  lines.splice(insertAt, 0, ...fresh);
} else {
  const section = [`## ${date}`, "", ...bullets, ""].join("\n");
  if (firstIdx !== -1) lines.splice(firstIdx, 0, section);
  else lines.push("", section);
}

writeFileSync(path, lines.join("\n"));
console.log(`Added ${subjects.length} entr${subjects.length === 1 ? "y" : "ies"} under ## ${date}`);
