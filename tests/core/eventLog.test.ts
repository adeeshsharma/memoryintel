import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEvent } from '../../src/core/eventLog.js';

let dir: string;
let eventsPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-events-'));
  eventsPath = join(dir, 'memory-events.jsonl');
  writeFileSync(eventsPath, '');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('appendEvent', () => {
  it('appends one JSON line per call', () => {
    appendEvent(eventsPath, { timestamp: '2026-08-20T10:00:00Z', type: 'architecture-change', summary: 'JWT refresh introduced', affectedFiles: ['technical/architecture.md'] });
    appendEvent(eventsPath, { timestamp: '2026-08-20T10:05:00Z', type: 'progress-update', summary: 'Milestone hit', affectedFiles: ['context/progress.md'] });

    const lines = readFileSync(eventsPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).type).toBe('architecture-change');
    expect(JSON.parse(lines[1]).summary).toBe('Milestone hit');
  });
});
