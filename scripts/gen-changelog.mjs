// Generate a dated CHANGELOG.md section from the commits in a push to main.
// Run by .github/workflows/changelog.yml with BEFORE/AFTER set to the push
// range. Newest-first: a new "## <date>" section is inserted above the existing
// ones (or merged into today's section if one is already on top). Idempotent —
// re-running on the same range adds nothing new.
//
// Commits are split into two subsections so the log stays scannable:
//   ### New & improved  — features + changes to features
//   ### Fixes           — bug fixes (subjects starting with Fix / Hotfix / Revert)
// A "Area: rest" subject renders as "- **Area** — rest".
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const commitExists = (sha) => {
  try { sh(`git cat-file -e ${sha}^{commit}`); return true; } catch { return false; }
};

const AFTER = process.env.AFTER || "HEAD";
let BEFORE = process.env.BEFORE || "";
const ZERO = "0".repeat(40);

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

// ── Categorize + format ──────────────────────────────────────
const isFix = (s) => /^(fix|hotfix|revert)\b/i.test(s);
const fmtFeat = (s) => {
  // "Area: the rest" → "- **Area** — the rest". Keep the area short/plain so a
  // sentence with a colon ("Note: ...") doesn't get mis-bolded.
  const m = s.match(/^([A-Za-z0-9][A-Za-z0-9 /&+.]{0,28}?):\s+(.+)$/);
  return m ? `- **${m[1].trim()}** — ${m[2].trim()}` : `- ${s}`;
};
const fmtFix = (s) => {
  const r = s.replace(/^(fix|hotfix)\b[:\s—-]*/i, "").trim() || s; // keep "Revert …" whole
  return `- ${r.charAt(0).toUpperCase()}${r.slice(1)}`;
};

const feats = subjects.filter((s) => !isFix(s)).map(fmtFeat);
const fixes = subjects.filter(isFix).map(fmtFix);

const FEAT_H = "### New & improved";
const FIX_H = "### Fixes";

const path = "CHANGELOG.md";
const lines = readFileSync(path, "utf8").split("\n");
const firstIdx = lines.findIndex((l) => /^## /.test(l));

if (firstIdx !== -1 && lines[firstIdx].trim() === `## ${date}`) {
  // A section for today is already on top — merge fresh bullets into the right
  // subsection (creating it if missing), skipping any already listed.
  let sectionEnd = firstIdx + 1;
  while (sectionEnd < lines.length && !/^## /.test(lines[sectionEnd])) sectionEnd++;

  const existing = new Set();
  for (let j = firstIdx + 1; j < sectionEnd; j++) {
    if (lines[j].startsWith("- ")) existing.add(lines[j].trim());
  }
  const freshFeats = feats.filter((b) => !existing.has(b));
  const freshFixes = fixes.filter((b) => !existing.has(b));
  if (!freshFeats.length && !freshFixes.length) {
    console.log("Nothing new to add to today's section.");
    process.exit(0);
  }

  const insertUnder = (heading, bullets, createAtTop) => {
    if (!bullets.length) return;
    let hIdx = -1;
    for (let j = firstIdx + 1; j < sectionEnd; j++) { if (lines[j].trim() === heading) { hIdx = j; break; } }
    if (hIdx !== -1) {
      let at = hIdx + 1;
      if (lines[at] === "") at++;
      lines.splice(at, 0, ...bullets);
      sectionEnd += bullets.length;
    } else {
      const block = [heading, "", ...bullets, ""];
      let at = createAtTop ? firstIdx + 1 : sectionEnd;
      if (createAtTop && lines[at] === "") at++;
      lines.splice(at, 0, ...block);
      sectionEnd += block.length;
    }
  };
  insertUnder(FEAT_H, freshFeats, true);
  insertUnder(FIX_H, freshFixes, false);
} else {
  const parts = [`## ${date}`, ""];
  if (feats.length) parts.push(FEAT_H, "", ...feats, "");
  if (fixes.length) parts.push(FIX_H, "", ...fixes, "");
  const section = parts.join("\n");
  if (firstIdx !== -1) lines.splice(firstIdx, 0, section);
  else lines.push("", section);
}

writeFileSync(path, lines.join("\n"));
console.log(`Added ${feats.length} feature + ${fixes.length} fix entr${subjects.length === 1 ? "y" : "ies"} under ## ${date}`);
