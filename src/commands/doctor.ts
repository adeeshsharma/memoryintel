import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { INSTRUCTIONS_TEMPLATE } from './init.js';
import { hashContent, getGeneratedFileHash, setGeneratedFileHash } from '../core/generatedFileHashes.js';
import { refreshPointerBlock, ADAPTER_FILE_PATHS } from '../adapters/genericPointer.js';
import { atomicWriteFile } from '../core/atomicWrite.js';

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
  return (
    "instructions.md: differs from the current template and its last-known-safe state can't be " +
    "confirmed (either hand-edited, or from before doctor existed). Wrote the current template " +
    "to instructions.md.new for comparison (e.g. `diff .memoryintel/instructions.md " +
    ".memoryintel/instructions.md.new`). Run `memoryintel doctor --force` to adopt it anyway - " +
    "this overwrites instructions.md and removes the .new file."
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

export function runDoctor(root: string, options: DoctorOptions = {}): string {
  const projectRoot = dirname(root);
  const lines = [checkInstructions(root, options), ...checkPointerBlocks(projectRoot)];
  return lines.join('\n') + '\n';
}
