import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runGitStatusPorcelain, porcelainPath, runGitRevParseHead } from '../core/gitPorcelain.js';

interface SessionMarker {
  lastFlaggedDiffSignature: string | null;
}

function readMarker(markerPath: string): SessionMarker {
  if (!existsSync(markerPath)) return { lastFlaggedDiffSignature: null };
  try {
    const raw = readFileSync(markerPath, 'utf-8').trim();
    if (raw.length === 0) return { lastFlaggedDiffSignature: null };
    const parsed = JSON.parse(raw);
    return { lastFlaggedDiffSignature: typeof parsed.lastFlaggedDiffSignature === 'string' ? parsed.lastFlaggedDiffSignature : null };
  } catch {
    return { lastFlaggedDiffSignature: null };
  }
}

function writeMarker(markerPath: string, marker: SessionMarker): void {
  writeFileSync(markerPath, JSON.stringify(marker));
}

// Combines the current HEAD commit with the sorted, joined `git status --porcelain` output - a
// stable signature for "what's currently dirty, at what commit" - or null if this isn't a git
// repository / git failed for any reason.
//
// HEAD is part of the signature, not just the working-tree diff: a diff-only signature goes
// back to '' the moment a commit lands, even one this project's own memory never recorded -
// this project's own established workflow is to commit promptly, so a diff-only signature was
// blind to almost every real change by the time anyone would notice. Confirmed on a real
// project (distilled-docs): `.session-marker.json` had never once recorded a flagged diff in
// its whole history, despite real, uncommitted work sitting there unaccounted for, because every
// prior unit of work had already been committed by the time any check-stop would have seen it.
//
// Excludes anything under .memoryintel/ entirely from the working-tree half: this function's own
// marker writes (and `update`'s writes to memory files) would otherwise show up as part of the
// very diff being tracked, causing every check to see a "new" signature forever, even with no
// real code change.
function computeDiffSignature(projectRoot: string): string | null {
  const lines = runGitStatusPorcelain(projectRoot);
  if (lines === null) return null;

  const filtered = lines
    .filter((l) => {
      const path = porcelainPath(l);
      return path !== '.memoryintel' && !path.startsWith('.memoryintel/');
    })
    .sort();
  const head = runGitRevParseHead(projectRoot) ?? '';
  return `${head}\n${filtered.join('\n')}`;
}

function isWorkingTreeDirty(projectRoot: string): boolean {
  const lines = runGitStatusPorcelain(projectRoot);
  if (lines === null) return false;
  return lines.some((l) => {
    const path = porcelainPath(l);
    return path !== '.memoryintel' && !path.startsWith('.memoryintel/');
  });
}

export function runCheckStop(memoryRoot: string): { decision: 'block' | 'allow'; reason?: string } {
  const projectRoot = dirname(memoryRoot);
  const markerPath = join(memoryRoot, '.session-marker.json');
  const marker = readMarker(markerPath);

  const signature = computeDiffSignature(projectRoot);
  if (signature === null) return { decision: 'allow' };

  if (signature === marker.lastFlaggedDiffSignature) {
    return { decision: 'allow' };
  }

  // A brand-new marker (nothing has ever been flagged or resolved in this project) with a
  // currently-clean working tree has nothing actionable to report - baseline silently so a
  // FUTURE commit or dirty file compares against this starting point, rather than blocking
  // just because this exact HEAD has never been seen before, which would nag on every fresh
  // project's very first Stop event.
  if (marker.lastFlaggedDiffSignature === null && !isWorkingTreeDirty(projectRoot)) {
    writeMarker(markerPath, { lastFlaggedDiffSignature: signature });
    return { decision: 'allow' };
  }

  writeMarker(markerPath, { lastFlaggedDiffSignature: signature });
  return {
    decision: 'block',
    reason: "Working tree has changes memory hasn't accounted for. Classify them, write a TOON update-plan, and run `memoryintel update <plan-file>` (see .memoryintel/instructions.md) before finishing - running `memoryintel update` bare, with no plan file, fails. Or finish again to proceed without updating this time."
  };
}

// Called after a successful `update`. Does NOT simply clear the marker to null — `update` only
// writes to .memoryintel/, so the user's actual source diff that triggered the nudge (e.g. an
// uncommitted src.js) is still sitting there afterward. Clearing to null would make that
// still-present, already-addressed diff look "new" again on the very next check-stop call,
// causing an immediate re-block right after the agent just logged something — the opposite of
// the intended anti-nag behavior. Instead, capture the CURRENT diff signature as the new
// baseline: "this exact situation has now been accounted for."
export function resolveCheckStopMarker(memoryRoot: string): void {
  const markerPath = join(memoryRoot, '.session-marker.json');
  const projectRoot = dirname(memoryRoot);
  const signature = computeDiffSignature(projectRoot);
  writeMarker(markerPath, { lastFlaggedDiffSignature: signature ? signature : null });
}
