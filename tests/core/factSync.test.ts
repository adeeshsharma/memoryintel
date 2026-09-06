import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../../src/commands/init.js';
import { syncDetectedFacts } from '../../src/core/factSync.js';

let projectDir: string;
let root: string;
beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'mi-factsync-'));
  root = join(projectDir, '.memoryintel');
});
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

describe('syncDetectedFacts', () => {
  it('writes matched stack and integration facts into their target files after init', () => {
    runInit(projectDir);
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({ dependencies: { next: '^14.0.0', '@sanity/client': '^6.0.0' } })
    );

    const result = syncDetectedFacts(root);

    expect(result.written).toContain('technical/techContext.md');
    expect(result.written).toContain('technical/integrations.md');
    const techContext = readFileSync(join(root, 'technical/techContext.md'), 'utf-8');
    expect(techContext).toContain('Next.js');
    const integrations = readFileSync(join(root, 'technical/integrations.md'), 'utf-8');
    expect(integrations).toContain('Sanity');
  });

  it('writes the explicit "no signal" placeholder to infrastructure.md when nothing is detected', () => {
    runInit(projectDir);
    const result = syncDetectedFacts(root);
    expect(result.written).toContain('technical/infrastructure.md');
    const infra = readFileSync(join(root, 'technical/infrastructure.md'), 'utf-8');
    expect(infra).toContain('No deployment signal found in repo');
  });

  it('writes a detected deployment fact into infrastructure.md when a config file exists', () => {
    runInit(projectDir);
    writeFileSync(join(projectDir, 'vercel.json'), '{}');
    const result = syncDetectedFacts(root);
    expect(result.written).toContain('technical/infrastructure.md');
    const infra = readFileSync(join(root, 'technical/infrastructure.md'), 'utf-8');
    expect(infra).toContain('Vercel');
  });

  it('is idempotent — a second call with no repo changes writes nothing further', () => {
    runInit(projectDir);
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ dependencies: { next: '^14.0.0' } }));
    syncDetectedFacts(root);
    const second = syncDetectedFacts(root);
    expect(second.written).toEqual([]);
  });

  it('records an index entry and an auto-detect event for each file it actually writes', () => {
    runInit(projectDir);
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ dependencies: { next: '^14.0.0' } }));
    syncDetectedFacts(root);

    const index = JSON.parse(readFileSync(join(root, 'memory-index.json'), 'utf-8'));
    expect(index['technical/techContext.md']).toBeDefined();

    const events = readFileSync(join(root, 'memory-events.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    const factSyncEvents = events.filter((e) => e.type === 'fact-sync');
    expect(factSyncEvents.length).toBeGreaterThan(0);
    expect(factSyncEvents[0].source).toBe('auto-detect');
  });

  it('does nothing when .memoryintel/ was never initialized (no starter files present)', () => {
    // root deliberately not created via runInit - simulates syncDetectedFacts being called
    // against a directory that has no .memoryintel/ structure at all.
    writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ dependencies: { next: '^14.0.0' } }));
    const result = syncDetectedFacts(root);
    expect(result.written).toEqual([]);
  });
});
