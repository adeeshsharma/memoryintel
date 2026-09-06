import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runGitStatusPorcelain, porcelainPath, runGitRevParseHead } from '../core/gitPorcelain.js';
import { syncDetectedFacts } from '../core/factSync.js';
import { MANIFEST_FILES, isTrivialDiff, readTrivialDiffConfig } from '../core/trivialDiff.js';

interface SessionMarker {
  lastFlaggedDiffSignature: string | null;
  consecutiveTrivialSkips: number;
}

function readMarker(markerPath: string): SessionMarker {
  if (!existsSync(markerPath)) return { lastFlaggedDiffSignature: null, consecutiveTrivialSkips: 0 };
  try {
    const raw = readFileSync(markerPath, 'utf-8').trim();
    if (raw.length === 0) return { lastFlaggedDiffSignature: null, consecutiveTrivialSkips: 0 };
    const parsed = JSON.parse(raw);
    return {
      lastFlaggedDiffSignature: typeof parsed.lastFlaggedDiffSignature === 'string' ? parsed.lastFlaggedDiffSignature : null,
      // Missing on any marker written before the trivial-diff feature shipped — reads as 0 so
      // an old marker file doesn't spuriously start partway toward the consecutive-skip cap.
      consecutiveTrivialSkips: typeof parsed.consecutiveTrivialSkips === 'number' ? parsed.consecutiveTrivialSkips : 0
    };
  } catch {
    return { lastFlaggedDiffSignature: null, consecutiveTrivialSkips: 0 };
  }
}

function writeMarker(markerPath: string, marker: SessionMarker): void {
  writeFileSync(markerPath, JSON.stringify(marker));
}

// Shared by computeDiffSignature and isWorkingTreeDirty (and, below, runCheckStop itself) -
// excludes anything under .memoryintel/ entirely: this module's own marker writes (and
// `update`'s writes to memory files) would otherwise show up as part of the very diff being
// tracked, causing every check to see a "new" signature forever, even with no real code change.
function nonMemoryIntelLines(lines: string[]): string[] {
  return lines.filter((l) => {
    const path = porcelainPath(l);
    return path !== '.memoryintel' && !path.startsWith('.memoryintel/');
  });
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
function computeDiffSignature(projectRoot: string): string | null {
  const lines = runGitStatusPorcelain(projectRoot);
  if (lines === null) return null;
  const filtered = nonMemoryIntelLines(lines).sort();
  const head = runGitRevParseHead(projectRoot) ?? '';
  return `${head}\n${filtered.join('\n')}`;
}

function isWorkingTreeDirty(projectRoot: string): boolean {
  const lines = runGitStatusPorcelain(projectRoot);
  if (lines === null) return false;
  return nonMemoryIntelLines(lines).length > 0;
}

const BLOCK_REASON =
  "Working tree has changes memory hasn't accounted for. Classify them, write a TOON update-plan, and run `memoryintel update <plan-file>` (see .memoryintel/instructions.md) before finishing - running `memoryintel update` bare, with no plan file, fails. Or finish again to proceed without updating this time.";

// Claude Code's Stop hook JSON schema only recognizes decision: "block" - there is no "allow"
// value, so the non-blocking cases must return {} (decision omitted), not { decision: 'allow' },
// or Claude Code rejects the hook output outright ("Hook JSON output validation failed").
export function runCheckStop(memoryRoot: string): { decision?: 'block'; reason?: string } {
  const projectRoot = dirname(memoryRoot);
  const markerPath = join(memoryRoot, '.session-marker.json');
  const marker = readMarker(markerPath);

  const signature = computeDiffSignature(projectRoot);
  if (signature === null) return {};

  if (signature === marker.lastFlaggedDiffSignature) {
    return {};
  }

  // A brand-new marker (nothing has ever been flagged or resolved in this project) with a
  // currently-clean working tree has nothing actionable to report - baseline silently so a
  // FUTURE commit or dirty file compares against this starting point, rather than blocking
  // just because this exact HEAD has never been seen before, which would nag on every fresh
  // project's very first Stop event.
  if (marker.lastFlaggedDiffSignature === null && !isWorkingTreeDirty(projectRoot)) {
    writeMarker(markerPath, { lastFlaggedDiffSignature: signature, consecutiveTrivialSkips: 0 });
    return {};
  }

  const statusLines = runGitStatusPorcelain(projectRoot);
  const changedLines = statusLines === null ? [] : nonMemoryIntelLines(statusLines);
  const config = readTrivialDiffConfig(memoryRoot);

  // See docs/superpowers/specs/2026-09-07-check-stop-trivial-diff-design.md. A trivial diff
  // (lockfile-only, whitespace-only, or small) allows immediately instead of blocking - but a
  // consecutive-skip cap forces a real block if trivial diffs keep piling up unnoticed, since
  // that's exactly the failure mode this hook was built to catch.
  if (isTrivialDiff(projectRoot, changedLines, config)) {
    const nextSkips = marker.consecutiveTrivialSkips + 1;
    if (nextSkips < config.consecutiveSkipCap) {
      writeMarker(markerPath, { lastFlaggedDiffSignature: signature, consecutiveTrivialSkips: nextSkips });
      return {};
    }
    writeMarker(markerPath, { lastFlaggedDiffSignature: signature, consecutiveTrivialSkips: 0 });
    return { decision: 'block', reason: BLOCK_REASON };
  }

  writeMarker(markerPath, { lastFlaggedDiffSignature: signature, consecutiveTrivialSkips: 0 });

  let reason = BLOCK_REASON;

  // Mechanism 2 (see docs/superpowers/specs/2026-09-06-automatic-fact-detection-design.md): when
  // the diff touches a manifest file, name specifically what auto-detection just found, so the
  // agent's own follow-up judgment gets a concrete lead instead of only "something changed, go
  // figure out what." This never changes the block/allow decision itself - only the reason text.
  // A manifest touch is always non-trivial (isTrivialDiff's rule 1 veto), so this and the
  // trivial-skip branch above are mutually exclusive by construction.
  const touchesManifest = changedLines.some((l) => MANIFEST_FILES.has(porcelainPath(l)));
  if (touchesManifest) {
    const syncResult = syncDetectedFacts(memoryRoot);
    if (syncResult.written.length > 0) {
      reason += ` Also: a manifest file changed — auto-detected facts were just written to ${syncResult.written.join(', ')}. Worth a note elsewhere (e.g. why it was added) if that's not just incidental.`;
    }
  }

  return { decision: 'block', reason };
}

// Called after a successful `update`. Does NOT simply clear the marker to null — `update` only
// writes to .memoryintel/, so the user's actual source diff that triggered the nudge (e.g. an
// uncommitted src.js) is still sitting there afterward. Clearing to null would make that
// still-present, already-addressed diff look "new" again on the very next check-stop call,
// causing an immediate re-block right after the agent just logged something — the opposite of
// the intended anti-nag behavior. Instead, capture the CURRENT diff signature as the new
// baseline: "this exact situation has now been accounted for." Also resets the consecutive-skip
// counter — a real memory update is exactly the event the cap exists to force, so it always
// clears it.
export function resolveCheckStopMarker(memoryRoot: string): void {
  const markerPath = join(memoryRoot, '.session-marker.json');
  const projectRoot = dirname(memoryRoot);
  const signature = computeDiffSignature(projectRoot);
  writeMarker(markerPath, { lastFlaggedDiffSignature: signature ? signature : null, consecutiveTrivialSkips: 0 });
}
