import { execFileSync } from 'node:child_process';

// Returns the raw, non-empty `git status --porcelain` lines for cwd, in the order git reports
// them, or null if this isn't a git repository / git failed for any reason. Each line keeps its
// fixed two-character status code + space prefix intact — callers must use porcelainPath (a
// fixed-offset slice) rather than trimming first, since trimming shifts that offset differently
// depending on whether the status code itself starts with a space.
export function runGitStatusPorcelain(cwd: string): string[] | null {
  try {
    const output = execFileSync('git', ['status', '--porcelain'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return output.split('\n').filter((l) => l.length > 0);
  } catch {
    return null;
  }
}

export function porcelainPath(line: string): string {
  return line.slice(3);
}

// Returns the current commit HEAD points at, or null if this isn't a git repository, git
// failed, or there are no commits yet (a freshly `git init`'d repo has no HEAD to resolve).
export function runGitRevParseHead(cwd: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
}

// True if `relPath` (relative to `cwd`, the same way git itself reports paths when invoked with
// that cwd) has no uncommitted changes, false if it does, or null if git status could not be
// determined at all — callers must treat null as "cannot verify", never as clean.
export function isPathClean(cwd: string, relPath: string): boolean | null {
  const lines = runGitStatusPorcelain(cwd);
  if (lines === null) return null;
  return !lines.some((l) => porcelainPath(l) === relPath);
}
