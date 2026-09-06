import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { porcelainPath } from './gitPorcelain.js';

// Mirrors compressionConfig.ts's DEFAULT_CEILING_CHARS pattern: a small, stable default most
// projects never need to override.
export const DEFAULT_LINE_CEILING = 20;
export const DEFAULT_CONSECUTIVE_SKIP_CAP = 3;

export interface TrivialDiffConfig {
  lineCeiling: number;
  consecutiveSkipCap: number;
}

interface RawTrivialDiffConfig {
  lineCeiling?: number;
  consecutiveSkipCap?: number;
}

// Reads memory-config.json's optional `trivialDiff` block, following the exact same
// missing-file/missing-key/corrupt-JSON-all-fall-back-silently pattern compressionConfig.ts
// already uses for `compression` — this is a read-time convenience for check-stop, never a
// place that should throw and interrupt the Stop hook.
function readRawConfig(memoryRoot: string): RawTrivialDiffConfig {
  const configPath = join(memoryRoot, 'memory-config.json');
  if (!existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (parsed && typeof parsed === 'object' && parsed.trivialDiff && typeof parsed.trivialDiff === 'object') {
      return parsed.trivialDiff as RawTrivialDiffConfig;
    }
    return {};
  } catch {
    return {};
  }
}

export function readTrivialDiffConfig(memoryRoot: string): TrivialDiffConfig {
  const raw = readRawConfig(memoryRoot);
  return {
    lineCeiling: typeof raw.lineCeiling === 'number' ? raw.lineCeiling : DEFAULT_LINE_CEILING,
    consecutiveSkipCap: typeof raw.consecutiveSkipCap === 'number' ? raw.consecutiveSkipCap : DEFAULT_CONSECUTIVE_SKIP_CAP
  };
}

// Same manifest filenames detectStack() (repoScan.ts) recognizes. A manifest touch is a hard
// veto on triviality — it's exactly what the automatic fact-detection feature (sync, PR #18)
// watches for, so it must always reach a real block. This is the single source of truth for
// that list; claudeCode.ts imports it from here instead of keeping its own copy.
export const MANIFEST_FILES = new Set(['package.json', 'requirements.txt', 'pyproject.toml', 'go.mod', 'Cargo.toml']);

export const LOCKFILE_NAMES = new Set([
  'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml',
  'Cargo.lock', 'go.sum', 'poetry.lock', 'Pipfile.lock', 'composer.lock', 'Gemfile.lock'
]);

interface ChangedFile {
  path: string;
  code: string;
}

function parseStatusLines(statusLines: string[]): ChangedFile[] {
  return statusLines.map((line) => ({ path: porcelainPath(line), code: line.slice(0, 2) }));
}

// True only when every given file is a tracked modification/rename (never a fresh add or a
// deletion) AND each one's diff against HEAD, ignoring whitespace, is empty. A diff that's
// purely new/untracked or purely deleted files always returns false here — a new or removed
// file is never "just a reformat" — and the caller falls through to the line-count fallback.
function isWhitespaceOnlyDiff(projectRoot: string, files: ChangedFile[]): boolean {
  if (files.length === 0) return false;
  const allModifications = files.every((f) => f.code.includes('M') || f.code.includes('R'));
  if (!allModifications) return false;
  try {
    return files.every((f) => {
      const diff = execFileSync('git', ['diff', 'HEAD', '-w', '--', f.path], {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      return diff.trim().length === 0;
    });
  } catch {
    return false;
  }
}

// Sums non-whitespace changed lines across every given (non-lockfile) file. Tracked files
// (modified, renamed, staged-added, or deleted) go through `git diff HEAD --numstat -w`, which
// already reports the right added/deleted counts for all of those cases without special-casing
// deletes or staged adds separately. Only genuinely untracked ('??') files need a manual read,
// since `git diff HEAD` has no HEAD-side content to compare an untracked file against at all.
function countChangedLines(projectRoot: string, files: ChangedFile[]): number {
  let total = 0;
  for (const f of files) {
    if (f.code === '??') {
      const content = readFileSync(join(projectRoot, f.path), 'utf-8');
      total += content.length === 0 ? 0 : content.split('\n').length;
      continue;
    }
    const numstat = execFileSync('git', ['diff', 'HEAD', '--numstat', '-w', '--', f.path], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (numstat.length === 0) continue;
    const [added, deleted] = numstat.split('\t');
    total += (Number(added) || 0) + (Number(deleted) || 0);
  }
  return total;
}

// The ordered, explainable decision tree from docs/superpowers/specs/2026-09-07-check-stop-
// trivial-diff-design.md: manifest touch always vetoes (never trivial); an all-lockfiles diff is
// always trivial; a whitespace-only diff (across every non-lockfile file) is trivial regardless
// of the line ceiling; otherwise, total non-whitespace changed lines (lockfiles excluded) against
// the configured ceiling decides it. Any git command failure fails CLOSED (not trivial) — an
// unclassifiable diff must reach the existing block behavior, not silently skip it.
export function isTrivialDiff(projectRoot: string, statusLines: string[], config: TrivialDiffConfig): boolean {
  const files = parseStatusLines(statusLines);
  if (files.length === 0) return true;

  if (files.some((f) => MANIFEST_FILES.has(f.path))) return false;

  const nonLockfiles = files.filter((f) => !LOCKFILE_NAMES.has(f.path));
  if (nonLockfiles.length === 0) return true;

  if (isWhitespaceOnlyDiff(projectRoot, nonLockfiles)) return true;

  try {
    return countChangedLines(projectRoot, nonLockfiles) <= config.lineCeiling;
  } catch {
    return false;
  }
}
