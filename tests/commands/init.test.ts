import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runInit } from '../../src/commands/init.js';
import { getGeneratedFileHash } from '../../src/core/generatedFileHashes.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mi-init-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runInit', () => {
  it('creates the full .memoryintel/ directory tree', () => {
    runInit(dir);
    const root = join(dir, '.memoryintel');
    expect(existsSync(join(root, 'instructions.md'))).toBe(true);
    expect(existsSync(join(root, 'memory-config.json'))).toBe(true);
    expect(existsSync(join(root, 'memory-index.json'))).toBe(true);
    expect(existsSync(join(root, 'memory-events.jsonl'))).toBe(true);
    expect(existsSync(join(root, 'technical', 'architecture.md'))).toBe(true);
    expect(existsSync(join(root, 'context', 'currentMentalModel.md'))).toBe(true);
  });

  it('does not scaffold intelligence/*.json - the V2/V3 features that would use it stay permanently dropped, and update() has never accepted writes to that path', () => {
    runInit(dir);
    const root = join(dir, '.memoryintel');
    expect(existsSync(join(root, 'intelligence'))).toBe(false);
  });

  it('seeds architecture.md with the starter heading vocabulary', () => {
    runInit(dir);
    const content = readFileSync(join(dir, '.memoryintel', 'technical', 'architecture.md'), 'utf-8');
    expect(content).toContain('## Overview');
    expect(content).toContain('## Components');
    expect(content).toContain('## Data Flow');
    expect(content).toContain('## Integrations');
  });

  it('is idempotent: re-running does not overwrite existing file content', () => {
    runInit(dir);
    const archPath = join(dir, '.memoryintel', 'technical', 'architecture.md');
    writeFileSync(archPath, '## Overview\ncustom content\n');
    runInit(dir);
    expect(readFileSync(archPath, 'utf-8')).toBe('## Overview\ncustom content\n');
  });

  it('creates missing files on re-run without touching existing ones (upgrade path)', () => {
    runInit(dir);
    const root = join(dir, '.memoryintel');
    rmSync(join(root, 'research', 'hypotheses.md'));
    runInit(dir);
    expect(existsSync(join(root, 'research', 'hypotheses.md'))).toBe(true);
  });

  it('only tells agents to run commands this CLI actually implements', () => {
    runInit(dir);
    const instructions = readFileSync(join(dir, '.memoryintel', 'instructions.md'), 'utf-8');
    expect(instructions).toContain('memoryintel load');
    expect(instructions).toContain('memoryintel update');
    // `dashboard enable`/`disable` are real commands (added by the web-dashboard plan) —
    // instructions.md should reference them now, unlike when this test was first written.
    expect(instructions).toContain('memoryintel dashboard disable');
    expect(instructions).toContain('memoryintel dashboard enable');
  });

  it('spells out the exact TOON syntax an agent needs, since it has no access to this repo\'s own source', () => {
    runInit(dir);
    const instructions = readFileSync(join(dir, '.memoryintel', 'instructions.md'), 'utf-8');
    // The literal header shape update() actually parses (see core/toon.ts's decodeToonTable).
    expect(instructions).toContain('items[');
    expect(instructions).toContain('file,action,section,content,reason');
    // All three real action values, spelled out - not just "action" as a bare noun.
    expect(instructions).toContain('`append`');
    expect(instructions).toContain('`replace`');
    expect(instructions).toContain('`create-section`');
    // The quoting/escaping rule an agent must get right to produce a parseable plan.
    expect(instructions).toContain('""');
  });

  it('documents the JSON alternative to hand-written TOON for update-plans', () => {
    runInit(dir);
    const instructions = readFileSync(join(dir, '.memoryintel', 'instructions.md'), 'utf-8');
    expect(instructions).toMatch(/JSON array/);
    expect(instructions).toContain('JSON.stringify');
  });

  it('seeds generatedFileHashes for instructions.md the moment it is freshly written', () => {
    runInit(dir);
    const root = join(dir, '.memoryintel');
    const instructionsContent = readFileSync(join(root, 'instructions.md'), 'utf-8');
    const expectedHash = createHash('sha256').update(instructionsContent, 'utf-8').digest('hex');
    expect(getGeneratedFileHash(root, 'instructions.md')).toBe(expectedHash);
  });

  it('does not touch an already-recorded hash when instructions.md already existed', () => {
    runInit(dir);
    const root = join(dir, '.memoryintel');
    // Simulate a project that predates hash-tracking: hand-written config with no
    // generatedFileHashes key, plus an instructions.md already on disk.
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({ initializedAt: 'x', version: '0.1.0' }));
    runInit(dir); // re-run - instructions.md already exists, so this must be a no-op for hashing too
    expect(getGeneratedFileHash(root, 'instructions.md')).toBeUndefined();
  });

  it('installs all adapters when they are healthy', () => {
    runInit(dir);
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(dir, '.cursor', 'rules', 'memoryintel.mdc'))).toBe(true);
  });
});
