import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runUpdate } from '../../src/commands/update.js';
import { encodeToonTable } from '../../src/core/toon.js';
import { readRegistry } from '../../src/daemon/registry.js';

let root: string;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'mi-update-'));
  root = join(base, '.memoryintel');
  mkdirSync(join(root, 'technical'), { recursive: true });
  mkdirSync(join(root, 'context'), { recursive: true });
  writeFileSync(join(root, 'technical', 'architecture.md'), '## Overview\nintro\n');
  writeFileSync(join(root, 'context', 'currentMentalModel.md'), 'old mental model\n');
  writeFileSync(join(root, 'memory-index.json'), '{}');
  writeFileSync(join(root, 'memory-events.jsonl'), '');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('runUpdate', () => {
  it('clears any pending check-stop nudge on a successful update', async () => {
    writeFileSync(join(root, '.session-marker.json'), JSON.stringify({ lastFlaggedDiffSignature: 'stale-signature' }));

    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'noted', reason: 'r' }
    ]);
    await runUpdate(root, plan);

    const marker = JSON.parse(readFileSync(join(root, '.session-marker.json'), 'utf-8'));
    expect(marker.lastFlaggedDiffSignature).toBeNull();
  });

  it('applies a valid single-entry plan and logs an event', async () => {
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'JWT refresh added', reason: 'new auth flow' }
    ]);
    const result = await runUpdate(root, plan);
    expect(result.applied).toEqual(['technical/architecture.md']);

    const content = readFileSync(join(root, 'technical', 'architecture.md'), 'utf-8');
    expect(content).toContain('JWT refresh added');

    const events = readFileSync(join(root, 'memory-events.jsonl'), 'utf-8').trim().split('\n');
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]).summary).toBe('new auth flow');
  });

  it('applies a plan given as a JSON array, identically to the equivalent TOON plan', async () => {
    const plan = JSON.stringify([
      { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'JWT refresh added', reason: 'new auth flow' }
    ]);
    const result = await runUpdate(root, plan);
    expect(result.applied).toEqual(['technical/architecture.md']);

    const content = readFileSync(join(root, 'technical', 'architecture.md'), 'utf-8');
    expect(content).toContain('JWT refresh added');
  });

  it('fully overwrites currentMentalModel.md regardless of action/section', async () => {
    const plan = encodeToonTable([
      { file: 'context/currentMentalModel.md', action: 'replace', section: '', content: 'brand new mental model', reason: 'session summary' }
    ]);
    await runUpdate(root, plan);
    expect(readFileSync(join(root, 'context', 'currentMentalModel.md'), 'utf-8')).toBe('brand new mental model');
  });

  it('rejects the whole plan and writes nothing when one entry targets a missing section', async () => {
    const before = readFileSync(join(root, 'technical', 'architecture.md'), 'utf-8');
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'ok entry', reason: 'r1' },
      { file: 'technical/architecture.md', action: 'append', section: 'Nonexistent', content: 'bad entry', reason: 'r2' }
    ]);
    await expect(runUpdate(root, plan)).rejects.toThrow(/not found/);
    expect(readFileSync(join(root, 'technical', 'architecture.md'), 'utf-8')).toBe(before);
  });

  it('rejects a plan targeting a path outside the writable set', async () => {
    const plan = encodeToonTable([
      { file: 'intelligence/entities.json', action: 'append', section: 'x', content: 'y', reason: 'r' }
    ]);
    await expect(runUpdate(root, plan)).rejects.toThrow(/not a recognized/);
  });

  it('skips writing content that is a near-duplicate of what is already there', async () => {
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'intro', reason: 'no-op' }
    ]);
    const result = await runUpdate(root, plan);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(['technical/architecture.md']);
  });

  it('logs a skipped-duplicate event when an append is dropped as a duplicate', async () => {
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'intro', reason: 'no-op' }
    ]);
    await runUpdate(root, plan);

    const events = readFileSync(join(root, 'memory-events.jsonl'), 'utf-8').trim().split('\n');
    expect(events).toHaveLength(1);
    const event = JSON.parse(events[0]);
    expect(event.type).toBe('skipped-duplicate');
    expect(event.summary).toBe('no-op');
    expect(event.affectedFiles).toEqual(['technical/architecture.md']);
  });

  it('applies a replace whose new content is a substring of the old content (narrowing a section)', async () => {
    writeFileSync(join(root, 'technical', 'architecture.md'), '## Overview\nUses Postgres 14 and Redis\n');
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'replace', section: 'Overview', content: 'Uses Postgres 14', reason: 'dropped Redis' }
    ]);
    const result = await runUpdate(root, plan);

    expect(result.skipped).toEqual([]);
    expect(result.applied).toEqual(['technical/architecture.md']);
    expect(readFileSync(join(root, 'technical', 'architecture.md'), 'utf-8')).toBe('## Overview\nUses Postgres 14\n');
  });

  it('applies a replace with content identical to what is already there', async () => {
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'replace', section: 'Overview', content: 'intro', reason: 'restate' }
    ]);
    const result = await runUpdate(root, plan);
    expect(result.applied).toEqual(['technical/architecture.md']);
  });

  it('carries multi-line content through the plan boundary intact', async () => {
    const plan = encodeToonTable([
      {
        file: 'technical/architecture.md',
        action: 'append',
        section: 'Overview',
        content: 'Auth service split out.\n\n- issues JWTs\n- rotates refresh tokens',
        reason: 'auth split'
      }
    ]);
    const result = await runUpdate(root, plan);
    expect(result.applied).toEqual(['technical/architecture.md']);

    expect(readFileSync(join(root, 'technical', 'architecture.md'), 'utf-8')).toBe(
      '## Overview\nintro\nAuth service split out.\n\n- issues JWTs\n- rotates refresh tokens\n'
    );
  });

  it('rejects a plan row with an unrecognized action', async () => {
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'delete', section: 'Overview', content: 'x', reason: 'r' }
    ]);
    await expect(runUpdate(root, plan)).rejects.toThrow(/Unknown action "delete"/);
    expect(readFileSync(join(root, 'technical', 'architecture.md'), 'utf-8')).toBe('## Overview\nintro\n');
  });

  it('applies two entries targeting the same file without one silently discarding the other', async () => {
    writeFileSync(join(root, 'technical', 'architecture.md'), '## Overview\nintro\n## Components\nc1\n');
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'first edit', reason: 'r1' },
      { file: 'technical/architecture.md', action: 'append', section: 'Components', content: 'second edit', reason: 'r2' }
    ]);
    const result = await runUpdate(root, plan);
    expect(result.applied).toEqual(['technical/architecture.md', 'technical/architecture.md']);

    const content = readFileSync(join(root, 'technical', 'architecture.md'), 'utf-8');
    expect(content).toContain('first edit');
    expect(content).toContain('second edit');

    const events = readFileSync(join(root, 'memory-events.jsonl'), 'utf-8').trim().split('\n');
    expect(events).toHaveLength(2);
  });

  it('flags a file that crosses its compression ceiling in the same call that pushed it over', async () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({ compression: { defaultCeilingChars: 20 } }));
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'a much longer addition that pushes this well past the tiny ceiling', reason: 'r' }
    ]);
    const result = await runUpdate(root, plan);
    expect(result.applied).toEqual(['technical/architecture.md']);
    expect(result.overCeiling).toEqual(['technical/architecture.md']);

    const events = readFileSync(join(root, 'memory-events.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    const overCeilingEvent = events.find((e) => e.type === 'over-ceiling');
    expect(overCeilingEvent).toBeDefined();
    expect(overCeilingEvent.summary).toMatch(/over its 20-char ceiling/);
  });

  it('does not flag a file that stays under its compression ceiling', async () => {
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'short note', reason: 'r' }
    ]);
    const result = await runUpdate(root, plan);
    expect(result.overCeiling).toEqual([]);
  });

  it('does not flag a skipped-duplicate write as over ceiling', async () => {
    writeFileSync(join(root, 'memory-config.json'), JSON.stringify({ compression: { defaultCeilingChars: 1 } }));
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'intro', reason: 'no-op' }
    ]);
    const result = await runUpdate(root, plan);
    expect(result.skipped).toEqual(['technical/architecture.md']);
    expect(result.overCeiling).toEqual([]);
  });

  it('does not skip content as a duplicate when identical text exists only in an unrelated section', async () => {
    writeFileSync(join(root, 'technical', 'architecture.md'), '## Overview\nintro\n## Components\nshared text\n');
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'shared text', reason: 'r1' }
    ]);
    const result = await runUpdate(root, plan);
    expect(result.applied).toEqual(['technical/architecture.md']);
    expect(result.skipped).toEqual([]);

    const content = readFileSync(join(root, 'technical', 'architecture.md'), 'utf-8');
    expect(content).toBe('## Overview\nintro\nshared text\n## Components\nshared text\n');
  });
});

