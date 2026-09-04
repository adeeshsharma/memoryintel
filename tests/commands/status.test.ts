import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runStatus } from '../../src/commands/status.js';

let root: string;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'mi-status-'));
  root = join(base, '.memoryintel');
  mkdirSync(join(root, 'context'), { recursive: true });
  writeFileSync(join(root, 'context', 'currentMentalModel.md'), 'Auth migration 70% done\n');
  writeFileSync(join(root, 'memory-index.json'), JSON.stringify({
    'technical/architecture.md': { lastUpdated: '2026-08-20T10:00:00Z', summary: 'JWT refresh introduced' }
  }));
  writeFileSync(join(root, 'memory-events.jsonl'), JSON.stringify({
    timestamp: '2026-08-20T10:00:00Z', type: 'memory-update', summary: 'JWT refresh introduced', affectedFiles: ['technical/architecture.md']
  }) + '\n');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('runStatus', () => {
  it('includes the current mental model', () => {
    expect(runStatus(root)).toContain('Auth migration 70% done');
  });

  it('includes the index summary', () => {
    expect(runStatus(root)).toContain('JWT refresh introduced');
  });

  it('includes the most recent event', () => {
    expect(runStatus(root)).toContain('memory-update');
  });

  it('includes the resolved root, so a wrong-directory status is visible rather than silent', () => {
    expect(runStatus(root)).toContain(root);
  });
});
