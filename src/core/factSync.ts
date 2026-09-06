import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { detectStack } from './repoScan.js';
import { matchKnownFacts } from './knownFacts.js';
import { detectInfraSignals } from './infraSignals.js';
import { upsertDetectedBlock } from './detectedBlock.js';
import { upsertIndexEntry } from './memoryIndex.js';
import { appendEvent } from './eventLog.js';
import { withLockSync } from './lock.js';

export interface SyncResult {
  written: string[];
}

const TARGETS: { relFile: string; heading: string }[] = [
  { relFile: 'technical/techContext.md', heading: 'Stack' },
  { relFile: 'technical/integrations.md', heading: 'External Services' },
  { relFile: 'technical/infrastructure.md', heading: 'Deployment' }
];

// Automatically detects mechanically-verifiable stack/integration/deployment facts and writes
// them into their managed detected-block (detectedBlock.ts), with zero agent or user action
// required - called from both `load` (every session start) and `check-stop` (when the diff
// touches a manifest file), plus manually via `memoryintel sync`. A no-op (missing-file, no
// write, no event) on any target file `init` hasn't created - this feature is inert on an
// uninitialized or partially-initialized project, never scaffolding structure of its own.
export function syncDetectedFacts(memoryRoot: string): SyncResult {
  const projectRoot = dirname(memoryRoot);
  const stack = detectStack(projectRoot);
  const matched = matchKnownFacts(stack.dependencies);
  const infraLines = detectInfraSignals(projectRoot);

  const contentByTarget: Record<string, string[]> = {
    'technical/techContext.md':
      matched.techContext.length > 0 ? matched.techContext.map((f) => `- ${f}`) : ['_No stack manifest found._'],
    'technical/integrations.md':
      matched.integrations.length > 0
        ? matched.integrations.map((f) => `- ${f}`)
        : ['_No known integrations detected._'],
    'technical/infrastructure.md':
      infraLines.length > 0 ? infraLines.map((f) => `- ${f}`) : ['_No deployment signal found in repo._']
  };

  const written: string[] = [];
  for (const { relFile, heading } of TARGETS) {
    const absPath = join(memoryRoot, relFile);
    // Checked before locking, not just left to upsertDetectedBlock's own 'missing-file' return:
    // withLockSync's openSync(..., O_CREAT) needs the file's parent directory to already exist to
    // create the `.lock` file in - an uninitialized project (no .memoryintel/technical/ at all)
    // would otherwise throw ENOENT here instead of the intended silent no-op.
    if (!existsSync(absPath)) continue;

    const lockPath = `${absPath}.lock`;
    // Same lock-file naming as update()'s per-file locking (`${absPath}.lock`) - a concurrent
    // agent-driven update() and this auto-sync touching the same file correctly serialize
    // against each other instead of racing.
    const result = withLockSync(lockPath, () => upsertDetectedBlock(absPath, heading, contentByTarget[relFile]));

    if (result === 'written') {
      upsertIndexEntry(
        join(memoryRoot, 'memory-index.json'),
        relFile,
        'Auto-detected stack/integration facts (memoryintel sync)'
      );
      appendEvent(join(memoryRoot, 'memory-events.jsonl'), {
        timestamp: new Date().toISOString(),
        type: 'fact-sync',
        summary: `Auto-detected facts written to ${relFile}`,
        affectedFiles: [relFile],
        source: 'auto-detect'
      });
      written.push(relFile);
    }
  }

  return { written };
}