describe('runUpdate daemon/registry side effects', () => {
  let globalDir: string;
  beforeEach(() => {
    globalDir = mkdtempSync(join(tmpdir(), 'mi-update-global-'));
    process.env.MEMORYINTEL_GLOBAL_DIR = globalDir;
  });
  afterEach(() => {
    rmSync(globalDir, { recursive: true, force: true });
    delete process.env.MEMORYINTEL_GLOBAL_DIR;
  });

  it('registers the project (keyed by its parent directory) on a successful update', async () => {
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'append', section: 'Overview', content: 'noted', reason: 'r' }
    ]);
    await runUpdate(root, plan);
    const projectRoot = join(root, '..');
    expect(readRegistry()[projectRoot]).toBeDefined();
  });
});

describe('runUpdate compression rows', () => {
  let projectRoot: string;
  let compressRoot: string;

  function initGitRepo(dir: string): void {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  }

  function commitAll(dir: string, message: string): void {
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
  }

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'mi-update-compress-'));
    compressRoot = join(projectRoot, '.memoryintel');
    mkdirSync(join(compressRoot, 'technical'), { recursive: true });
    writeFileSync(join(compressRoot, 'technical', 'architecture.md'), '## Overview\nverbose old history\n');
    writeFileSync(join(compressRoot, 'memory-index.json'), '{}');
    writeFileSync(join(compressRoot, 'memory-events.jsonl'), '');
    initGitRepo(projectRoot);
    commitAll(projectRoot, 'initial');
  });

  afterEach(() => rmSync(projectRoot, { recursive: true, force: true }));

  it('applies a compress row when the target file is git-clean', async () => {
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'replace', section: 'Overview', content: 'compact summary', reason: 'compaction', kind: 'compress' }
    ]);
    const result = await runUpdate(compressRoot, plan);
    expect(result.applied).toEqual(['technical/architecture.md']);
    expect(readFileSync(join(compressRoot, 'technical', 'architecture.md'), 'utf-8')).toBe('## Overview\ncompact summary\n');
  });

  it('logs an applied compress row with type "compression"', async () => {
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'replace', section: 'Overview', content: 'compact summary', reason: 'compaction', kind: 'compress' }
    ]);
    await runUpdate(compressRoot, plan);
    const events = readFileSync(join(compressRoot, 'memory-events.jsonl'), 'utf-8').trim().split('\n');
    expect(JSON.parse(events[0]).type).toBe('compression');
  });

  it('rejects a compress row when the target file has uncommitted changes', async () => {
    writeFileSync(join(compressRoot, 'technical', 'architecture.md'), '## Overview\nverbose old history\nplus a dirty edit\n');

    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'replace', section: 'Overview', content: 'compact summary', reason: 'compaction', kind: 'compress' }
    ]);
    const result = await runUpdate(compressRoot, plan);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(['technical/architecture.md']);

    const content = readFileSync(join(compressRoot, 'technical', 'architecture.md'), 'utf-8');
    expect(content).toBe('## Overview\nverbose old history\nplus a dirty edit\n');
  });

  it('logs a rejected compress row with type "compression-rejected" and a clear reason', async () => {
    writeFileSync(join(compressRoot, 'technical', 'architecture.md'), '## Overview\nverbose old history\nplus a dirty edit\n');
    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'replace', section: 'Overview', content: 'compact summary', reason: 'compaction', kind: 'compress' }
    ]);
    await runUpdate(compressRoot, plan);

    const events = readFileSync(join(compressRoot, 'memory-events.jsonl'), 'utf-8').trim().split('\n');
    const event = JSON.parse(events[0]);
    expect(event.type).toBe('compression-rejected');
    expect(event.summary).toMatch(/uncommitted changes/);
  });

  it('leaves non-compress rows in the same plan unaffected by a dirty target elsewhere', async () => {
    mkdirSync(join(compressRoot, 'context'), { recursive: true });
    writeFileSync(join(compressRoot, 'context', 'currentMentalModel.md'), 'old model\n');
    // architecture.md is dirty relative to git; the currentMentalModel.md row in this same
    // plan carries no kind, so it must be applied normally regardless.
    writeFileSync(join(compressRoot, 'technical', 'architecture.md'), '## Overview\nverbose old history\nplus a dirty edit\n');

    const plan = encodeToonTable([
      { file: 'technical/architecture.md', action: 'replace', section: 'Overview', content: 'compact summary', reason: 'compaction', kind: 'compress' },
      { file: 'context/currentMentalModel.md', action: 'replace', section: '', content: 'new model', reason: 'session summary', kind: '' }
    ]);
    const result = await runUpdate(compressRoot, plan);
    expect(result.skipped).toEqual(['technical/architecture.md']);
    expect(result.applied).toEqual(['context/currentMentalModel.md']);
  });
});
