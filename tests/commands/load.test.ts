import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLoad } from '../../src/commands/load.js';
import { readRegistry } from '../../src/daemon/registry.js';

let base: string;
let root: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'mi-load-'));
  root = join(base, '.memoryintel');
  mkdirSync(join(root, 'context'), { recursive: true });
  mkdirSync(join(root, 'technical'), { recursive: true });
  mkdirSync(join(root, 'business'), { recursive: true });
  writeFileSync(join(root, 'context', 'currentMentalModel.md'), 'Auth migration 70% done\n');
  writeFileSync(join(root, 'context', 'activeContext.md'), '## Current Focus\nToken rotation\n');
  writeFileSync(join(root, 'technical', 'architecture.md'), '## Overview\nMicroservices\n');
  writeFileSync(join(root, 'business', 'roadmap.md'), '## Now\nLaunch v1\n');
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('runLoad', () => {
  it('returns empty string when no .memoryintel/ is found', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'mi-load-empty-'));
    expect(runLoad(emptyDir)).toBe('');
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('always includes currentMentalModel.md and activeContext.md', () => {
    const output = runLoad(base);
    expect(output).toContain('Auth migration 70% done');
    expect(output).toContain('Token rotation');
  });

  it('does not include technical/business files with no --domain given', () => {
    const output = runLoad(base);
    expect(output).not.toContain('Microservices');
    expect(output).not.toContain('Launch v1');
  });

  it('includes the technical file set when --domain technical is given', () => {
    const output = runLoad(base, 'technical');
    expect(output).toContain('Microservices');
    expect(output).not.toContain('Launch v1');
  });

  it('throws a clear error for an unrecognized domain instead of spreading undefined', () => {
    expect(() => runLoad(base, 'bogus')).toThrow(/Unknown domain "bogus"/);
  });

  it('includes a TOON heading manifest for loaded files', () => {
    const output = runLoad(base, 'technical');
    expect(output).toContain('items[');
    expect(output).toContain('Overview');
  });

  it('flags a file over its compression ceiling in the manifest', () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({ compression: { defaultCeilingLines: 2 } }));
    const output = runLoad(base);
    expect(output).toContain('over');
  });

  it('marks a file under its compression ceiling as under', () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({ compression: { defaultCeilingLines: 1000 } }));
    const output = runLoad(base);
    expect(output).toContain('under');
    expect(output).not.toContain(',over');
  });
});

describe('runLoad session-load event logging', () => {
  // KPI tracking (how often is this project's memory actually read, roughly how many tokens
  // does a session cost) needs real data, not reconstruction-after-the-fact from file sizes -
  // that's exactly what the first KPI pass on this tool had to resort to. See business/roadmap.md.
  it('logs a session-load event with domain, file list, and content size', () => {
    runLoad(base, 'technical');
    const events = readFileSync(join(root, 'memory-events.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    const loadEvent = events.find((e) => e.type === 'session-load');
    expect(loadEvent).toBeDefined();
    expect(loadEvent.domain).toBe('technical');
    expect(loadEvent.affectedFiles).toContain('technical/architecture.md');
    expect(loadEvent.affectedFiles).toContain('context/currentMentalModel.md');
    expect(loadEvent.totalChars).toBeGreaterThan(0);
    expect(loadEvent.totalLines).toBeGreaterThan(0);
  });

  it('logs domain: null when no --domain is given', () => {
    runLoad(base);
    const events = readFileSync(join(root, 'memory-events.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    const loadEvent = events.find((e) => e.type === 'session-load');
    expect(loadEvent.domain).toBeNull();
  });

  it('does not create memory-events.jsonl when no .memoryintel/ is found', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'mi-load-noevents-'));
    runLoad(emptyDir);
    expect(existsSync(join(emptyDir, '.memoryintel', 'memory-events.jsonl'))).toBe(false);
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('appends one session-load event per call, alongside any prior events', () => {
    runLoad(base);
    runLoad(base, 'technical');
    const events = readFileSync(join(root, 'memory-events.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    expect(events.filter((e) => e.type === 'session-load')).toHaveLength(2);
  });
});

describe('runLoad daemon/registry side effects', () => {
  let globalDir: string;
  beforeEach(() => {
    globalDir = mkdtempSync(join(tmpdir(), 'mi-load-global-'));
    process.env.MEMORYINTEL_GLOBAL_DIR = globalDir;
  });
  afterEach(() => {
    rmSync(globalDir, { recursive: true, force: true });
    delete process.env.MEMORYINTEL_GLOBAL_DIR;
  });

  it('registers the project in the global registry when a root is found', () => {
    runLoad(base);
    expect(readRegistry()[base]).toBeDefined();
  });

  it('does not touch the registry when no .memoryintel/ is found', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'mi-load-empty2-'));
    runLoad(emptyDir);
    expect(readRegistry()[emptyDir]).toBeUndefined();
    rmSync(emptyDir, { recursive: true, force: true });
  });
});
