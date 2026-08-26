import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScan } from '../../src/commands/scan.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mi-scancmd-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runScan', () => {
  it('produces all four sections even on an empty project', () => {
    const output = runScan(dir);
    expect(output).toContain('=== Detected Stack ===');
    expect(output).toContain('=== Most-Changed Files');
    expect(output).toContain('=== Most-Imported Files');
    expect(output).toContain('=== Documentation Found');
  });

  it('surfaces a real hub file and a real doc on a small realistic project', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { express: '1.0.0' } }));
    writeFileSync(join(dir, 'shared.ts'), 'export const x = 1;\n');
    writeFileSync(join(dir, 'a.ts'), "import { x } from './shared.js';\n");
    writeFileSync(join(dir, 'NOTES.md'), '# Setup Notes\nSome real content.\n');
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });

    const output = runScan(dir);
    expect(output).toContain('express');
    expect(output).toContain('shared.ts (imported by 1 file(s))');
    expect(output).toContain('NOTES.md: Setup Notes');
  });

  it('never touches .memoryintel/ even if present', () => {
    mkdirSync(join(dir, '.memoryintel', 'context'), { recursive: true });
    writeFileSync(join(dir, '.memoryintel', 'context', 'progress.md'), '# Should not appear\n');

    const output = runScan(dir);
    expect(output).not.toContain('Should not appear');
  });
});
