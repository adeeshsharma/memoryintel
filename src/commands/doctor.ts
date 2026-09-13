import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { INSTRUCTIONS_TEMPLATE } from './init.js';
import { hashContent, getGeneratedFileHash, setGeneratedFileHash } from '../core/generatedFileHashes.js';
import { refreshPointerBlock, ADAPTER_FILE_PATHS } from '../adapters/genericPointer.js';
import { atomicWriteFile } from '../core/atomicWrite.js';
import { pruneRegistryFile, readRegistry } from '../daemon/registry.js';
import { runGitStatusPorcelain, porcelainPath } from '../core/gitPorcelain.js';

export interface DoctorOptions {
  force?: boolean;
}

const INSTRUCTIONS_REL_FILE = 'instructions.md';

function checkInstructions(root: string, options: DoctorOptions): string {
  const instructionsPath = join(root, INSTRUCTIONS_REL_FILE);
  const newFilePath = `${instructionsPath}.new`;

  if (!existsSync(instructionsPath)) {
    return 'instructions.md: missing - run `memoryintel init` to create it.';
  }

  const diskContent = readFileSync(instructionsPath, 'utf-8');
  const diskHash = hashContent(diskContent);
  const templateHash = hashContent(INSTRUCTIONS_TEMPLATE);

  if (diskHash === templateHash) {
    if (existsSync(newFilePath)) unlinkSync(newFilePath);
    // Self-healing: a project with no recorded hash that happens to already be pristine (a
    // fresh init, or content that coincidentally matches) is now provably safe going forward -
    // record it so a future run never has to fall back to the refuse-and-report path for it.
    if (getGeneratedFileHash(root, INSTRUCTIONS_REL_FILE) !== templateHash) {
      setGeneratedFileHash(root, INSTRUCTIONS_REL_FILE, templateHash);
    }
    return 'instructions.md: up to date.';
  }

  const recordedHash = getGeneratedFileHash(root, INSTRUCTIONS_REL_FILE);
  const safeRefresh = recordedHash !== undefined && recordedHash === diskHash;

  if (safeRefresh || options.force) {
    atomicWriteFile(instructionsPath, INSTRUCTIONS_TEMPLATE);
    setGeneratedFileHash(root, INSTRUCTIONS_REL_FILE, templateHash);
    if (existsSync(newFilePath)) unlinkSync(newFilePath);
    return safeRefresh
      ? 'instructions.md: refreshed to the current template.'
      : 'instructions.md: refreshed (forced).';
  }

  atomicWriteFile(newFilePath, INSTRUCTIONS_TEMPLATE);
  const stat = `(current: ${diskContent.split('\n').length} lines, ${diskContent.length} chars — ` +
    `template: ${INSTRUCTIONS_TEMPLATE.split('\n').length} lines, ${INSTRUCTIONS_TEMPLATE.length} chars)`;
  return (
    `instructions.md: differs from the current template and its last-known-safe state can't be ` +
    `confirmed (either hand-edited, or from before doctor existed) ${stat}. Wrote the current ` +
    `template to instructions.md.new for comparison (e.g. \`diff .memoryintel/instructions.md ` +
    `.memoryintel/instructions.md.new\`). Run \`memoryintel doctor --force\` to adopt it anyway - ` +
    `this overwrites instructions.md and removes the .new file.`
  );
}

function checkPointerBlocks(projectRoot: string): string[] {
  const lines: string[] = [];
  for (const relPath of ADAPTER_FILE_PATHS) {
    const result = refreshPointerBlock(join(projectRoot, relPath));
    if (result === 'refreshed') lines.push(`${relPath}: pointer block refreshed.`);
    else if (result === 'unchanged') lines.push(`${relPath}: pointer block up to date.`);
    else if (result === 'not-installed') lines.push(`${relPath}: no pointer block found - skipped.`);
    // 'missing-file' is not reported - most projects won't have all three adapter files, and
    // that's not something worth flagging as noise on every doctor run.
  }
  return lines;
}

// A real, not hypothetical, gap: a git worktree's own .memoryintel/ can sit entirely untracked
// indefinitely - nothing else in this project's workflow ever forces a commit (see
// instructions.md's own "Committing .memoryintel/ itself" section, which only ever *tells* an
// agent to do this). git already collapses a wholly-untracked directory into a single `??` line
// rather than one per file, which is exactly the case worth flagging - a project that committed
// .memoryintel/ once and only has a few new untracked files inside it is a normal mid-session
// state, not this gap. Returns null (not a problem, or genuinely can't tell) for: no git repo at
// all, git unavailable, or a directory that already has at least something committed.
function checkGitTracking(projectRoot: string): string | null {
  const lines = runGitStatusPorcelain(projectRoot);
  if (lines === null) return null;
  const wholeDirUntracked = lines.some((l) => l.startsWith('??') && porcelainPath(l) === '.memoryintel/');
  if (!wholeDirUntracked) return null;
  return '.memoryintel/: entirely untracked by git - nothing here survives if this working directory is lost (a worktree, a container, a wiped clone). Commit it.';
}

export function runDoctor(root: string, options: DoctorOptions = {}): string {
  const projectRoot = dirname(root);
  const lines = [
    checkInstructions(root, options),
    ...checkPointerBlocks(projectRoot),
    checkGitTracking(projectRoot)
  ].filter((line): line is string => line !== null);
  return lines.join('\n') + '\n';
}

export interface DoctorAllResult {
  removedFromRegistry: string[];
  perProject: { path: string; report: string }[];
}

// Every registered project in one call, instead of an agent hand-`find`-ing .memoryintel dirs
// and looping `doctor --root <path>` itself (the exact manual work a real cleanup pass needed
// before this existed). Prunes first so a dead entry never gets a wasted doctor run against a
// path that no longer has anything to check.
export function runDoctorAll(options: DoctorOptions = {}): DoctorAllResult {
  const removedFromRegistry = pruneRegistryFile();
  const perProject = Object.keys(readRegistry())
    .sort()
    .map((path) => ({ path, report: runDoctor(join(path, '.memoryintel'), options) }));
  return { removedFromRegistry, perProject };
}
