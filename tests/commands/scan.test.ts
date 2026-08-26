import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScan } from '../../src/commands/scan.js';

let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mi-scancmd-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runScan', () => {
  it('produces both sections even on an empty project', () => {
    const output = runScan(dir);
    expect(output).toContain('=== Detected Stack ===');
    expect(output).toContain('=== Top-Level Layout ===');
  });

  it('surfaces stack and top-level layout on a small realistic project', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { express: '1.0.0' } }));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'index.ts'), '');

    const output = runScan(dir);
    expect(output).toContain('express');
    expect(output).toContain('src/');
  });

  it('never touches .memoryintel/ even if present', () => {
    mkdirSync(join(dir, '.memoryintel', 'context'), { recursive: true });
    writeFileSync(join(dir, '.memoryintel', 'context', 'progress.md'), '# Should not appear\n');

    const output = runScan(dir);
    expect(output).not.toContain('memoryintel');
  });

  it('says nothing about architecture, imports, or git - orientation only', () => {
    const output = runScan(dir);
    expect(output.toLowerCase()).not.toContain('import');
    expect(output.toLowerCase()).not.toContain('churn');
    expect(output.toLowerCase()).not.toContain('hub');
  });
});
