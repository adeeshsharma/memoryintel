import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertDetectedBlock, DETECTED_START, DETECTED_END } from '../../src/core/detectedBlock.js';

let dir: string;
let filePath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-detectedblock-'));
  filePath = join(dir, 'techContext.md');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('upsertDetectedBlock', () => {
  it('returns missing-file and writes nothing when the target file does not exist', () => {
    const result = upsertDetectedBlock(filePath, 'Stack', ['- Next.js']);
    expect(result).toBe('missing-file');
  });

  it('returns missing-heading when the file exists but the heading does not', () => {
    writeFileSync(filePath, '## Conventions\n\n## Environment\n');
    const result = upsertDetectedBlock(filePath, 'Stack', ['- Next.js']);
    expect(result).toBe('missing-heading');
  });

  it('inserts a fresh block into an empty section', () => {
    writeFileSync(filePath, '## Stack\n\n## Conventions\n');
    const result = upsertDetectedBlock(filePath, 'Stack', ['- Next.js', '- TypeScript']);
    expect(result).toBe('written');
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain(`${DETECTED_START}\n- Next.js\n- TypeScript\n${DETECTED_END}`);
    expect(content).toContain('## Conventions');
  });

  it('inserts the block above existing agent-authored prose in the same section, leaving the prose intact', () => {
    writeFileSync(filePath, '## Stack\nWe picked Next.js because of its SSR support.\n\n## Conventions\n');
    upsertDetectedBlock(filePath, 'Stack', ['- Next.js']);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('We picked Next.js because of its SSR support.');
    expect(content.indexOf(DETECTED_START)).toBeLessThan(content.indexOf('We picked Next.js'));
  });

  it('refreshes an existing block in place, leaving prose below it untouched', () => {
    writeFileSync(
      filePath,
      `## Stack\n${DETECTED_START}\n- Old Fact\n${DETECTED_END}\n\nAgent note: this stayed the same for months.\n\n## Conventions\n`
    );
    const result = upsertDetectedBlock(filePath, 'Stack', ['- New Fact']);
    expect(result).toBe('written');
    const content = readFileSync(filePath, 'utf-8');
    expect(content).not.toContain('Old Fact');
    expect(content).toContain('New Fact');
    expect(content).toContain('Agent note: this stayed the same for months.');
  });

  it('returns unchanged and writes nothing when the computed block is identical to what is already there', () => {
    writeFileSync(filePath, `## Stack\n${DETECTED_START}\n- Next.js\n${DETECTED_END}\n\n## Conventions\n`);
    const before = readFileSync(filePath, 'utf-8');
    const result = upsertDetectedBlock(filePath, 'Stack', ['- Next.js']);
    expect(result).toBe('unchanged');
    expect(readFileSync(filePath, 'utf-8')).toBe(before);
  });

  it('never touches a different section in the same file', () => {
    writeFileSync(filePath, '## Stack\n\n## Conventions\nAlways use 2-space indentation.\n');
    upsertDetectedBlock(filePath, 'Stack', ['- Next.js']);
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('Always use 2-space indentation.');
  });
});
